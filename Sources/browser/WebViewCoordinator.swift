import AppKit
import WebKit

@MainActor
final class WebViewCoordinator: NSObject, WKNavigationDelegate {
    weak var tab: BrowserTab?

    /// WebKit deliberately cancels the underlying frame load once a
    /// navigation is converted into a download, which is reported to us as
    /// `didFail(Provisional)Navigation` with `WebKitErrorDomain` code 102
    /// ("Frame load interrupted") — an expected side effect, not a real
    /// failure. This flag (set the moment we return `.download`) lets us
    /// recognize and swallow exactly that error instead of treating it as a
    /// broken navigation.
    private var isDownloadNavigation = false

    init(tab: BrowserTab) {
        self.tab = tab
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        tab?.isLoading = true
        // Guarded the same way as urlObservation above — this also fires
        // for the internal `about:blank` navigation `unload()` makes, which
        // must not clobber the real `url` a pinned tab is remembering.
        if let tab, !tab.isUnloaded, let url = webView.url {
            tab.url = url
        }
    }

    // Applying the stored zoom here (rather than at didStartProvisionalNavigation)
    // matters: at that point the new page hasn't replaced the old page's
    // content yet, so setting pageZoom visibly snaps the *previous* page to
    // the new site's zoom level for a moment. didCommit fires once the new
    // page has actually started rendering, so the zoom change lands on the
    // right content.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        tab?.applyStoredZoom(for: webView.url?.host)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let tab else { return }
        tab.isLoading = false
        guard !tab.isUnloaded else { return }
        if let title = webView.title, !title.isEmpty {
            tab.title = title
        }
        if let url = webView.url {
            tab.url = url
        }
        tab.loadFavicon()
        tab.loadThemeColor()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        tab?.isLoading = false
        guard !isDownloadNavigation else {
            isDownloadNavigation = false
            return
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        tab?.isLoading = false
        guard !isDownloadNavigation else {
            isDownloadNavigation = false
            return
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences
    ) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        // Some downloads (e.g. `<a download>` links) are flagged as
        // downloads at the ACTION stage, before any network response even
        // exists — catching only navigationResponse misses these entirely.
        if navigationAction.shouldPerformDownload {
            isDownloadNavigation = true
            return (.download, preferences)
        }

        // Cmd+clicking a link is the standard "open in new tab" gesture —
        // WKWebView doesn't handle this itself, so intercept it here rather
        // than letting it navigate the current tab.
        if navigationAction.navigationType == .linkActivated,
           navigationAction.modifierFlags.contains(.command),
           let url = navigationAction.request.url {
            tab?.onOpenInNewTab?(url)
            return (.cancel, preferences)
        }

        return (.allow, preferences)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
        let isAttachment = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased()
            .hasPrefix("attachment") ?? false

        if navigationResponse.canShowMIMEType && !isAttachment {
            return .allow
        } else {
            isDownloadNavigation = true
            return .download
        }
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        isDownloadNavigation = false
        tab?.isLoading = false
        DownloadManager.shared.beginTracking(download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        isDownloadNavigation = false
        tab?.isLoading = false
        DownloadManager.shared.beginTracking(download)
    }
}

extension WebViewCoordinator: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        tab?.onCreatePopup?(configuration, navigationAction)
    }
}
