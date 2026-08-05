import SwiftUI
import WebKit

struct WebViewContainer: NSViewRepresentable {
    @ObservedObject var tab: BrowserTab
    /// Whether this is the currently-selected tab.
    let isActive: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        mount(tab.webView, in: container)
        applyActiveState(context: context)
        return container
    }

    // `makeNSView`'s returned view is only created once per SwiftUI
    // identity (here, the tab's row in the ForEach — keyed by `tab.id`,
    // which stays the same even after `recreateWebView()` swaps in a brand
    // new WKWebView instance for a pinned tab reloading from `unload()`).
    // A plain `WKWebView` return type has no hook to replace itself later,
    // so this wraps it in a container view whose subview gets swapped out
    // here whenever the `webView` this struct holds is a different
    // instance than what's currently mounted. `@ObservedObject var tab`
    // also means this runs on every change to the tab's own published
    // state (not just isActive toggling), which is what lets a background
    // tab's video ending get noticed and suspended below without needing
    // to wait for a tab switch.
    func updateNSView(_ container: NSView, context: Context) {
        if container.subviews.first !== tab.webView {
            mount(tab.webView, in: container)
        }
        applyActiveState(context: context)
    }

    private func mount(_ webView: WKWebView, in container: NSView) {
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
    }

    /// Hides every non-active tab's `WKWebView` (rather than merely
    /// `opacity(0)`-ing it) and explicitly suspends its media/rendering via
    /// the public `setAllMediaPlaybackSuspended` API — window-level
    /// `NSWindow.occlusionState` can't distinguish between tabs sharing the
    /// same window, so WebKit's own background-tab throttling never
    /// otherwise engages for a backgrounded tab in a single-window,
    /// multi-tab app like this one. Left exempt while `isPlayingMedia` is
    /// true so a background music/video tab keeps playing — the same
    /// exemption `BrowserViewModel`'s idle-unload timer already makes —
    /// rather than silently muting audio the user backgrounded on purpose.
    private func applyActiveState(context: Context) {
        tab.webView.isHidden = !isActive
        let shouldSuspend = !isActive && !tab.isPlayingMedia
        guard context.coordinator.lastSuspendedState != shouldSuspend else { return }
        context.coordinator.lastSuspendedState = shouldSuspend
        tab.webView.setAllMediaPlaybackSuspended(shouldSuspend, completionHandler: nil)
    }

    final class Coordinator {
        var lastSuspendedState: Bool?
    }
}
