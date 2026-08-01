import SwiftUI
import WebKit

struct WebViewContainer: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        mount(webView, in: container)
        return container
    }

    // `makeNSView`'s returned view is only created once per SwiftUI
    // identity (here, the tab's row in the ForEach — keyed by `tab.id`,
    // which stays the same even after `recreateWebView()` swaps in a brand
    // new WKWebView instance for a pinned tab reloading from `unload()`).
    // A plain `WKWebView` return type has no hook to replace itself later,
    // so this wraps it in a container view whose subview gets swapped out
    // here whenever the `webView` this struct holds is a different
    // instance than what's currently mounted.
    func updateNSView(_ container: NSView, context: Context) {
        guard container.subviews.first !== webView else { return }
        mount(webView, in: container)
    }

    private func mount(_ webView: WKWebView, in container: NSView) {
        container.subviews.forEach { $0.removeFromSuperview() }
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
    }
}
