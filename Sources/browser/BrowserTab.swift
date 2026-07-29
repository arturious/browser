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
    @Published var hasPlayingVideo: Bool = false
    /// True while any video or audio element on the page is playing — drives
    /// the little speaker badge on this tab's sidebar icon, unlike
    /// `hasPlayingVideo` (video only), which drives the PiP button.
    @Published var isPlayingMedia: Bool = false
    /// Live progress (0...1) of an in-flight custom swipe-back/forward
    /// gesture, and its direction — drives the custom swipe overlay instead
    /// of WebKit's own swipe animation.
    @Published var swipeProgress: CGFloat = 0
    @Published var swipeIsBack: Bool = true
    /// WKWebView's own page-load progress (0...1) — drives the thin loading
    /// bar under the topbar, the same idea as Chrome/YouTube's.
    @Published var loadingProgress: Double = 0
    /// The page's declared `<meta name="theme-color">`, if any — colors the
    /// loading bar to match the site instead of a fixed accent color.
    @Published var themeColor: Color?

    let webView: WKWebView
    private var coordinator: WebViewCoordinator?
    private var faviconHost: String?
    private var zoomHost: String?
    private var urlObservation: NSKeyValueObservation?
    private var titleObservation: NSKeyValueObservation?
    private var canGoBackObservation: NSKeyValueObservation?
    private var canGoForwardObservation: NSKeyValueObservation?
    private var estimatedProgressObservation: NSKeyValueObservation?
    private var pipMessageHandler: PiPExitMessageHandler?
    private var videoPlaybackMessageHandler: VideoPlaybackMessageHandler?

    /// Fired when the page's video leaves Picture-in-Picture for any reason
    /// (including the system PiP window's "return to tab" button), so the
    /// app can bring this tab back to the front — the system doesn't do that
    /// for us since we're not Safari. WKWebView gives no way to tell "return"
    /// apart from the PiP window's "X" (close) button, so this also fires
    /// (harmlessly, if a bit unexpectedly) when the user just closes PiP.
    var onPiPExited: (() -> Void)?

    /// Fired when a page tries to open a new window/tab (`target="_blank"`,
    /// `window.open()`) — without handling this, WebKit silently drops such
    /// navigations entirely (this was why some download-button links, which
    /// route through a popup before redirecting to the actual file, never
    /// reached any of our delegate methods at all). The caller creates a new
    /// tab from the given (shared) configuration and returns its webView, or
    /// nil to refuse the popup.
    var onCreatePopup: ((WKWebViewConfiguration, WKNavigationAction) -> WKWebView?)?

    /// Fired when the user Cmd+clicks a link — the standard "open in a new
    /// tab" gesture, which WKWebView doesn't handle on its own.
    var onOpenInNewTab: ((URL) -> Void)?

    convenience init(url: URL) {
        let config = WKWebViewConfiguration()
        // Without this, sites autoplay video/audio the moment a tab loads —
        // including tabs that were just restored from the last session or
        // opened via Cmd+click in the background, which shouldn't start
        // making noise before the user has even looked at them.
        config.mediaTypesRequiringUserActionForPlayback = .all

        // Public API for this (WKWebViewConfiguration.allowsPictureInPictureMediaPlayback)
        // is iOS-only; on macOS the equivalent preference is only reachable
        // via this private key, which several WKWebView-based browsers rely
        // on to get native video PiP working at all.
        config.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")

        let handler = PiPExitMessageHandler()
        config.userContentController.add(handler, name: "pipExited")
        let script = WKUserScript(
            source: """
            (() => {
                // The system PiP window's close (X) button pauses the video
                // as part of WebKit's own native teardown; its "return to
                // tab" arrow doesn't touch playback at all. Either way,
                // closing PiP shouldn't leave a video that was actually
                // playing stuck paused — but a video the user had already
                // paused themselves should stay paused. Track "was it
                // playing" independently of this event's own timing (that
                // pause can land before or after 'leavepictureinpicture'
                // fires) so the check isn't a race.
                let wasPlayingRecently = false;
                setInterval(() => {
                    const v = document.querySelector('video');
                    if (v) wasPlayingRecently = !v.paused;
                }, 200);

                document.addEventListener('leavepictureinpicture', (event) => {
                    const video = event.target;
                    const wasPlaying = wasPlayingRecently;
                    setTimeout(() => {
                        if (wasPlaying && video.paused) {
                            video.play().catch(() => {});
                        }
                        window.webkit.messageHandlers.pipExited.postMessage(true);
                    }, 200);
                }, true);
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(script)

        let videoHandler = VideoPlaybackMessageHandler()
        config.userContentController.add(videoHandler, name: "videoPlaybackState")
        let videoPlaybackScript = WKUserScript(
            source: """
            (() => {
                let lastVideoState = false;
                let lastMediaState = false;
                function isPlaying(el) { return !el.paused && !el.ended; }
                function report() {
                    const videos = Array.from(document.querySelectorAll('video'));
                    const audios = Array.from(document.querySelectorAll('audio'));
                    const videoState = videos.some(isPlaying);
                    const mediaState = videoState || audios.some(isPlaying);
                    if (videoState !== lastVideoState || mediaState !== lastMediaState) {
                        lastVideoState = videoState;
                        lastMediaState = mediaState;
                        window.webkit.messageHandlers.videoPlaybackState.postMessage({ video: videoState, media: mediaState });
                    }
                }
                document.addEventListener('play', report, true);
                document.addEventListener('pause', report, true);
                document.addEventListener('ended', report, true);
                setInterval(report, 1000);
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(videoPlaybackScript)

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

        self.init(url: url, configuration: config, pipHandler: handler, videoHandler: videoHandler)
        webView.load(URLRequest(url: url))
        loadFavicon()
    }

    /// Used for popups (`target="_blank"`/`window.open()`): WebKit requires
    /// reusing the SAME configuration it hands to `createWebViewWith` (it
    /// already carries the opener's process group/content-blocker/script
    /// setup), and loads the popup's own navigation into the returned
    /// webView itself — so we must not call `load` again here.
    convenience init(popupConfiguration configuration: WKWebViewConfiguration) {
        self.init(url: URL(string: "about:blank")!, configuration: configuration, pipHandler: nil, videoHandler: nil)
    }

    private init(
        url: URL,
        configuration: WKWebViewConfiguration,
        pipHandler: PiPExitMessageHandler?,
        videoHandler: VideoPlaybackMessageHandler?
    ) {
        self.url = url
        self.title = url.host ?? "New Tab"

        let web = SwipeAwareWebView(frame: .zero, configuration: configuration)
        web.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
        // Using our own swipe overlay (below) instead of WebKit's built-in
        // swipe animation, which isn't publicly customizable at all.
        web.allowsBackForwardNavigationGestures = false
        self.webView = web

        web.onSwipeProgress = { [weak self] progress, isBack in
            self?.swipeProgress = progress
            self?.swipeIsBack = isBack
        }
        web.onSwipeCommitted = { [weak self] _ in
            self?.swipeProgress = 0
        }

        let coordinator = WebViewCoordinator(tab: self)
        web.navigationDelegate = coordinator
        web.uiDelegate = coordinator
        self.coordinator = coordinator

        pipHandler?.tab = self
        self.pipMessageHandler = pipHandler

        videoHandler?.tab = self
        self.videoPlaybackMessageHandler = videoHandler

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

        // WKWebView updates its back-forward list asynchronously — reading
        // canGoBack/canGoForward from navigation delegate callbacks (as
        // didStartProvisionalNavigation/didFinish used to) can catch it
        // before that update lands, leaving the back button looking
        // disabled right after a navigation that should have enabled it.
        // Observing the properties directly is the reliable way to catch
        // the change whenever it actually happens.
        canGoBackObservation = web.observe(\.canGoBack, options: [.new]) { [weak self] _, change in
            guard let canGoBack = change.newValue else { return }
            DispatchQueue.main.async {
                self?.canGoBack = canGoBack
            }
        }
        canGoForwardObservation = web.observe(\.canGoForward, options: [.new]) { [weak self] _, change in
            guard let canGoForward = change.newValue else { return }
            DispatchQueue.main.async {
                self?.canGoForward = canGoForward
            }
        }
        estimatedProgressObservation = web.observe(\.estimatedProgress, options: [.new]) { [weak self] _, change in
            guard let progress = change.newValue else { return }
            DispatchQueue.main.async {
                self?.loadingProgress = progress
            }
        }
    }

    /// Reads the page's declared `<meta name="theme-color">`, if any, to
    /// color the loading bar like the site's own chrome instead of a fixed
    /// accent color.
    func loadThemeColor() {
        let script = """
        (() => {
            const el = document.querySelector('meta[name="theme-color"]');
            return el ? el.content : null;
        })();
        """
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self else { return }
            guard let value = result as? String, let color = Color(cssColor: value) else {
                self.themeColor = nil
                return
            }
            if color.isNearWhite {
                // A near-white theme-color (e.g. YouTube's own light
                // toolbar) would barely show up on our dark chrome, so use
                // a dark bar instead of the site's actual (washed-out) color.
                self.themeColor = Color(white: 0.15)
            } else if color.isDistinctColor {
                self.themeColor = color
            } else {
                self.themeColor = nil
            }
        }
    }

    /// Reads the favicon the page itself declares (`<link rel="icon">` and
    /// friends) rather than guessing one from the domain alone — a
    /// domain-only lookup (e.g. Google's s2/favicons service) can't tell
    /// mail.google.com's Gmail icon apart from google.com's, since it has no
    /// way to know what a specific page actually points to.
    func loadFavicon() {
        guard let host = url.host, host != faviconHost else { return }
        faviconHost = host

        let script = """
        (() => {
            const selectors = [
                'link[rel="icon"]',
                'link[rel="shortcut icon"]',
                'link[rel="apple-touch-icon"]',
                'link[rel="apple-touch-icon-precomposed"]'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.href) return el.href;
            }
            return null;
        })();
        """
        webView.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self else { return }
            if let href = result as? String, let iconURL = URL(string: href) {
                self.fetchFavicon(from: iconURL, fallbackHost: host)
            } else if let rootIconURL = URL(string: "https://\(host)/favicon.ico") {
                self.fetchFavicon(from: rootIconURL, fallbackHost: host)
            }
        }
    }

    private func fetchFavicon(from iconURL: URL, fallbackHost: String) {
        URLSession.shared.dataTask(with: iconURL) { [weak self] data, response, _ in
            guard let self else { return }
            let succeeded = (response as? HTTPURLResponse).map { $0.statusCode == 200 } ?? true
            if succeeded, let data, let image = NSImage(data: data) {
                Task { @MainActor in self.faviconImage = image }
            } else {
                Task { @MainActor in self.fetchFallbackFavicon(forHost: fallbackHost) }
            }
        }.resume()
    }

    private func fetchFallbackFavicon(forHost host: String) {
        guard let iconURL = URL(string: "https://www.google.com/s2/favicons?sz=64&domain=\(host)") else { return }
        URLSession.shared.dataTask(with: iconURL) { [weak self] data, _, _ in
            guard let self, let data, let image = NSImage(data: data) else { return }
            Task { @MainActor in self.faviconImage = image }
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
        persistZoom()
    }

    func zoomOut() {
        zoomLevel = max(zoomLevel - 0.05, 0.25)
        webView.pageZoom = zoomLevel
        persistZoom()
    }

    func resetZoom() {
        zoomLevel = 1.0
        webView.pageZoom = zoomLevel
        persistZoom()
    }

    private func persistZoom() {
        guard let host = url.host else { return }
        ZoomStore.setZoom(zoomLevel, for: host)
    }

    /// Applies whatever zoom level was last saved for this host (or the
    /// default if none), called whenever a navigation lands on a new host —
    /// so a site you've zoomed once stays zoomed on future visits.
    fileprivate func applyStoredZoom(for host: String?) {
        guard host != zoomHost else { return }
        zoomHost = host
        let stored = host.flatMap { ZoomStore.zoom(for: $0) } ?? 1.0
        zoomLevel = stored
        webView.pageZoom = stored
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

@MainActor
private final class PiPExitMessageHandler: NSObject, WKScriptMessageHandler {
    weak var tab: BrowserTab?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let tab else { return }
        PiPManager.shared.clearPiPState(for: tab.id)
        tab.onPiPExited?()
    }
}

@MainActor
private final class VideoPlaybackMessageHandler: NSObject, WKScriptMessageHandler {
    weak var tab: BrowserTab?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Bool] else { return }
        tab?.hasPlayingVideo = body["video"] ?? false
        tab?.isPlayingMedia = body["media"] ?? false
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
