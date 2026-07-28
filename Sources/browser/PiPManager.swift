import AppKit
import WebKit

/// Uses the standard HTML Picture-in-Picture API (`video.requestPictureInPicture()`)
/// so playing video keeps playing in a native floating window when the user
/// switches away from its tab.
@MainActor
final class PiPManager {
    static let shared = PiPManager()

    private var pipTabId: UUID?

    func isPiP(_ tabId: UUID) -> Bool { pipTabId == tabId }

    /// `completion` always fires (whether PiP actually started or not) so the
    /// caller can defer switching the visible tab until the request has been
    /// issued — requestPictureInPicture() throws NotSupportedError once the
    /// page is no longer the visible/foreground tab, so the tab switch must
    /// not happen first.
    func enterPiP(for tab: BrowserTab, completion: @escaping () -> Void) {
        guard pipTabId == nil else {
            completion()
            return
        }

        let script = """
        const v = document.querySelector('video');
        if (!v) return 'no-video-element';
        if (!document.pictureInPictureEnabled) return 'pip-disabled';
        if (document.pictureInPictureElement) return 'already-pip';
        v.disablePictureInPicture = false;
        try {
            await v.requestPictureInPicture();
            return 'ok';
        } catch (e) {
            return 'error: ' + e.name + ': ' + e.message;
        }
        """
        let tabId = tab.id
        tab.webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            if case .success(let value) = result, (value as? String) == "ok" {
                self?.pipTabId = tabId
            }
            completion()
        }
    }

    func togglePiP(for tab: BrowserTab) {
        if isPiP(tab.id) {
            exitPiPIfShowing(tab.id, webView: tab.webView)
        } else {
            enterPiP(for: tab) {}
        }
    }

    func exitPiPIfShowing(_ tabId: UUID, webView: WKWebView) {
        guard pipTabId == tabId else { return }
        webView.evaluateJavaScript(
            "if (document.pictureInPictureElement) { document.exitPictureInPicture(); }"
        )
        pipTabId = nil
    }

    /// Marks PiP as no longer showing for this tab without touching the
    /// page — used when the page itself already told us PiP ended (the
    /// system window's own close/return controls), so there's nothing left
    /// to tear down beyond our own bookkeeping.
    func clearPiPState(for tabId: UUID) {
        guard pipTabId == tabId else { return }
        pipTabId = nil
    }
}
