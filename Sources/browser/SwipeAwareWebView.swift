import AppKit
import WebKit

/// A WKWebView that reports horizontal trackpad swipes instead of using
/// WebKit's own back/forward swipe animation, so the app can show its own
/// transition instead.
final class SwipeAwareWebView: WKWebView {
    /// `progress` is 0...1 (how far through the gesture), `isBack` is true
    /// for a swipe-right (back) gesture, false for swipe-left (forward).
    var onSwipeProgress: ((_ progress: CGFloat, _ isBack: Bool) -> Void)?
    var onSwipeCommitted: ((_ isBack: Bool) -> Void)?

    private var accumulatedDeltaX: CGFloat = 0
    private var isTrackingHorizontalSwipe = false
    private let threshold: CGFloat = 120

    override func scrollWheel(with event: NSEvent) {
        switch event.phase {
        case .began:
            accumulatedDeltaX = 0
            isTrackingHorizontalSwipe = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY)

        case .changed:
            if isTrackingHorizontalSwipe {
                accumulatedDeltaX += event.scrollingDeltaX
                let isBack = accumulatedDeltaX > 0
                if (isBack && canGoBack) || (!isBack && canGoForward) {
                    let progress = min(abs(accumulatedDeltaX) / threshold, 1.0)
                    onSwipeProgress?(progress, isBack)
                    return
                }
            }

        case .ended, .cancelled:
            if isTrackingHorizontalSwipe {
                let isBack = accumulatedDeltaX > 0
                let progress = min(abs(accumulatedDeltaX) / threshold, 1.0)
                isTrackingHorizontalSwipe = false
                accumulatedDeltaX = 0
                if progress >= 1.0, (isBack && canGoBack) || (!isBack && canGoForward) {
                    if isBack {
                        goBack()
                    } else {
                        goForward()
                    }
                    onSwipeCommitted?(isBack)
                } else {
                    onSwipeProgress?(0, isBack)
                }
                return
            }

        default:
            break
        }
        super.scrollWheel(with: event)
    }
}
