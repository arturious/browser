import SwiftUI
import AppKit
import WebKit

@MainActor
final class BrowserTab: Identifiable, ObservableObject {
    let id = UUID()
    @Published var url: URL
    @Published var title: String
    @Published var isLoading: Bool = false
    @Published var canGoBack: Bool = false
    @Published var canGoForward: Bool = false
    @Published var faviconImage: NSImage?
    @Published var zoomLevel: CGFloat = 1.0

    let webView: WKWebView
    private var coordinator: WebViewCoordinator?
    private var faviconHost: String?
    private var urlObservation: NSKeyValueObservation?
    private var titleObservation: NSKeyValueObservation?
    private var pipMessageHandler: PiPExitMessageHandler?

    /// Fired when the page's video leaves Picture-in-Picture for any reason
    /// (including the system PiP window's "return to tab" button), so the
    /// app can bring this tab back to the front — the system doesn't do that
    /// for us since we're not Safari.
    var onPiPExited: (() -> Void)?

    /// Fired when a page tries to open a new window/tab (`target="_blank"`,
    /// `window.open()`) — without handling this, WebKit silently drops such
    /// navigations entirely (this was why some download-button links, which
    /// route through a popup before redirecting to the actual file, never
    /// reached any of our delegate methods at all). The caller creates a new
    /// tab from the given (shared) configuration and returns its webView, or
    /// nil to refuse the popup.
    var onCreatePopup: ((WKWebViewConfiguration, WKNavigationAction) -> WKWebView?)?

    convenience init(url: URL) {
        let config = WKWebViewConfiguration()
        // Public API for this (WKWebViewConfiguration.allowsPictureInPictureMediaPlayback)
        // is iOS-only; on macOS the equivalent preference is only reachable
        // via this private key, which several WKWebView-based browsers rely
        // on to get native video PiP working at all.
        config.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")

        let handler = PiPExitMessageHandler()
        config.userContentController.add(handler, name: "pipExited")
        let script = WKUserScript(
            source: """
            document.addEventListener('leavepictureinpicture', () => {
                window.webkit.messageHandlers.pipExited.postMessage(true);
            }, true);
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(script)

        // WKWebView can't complete a WebAuthn/passkey ceremony for a domain
        // this app has no Associated Domains entitlement for (i.e. any
        // third-party site) — the request just hangs on "Use your passkey to
        // confirm it's really you" forever. Disabling the WebAuthn API on
        // known federated sign-in domains makes them detect no passkey
        // support and fall back to their normal password/code flow instead.
        let disableWebAuthnScript = WKUserScript(
            source: """
            (() => {
                const blockedHosts = ['accounts.google.com'];
                if (blockedHosts.includes(location.hostname)) {
                    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
                    if (window.navigator.credentials) {
                        navigator.credentials.get = () => Promise.reject(new Error('WebAuthn disabled'));
                        navigator.credentials.create = () => Promise.reject(new Error('WebAuthn disabled'));
                    }
                }
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(disableWebAuthnScript)

        AdBlockManager.shared.register(config.userContentController)

        self.init(url: url, configuration: config, pipHandler: handler)
        webView.load(URLRequest(url: url))
        loadFavicon()
    }

    /// Used for popups (`target="_blank"`/`window.open()`): WebKit requires
    /// reusing the SAME configuration it hands to `createWebViewWith` (it
    /// already carries the opener's process group/content-blocker/script
    /// setup), and loads the popup's own navigation into the returned
    /// webView itself — so we must not call `load` again here.
    convenience init(popupConfiguration configuration: WKWebViewConfiguration) {
        self.init(url: URL(string: "about:blank")!, configuration: configuration, pipHandler: nil)
    }

    private init(url: URL, configuration: WKWebViewConfiguration, pipHandler: PiPExitMessageHandler?) {
        self.url = url
        self.title = url.host ?? "New Tab"

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
        self.webView = web

        let coordinator = WebViewCoordinator(tab: self)
        web.navigationDelegate = coordinator
        web.uiDelegate = coordinator
        self.coordinator = coordinator

        pipHandler?.tab = self
        self.pipMessageHandler = pipHandler

        // Single-page apps (e.g. YouTube) change the page URL via the History
        // API (pushState) without a full navigation, so WKNavigationDelegate
        // callbacks never fire. Observing `url` directly via KVO catches those
        // in-page route changes too.
        urlObservation = web.observe(\.url, options: [.new]) { [weak self] _, change in
            guard let newURL = change.newValue ?? nil else { return }
            DispatchQueue.main.async {
                self?.url = newURL
            }
        }

        // Same reasoning as urlObservation: SPAs update document.title on
        // in-page route changes without a full navigation, so the tab-hover
        // tooltip needs its own live source instead of relying on didFinish.
        titleObservation = web.observe(\.title, options: [.new]) { [weak self] _, change in
            guard let newTitle = change.newValue ?? nil, !newTitle.isEmpty else { return }
            DispatchQueue.main.async {
                self?.title = newTitle
            }
        }
    }

    func loadFavicon() {
        guard let host = url.host, host != faviconHost else { return }
        faviconHost = host
        guard let iconURL = URL(string: "https://www.google.com/s2/favicons?sz=64&domain=\(host)") else { return }

        URLSession.shared.dataTask(with: iconURL) { [weak self] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            Task { @MainActor in
                self?.faviconImage = image
            }
        }.resume()
    }

    func navigate(to url: URL) {
        self.url = url
        webView.load(URLRequest(url: url))
    }

    func checkIsVideoPlaying(completion: @escaping (Bool) -> Void) {
        let script = "(() => { const v = document.querySelector('video'); return !!(v && !v.paused && !v.ended); })();"
        webView.evaluateJavaScript(script) { result, _ in
            completion((result as? Bool) ?? false)
        }
    }

    func goBack() { webView.goBack() }
    func goForward() { webView.goForward() }
    func reload() { webView.reload() }
    func stopLoading() { webView.stopLoading() }

    func zoomIn() {
        zoomLevel = min(zoomLevel + 0.05, 3.0)
        webView.pageZoom = zoomLevel
    }

    func zoomOut() {
        zoomLevel = max(zoomLevel - 0.05, 0.25)
        webView.pageZoom = zoomLevel
    }

    func resetZoom() {
        zoomLevel = 1.0
        webView.pageZoom = zoomLevel
    }

    var faviconLetter: String {
        String((url.host?.replacingOccurrences(of: "www.", with: "") ?? "?").prefix(1)).uppercased()
    }

    var faviconColor: Color {
        let host = url.host ?? ""
        let hash = host.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        let hue = Double(hash % 360) / 360.0
        return Color(hue: hue, saturation: 0.55, brightness: 0.85)
    }
}

private final class PiPExitMessageHandler: NSObject, WKScriptMessageHandler {
    weak var tab: BrowserTab?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        tab?.onPiPExited?()
    }
}

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
        if let url = webView.url {
            tab?.url = url
        }
        tab?.canGoBack = webView.canGoBack
        tab?.canGoForward = webView.canGoForward
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let tab else { return }
        tab.isLoading = false
        tab.canGoBack = webView.canGoBack
        tab.canGoForward = webView.canGoForward
        if let title = webView.title, !title.isEmpty {
            tab.title = title
        }
        if let url = webView.url {
            tab.url = url
        }
        tab.loadFavicon()
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
        } else {
            return (.allow, preferences)
        }
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
