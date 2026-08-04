import AppKit
import WebKit

@MainActor
final class PiPExitMessageHandler: NSObject, WKScriptMessageHandler {
    weak var tab: BrowserTab?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let tab else { return }
        PiPManager.shared.clearPiPState(for: tab.id)
        tab.onPiPExited?()
    }
}

@MainActor
final class VideoPlaybackMessageHandler: NSObject, WKScriptMessageHandler {
    weak var tab: BrowserTab?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Bool] else { return }
        tab?.hasPlayingVideo = body["video"] ?? false
        tab?.isPlayingMedia = body["media"] ?? false
    }
}
