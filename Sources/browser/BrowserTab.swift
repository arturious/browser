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
    /// Shows this tab above the sidebar's "+" button instead of in the
    /// regular scrolling tab list — see `BrowserViewModel.togglePin`.
    @Published var isPinned: Bool = false
    /// The `url` this tab had at the moment it was pinned — frozen there
    /// regardless of any navigation afterward, since `reloadIfUnloaded()`
    /// always returns a pinned tab to *this* address specifically, not
    /// wherever it happened to be sitting right before it got unloaded.
    /// `nil` while unpinned.
    var pinnedURL: URL?
    /// The page title at the same moment `pinnedURL` was captured — used
    /// instead of just `pinnedURL.host` when snapping back on `unload()`,
    /// since the real title (e.g. a GitHub repo page's title, not just
    /// "github.com") is what the sidebar tooltip should actually show.
    var pinnedTitle: String?
    /// The favicon at the same moment `pinnedURL` was captured — restored
    /// on `unload()` just like `pinnedTitle`, instead of re-deriving one
    /// from `pinnedURL`'s domain (which can be a different icon than the
    /// specific page had, e.g. a subdomain or path-specific favicon).
    var pinnedFavicon: NSImage?
    /// True after `unload()` — the page itself has been unloaded (frees its
    /// memory/network resources) but the tab and its `url` are kept around,
    /// unlike closing a regular tab. `reloadIfUnloaded()` restores it.
    @Published var isUnloaded: Bool = false
    /// Stamped whenever this tab becomes the active one (see
    /// `BrowserViewModel.activateTab`) — while it's inactive, this is
    /// effectively "the last time it was actually looked at", which is what
    /// `BrowserViewModel`'s idle-suspend timer measures against to decide
    /// whether to `unload()` it.
    var lastAccessedAt = Date()

    /// Implicitly-unwrapped rather than a plain `let` so `recreateWebView()`
    /// can replace it after a full teardown (see `unload()`) — every use
    /// site still just sees a plain `WKWebView`.
    private(set) var webView: WKWebView!
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
    /// True once this tab's current `webView.configuration.userContentController`
    /// was registered with `AdBlockManager` by *this* tab (via
    /// `makeStandardConfiguration()`) — false for a popup tab, which is
    /// handed the SAME configuration/controller its opener already
    /// registered (WebKit requires reusing it). Guards `unregister()` calls
    /// so closing/unloading a popup never strips ad-block registration out
    /// from under its still-open opener, which shares that same controller.
    private(set) var ownsRegisteredController = false

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

    /// `deferLoad: true` creates the tab (and its WKWebView/sidebar entry)
    /// without actually navigating anywhere — used for session-restored
    /// tabs that aren't the active one, so restoring many tabs at launch
    /// doesn't fire off that many simultaneous page loads at once (each
    /// spinning up its own WebContent process right away). The deferred
    /// page loads lazily via `reloadIfUnloaded()` the first time the tab is
    /// actually selected — the same mechanism a pinned tab already uses
    /// after `unload()`.
    convenience init(url: URL, deferLoad: Bool = false) {
        let (config, handler, videoHandler) = Self.makeStandardConfiguration()
        self.init(url: url, configuration: config, pipHandler: handler, videoHandler: videoHandler)
        if deferLoad {
            isUnloaded = true
            if let host = url.host {
                faviconHost = host
                fetchFallbackFavicon(forHost: host)
            }
        } else {
            webView.load(URLRequest(url: url))
            loadFavicon()
        }
    }

    /// Builds the configuration (media/PiP/fullscreen preferences, injected
    /// scripts, ad-block) shared by every regular (non-popup) tab — pulled
    /// out of `init` so `recreateWebView()` can build a fresh one too.
    private static func makeStandardConfiguration() -> (WKWebViewConfiguration, PiPExitMessageHandler, VideoPlaybackMessageHandler) {
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

        // Without this, the page's own `element.requestFullscreen()` (used
        // by e.g. YouTube's fullscreen button, not just a plain <video>'s
        // native controls) silently does nothing in WKWebView — this is a
        // real public API (macOS 12.3+), unlike the PiP preference above.
        config.preferences.isElementFullscreenEnabled = true

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
                // paused themselves should stay paused. Tracking "was it
                // playing" via play/pause event listeners (purely reactive,
                // no polling loop) rather than sampling on a timer avoids
                // any background CPU cost at all while just sitting on a
                // page with a video, whether or not PiP is ever used.
                let isPlaying = false;
                document.addEventListener('play', (e) => {
                    if (e.target.tagName === 'VIDEO') isPlaying = true;
                }, true);
                document.addEventListener('pause', (e) => {
                    if (e.target.tagName === 'VIDEO') isPlaying = false;
                }, true);

                document.addEventListener('leavepictureinpicture', (event) => {
                    const video = event.target;
                    const wasPlaying = isPlaying;
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
                    // The play/pause/ended listeners below already catch
                    // transitions instantly — this polling loop is just a
                    // safety net for players that don't fire those reliably,
                    // so it only needs to be tight while something is
                    // actually playing (to catch it stopping promptly);
                    // otherwise backing off to 4s avoids scanning the whole
                    // DOM every second on every tab, playing or not.
                    setTimeout(report, mediaState ? 1000 : 4000);
                }
                document.addEventListener('play', report, true);
                document.addEventListener('pause', report, true);
                document.addEventListener('ended', report, true);
                setTimeout(report, 1000);
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

        return (config, handler, videoHandler)
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
        // `webView` is nil (IUO) at this point — fine, since every other
        // stored property already has a value (defaults or the two above),
        // which is all definite-initialization needs before `self` can be
        // used inside setUpWebView below.
        setUpWebView(configuration: configuration, pipHandler: pipHandler, videoHandler: videoHandler)
    }

    /// Creates and wires up a fresh `WKWebView` — the actual per-instance
    /// setup shared by initial construction and `recreateWebView()`.
    private func setUpWebView(
        configuration: WKWebViewConfiguration,
        pipHandler: PiPExitMessageHandler?,
        videoHandler: VideoPlaybackMessageHandler?
    ) {
        // Only the standard (non-popup) configuration path passes real
        // handlers here (see makeStandardConfiguration/its two callers) —
        // a popup's `nil, nil` means it's reusing its opener's already-
        // registered configuration, not a fresh one this tab owns.
        ownsRegisteredController = pipHandler != nil

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
                // Ignore the `about:blank` navigation `unload()` itself
                // makes — it must not clobber the real `url` a pinned tab
                // is remembering while unloaded, which `reloadIfUnloaded()`
                // needs to navigate back to.
                guard let self, !self.isUnloaded else { return }
                self.url = newURL
            }
        }

        // Same reasoning as urlObservation: SPAs update document.title on
        // in-page route changes without a full navigation, so the tab-hover
        // tooltip needs its own live source instead of relying on didFinish.
        titleObservation = web.observe(\.title, options: [.new]) { [weak self] _, change in
            guard let newTitle = change.newValue ?? nil, !newTitle.isEmpty else { return }
            DispatchQueue.main.async {
                guard let self, !self.isUnloaded else { return }
                self.title = newTitle
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

    /// Tears down the current `WKWebView` entirely (not just navigating it
    /// away) and replaces it with a fresh one, releasing the old page's
    /// whole renderer process rather than just the memory of whatever page
    /// it had loaded. Used by `unload()`; the new WKWebView stays idle
    /// (nothing loaded) until `reloadIfUnloaded()` navigates it.
    private func recreateWebView() {
        webView.stopLoading()
        webView.pauseAllMediaPlayback(completionHandler: nil)
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        if ownsRegisteredController {
            AdBlockManager.shared.unregister(webView.configuration.userContentController)
        }
        urlObservation?.invalidate()
        titleObservation?.invalidate()
        canGoBackObservation?.invalidate()
        canGoForwardObservation?.invalidate()
        estimatedProgressObservation?.invalidate()

        let (configuration, pipHandler, videoHandler) = Self.makeStandardConfiguration()
        setUpWebView(configuration: configuration, pipHandler: pipHandler, videoHandler: videoHandler)
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

    /// "Closing" a pinned tab — unlike a regular close, this keeps the tab
    /// (and its `url`, so the sidebar icon/favicon/title stay put) but
    /// frees the actual page's memory by navigating its WKWebView away.
    func unload() {
        guard !isUnloaded else { return }
        isUnloaded = true
        // Snap `url`/`title` (and re-derive the favicon) back to the pinned
        // address right away, rather than leaving whatever page/title was
        // showing right before close lingering in the sidebar tooltip until
        // the tab is actually reselected and reloaded.
        if let pinnedURL, pinnedURL != url {
            url = pinnedURL
            title = pinnedTitle ?? pinnedURL.host ?? title
            if let pinnedFavicon {
                faviconImage = pinnedFavicon
                faviconHost = pinnedURL.host
            } else if let host = pinnedURL.host {
                // No favicon was captured at pin time — the page itself is
                // being torn down, so `loadFavicon()` (which needs to run
                // JS on it) isn't reliable here; fall back to the
                // domain-only favicon service instead.
                faviconHost = host
                fetchFallbackFavicon(forHost: host)
            }
        }
        recreateWebView()
    }

    /// Restores a tab unloaded via `unload()` by reloading its original
    /// `url` — called when the tab is selected again.
    func reloadIfUnloaded() {
        guard isUnloaded else { return }
        isUnloaded = false
        let target = pinnedURL ?? url
        url = target
        webView.load(URLRequest(url: target))
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
    func applyStoredZoom(for host: String?) {
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
