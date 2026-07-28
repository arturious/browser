import SwiftUI

@MainActor
final class BrowserViewModel: ObservableObject {
    @Published var tabs: [BrowserTab] = []
    @Published var activeTabId: UUID?
    @Published var addressInput: String = ""
    @Published var addressBarFocusTrigger: Bool = false
    @Published var isCreatingNewTab: Bool = false

    init() {
        restoreSession()
    }

    var activeTab: BrowserTab? {
        tabs.first { $0.id == activeTabId }
    }

    private func restoreSession() {
        guard let session = SessionStore.load() else { return }
        for url in session.urls {
            let tab = BrowserTab(url: url)
            wireUpPopupHandling(for: tab)
            wireUpPiPHandling(for: tab)
            wireUpNewTabHandling(for: tab)
            tabs.append(tab)
        }
        let activeIndex = session.activeIndex.flatMap { tabs.indices.contains($0) ? $0 : nil } ?? 0
        if tabs.indices.contains(activeIndex) {
            activateTab(tabs[activeIndex])
        }
    }

    /// Saves the currently open tabs' URLs (and which one is active) so they
    /// can be restored on the next launch.
    func persistSession() {
        let activeIndex = activeTabId.flatMap { id in tabs.firstIndex { $0.id == id } }
        SessionStore.save(urls: tabs.map { $0.url }, activeIndex: activeIndex)
    }

    func addNewTab(url: URL = URL(string: "https://www.google.com")!) {
        let tab = BrowserTab(url: url)
        wireUpPopupHandling(for: tab)
        wireUpPiPHandling(for: tab)
        wireUpNewTabHandling(for: tab)
        tabs.insert(tab, at: 0)
        selectTab(tab)
        persistSession()
    }

    /// Wires Cmd+click on a link (the standard "open in a new tab" gesture)
    /// to actually open a new tab — WKWebView doesn't handle this itself.
    private func wireUpNewTabHandling(for tab: BrowserTab) {
        tab.onOpenInNewTab = { [weak self] url in
            self?.addNewTab(url: url)
        }
    }

    /// Wires `target="_blank"`/`window.open()` handling: without this,
    /// WebKit silently drops those navigations (some "Download" buttons
    /// route through a popup before the actual file response, so this was
    /// why those downloads never even reached our navigation delegate).
    private func wireUpPopupHandling(for tab: BrowserTab) {
        tab.onCreatePopup = { [weak self, weak tab] configuration, _ in
            guard let self else { return nil }
            let popupTab = BrowserTab(popupConfiguration: configuration)
            self.wireUpPopupHandling(for: popupTab)
            self.wireUpPiPHandling(for: popupTab)
            self.wireUpNewTabHandling(for: popupTab)
            let insertIndex = tab.flatMap { openerTab in self.tabs.firstIndex(where: { $0 === openerTab }) } ?? 0
            self.tabs.insert(popupTab, at: insertIndex)
            self.selectTab(popupTab)
            return popupTab.webView
        }
    }

    func startNewTab() {
        addressInput = ""
        isCreatingNewTab = true
        addressBarFocusTrigger.toggle()
    }

    func cancelNewTab() {
        guard isCreatingNewTab else { return }
        isCreatingNewTab = false
        addressInput = activeTab?.url.absoluteString ?? ""
    }

    func closeTab(_ tab: BrowserTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        PiPManager.shared.exitPiPIfShowing(tab.id, webView: tab.webView)
        tab.webView.pauseAllMediaPlayback(completionHandler: nil)
        tab.webView.stopLoading()
        tab.webView.navigationDelegate = nil
        tab.webView.removeFromSuperview()
        tabs.remove(at: index)
        if activeTabId == tab.id {
            if tabs.isEmpty {
                activeTabId = nil
                addressInput = ""
            } else {
                selectTab(tabs[min(index, tabs.count - 1)])
            }
        }
        persistSession()
    }

    func closeTab(id: UUID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        closeTab(tab)
    }

    func selectTab(_ tab: BrowserTab) {
        if PiPManager.shared.isPiP(tab.id) {
            PiPManager.shared.exitPiPIfShowing(tab.id, webView: tab.webView)
        }
        activateTab(tab)
    }

    /// Wires up the return-to-tab behavior for whenever this tab's video
    /// leaves Picture-in-Picture (however PiP was entered — switching tabs
    /// no longer does this automatically, that's a manual action now).
    private func wireUpPiPHandling(for tab: BrowserTab) {
        tab.onPiPExited = { [weak self, weak tab] in
            guard let self, let tab else { return }
            NSApp.activate(ignoringOtherApps: true)
            NSApp.windows.first { $0.identifier == AppDelegate.mainWindowIdentifier }?.makeKeyAndOrderFront(nil)
            self.selectTab(tab)
        }
    }

    private func activateTab(_ tab: BrowserTab) {
        activeTabId = tab.id
        addressInput = tab.url.absoluteString
        isCreatingNewTab = false
        persistSession()
    }

    func selectTab(id: UUID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        selectTab(tab)
    }

    func navigateToAddressInput() {
        let input = addressInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else {
            isCreatingNewTab = false
            return
        }

        let resolvedURL: URL
        if let url = URL(string: input), url.scheme != nil {
            resolvedURL = url
        } else if input.contains(".") && !input.contains(" ") {
            resolvedURL = URL(string: "https://\(input)")!
        } else {
            let query = input.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? input
            resolvedURL = URL(string: "https://www.google.com/search?q=\(query)")!
        }

        if isCreatingNewTab {
            isCreatingNewTab = false
            addNewTab(url: resolvedURL)
        } else {
            guard let tab = activeTab else { return }
            tab.navigate(to: resolvedURL)
        }
    }
}
