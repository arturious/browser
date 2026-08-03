import SwiftUI

@MainActor
final class BrowserViewModel: ObservableObject {
    @Published var tabs: [BrowserTab] = []
    @Published var activeTabId: UUID?
    @Published var addressInput: String = ""
    @Published var addressBarFocusTrigger: Bool = false
    @Published var isCreatingNewTab: Bool = false

    /// How long a background tab can sit untouched before it's unloaded to
    /// free its WKWebView/renderer process — same mechanism a pinned tab
    /// already uses when explicitly closed (`BrowserTab.unload()`), just
    /// triggered by idle time instead of an explicit close. Tabs playing
    /// audio/video, and the active tab, are always exempt.
    private let idleSuspendTimeout: TimeInterval = 20 * 60
    private var idleSuspendTimer: Timer?

    init() {
        restoreSession()
        idleSuspendTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.suspendIdleTabs() }
        }
    }

    private func suspendIdleTabs() {
        let now = Date()
        for tab in tabs {
            guard tab.id != activeTabId,
                  !tab.isUnloaded,
                  !tab.hasPlayingVideo,
                  !tab.isPlayingMedia,
                  now.timeIntervalSince(tab.lastAccessedAt) > idleSuspendTimeout
            else { continue }
            tab.unload()
        }
    }

    var activeTab: BrowserTab? {
        tabs.first { $0.id == activeTabId }
    }

    private func restoreSession() {
        guard let session = SessionStore.load() else { return }
        // Known up front so only the tab that's about to become active
        // loads for real below — every other restored tab defers its load
        // until actually selected, instead of every tab from the last
        // session firing off its own page load (and WebContent process)
        // simultaneously at launch.
        let activeIndex = session.activeIndex.flatMap { session.tabs.indices.contains($0) ? $0 : nil } ?? 0
        for (index, sessionTab) in session.tabs.enumerated() {
            guard let url = URL(string: sessionTab.url) else { continue }
            let pinnedURL = sessionTab.pinnedURL.flatMap(URL.init(string:))
            // A pinned tab always reopens at its frozen pinned address, not
            // wherever it was last navigated to before quitting.
            let tab = BrowserTab(
                url: sessionTab.isPinned ? (pinnedURL ?? url) : url,
                deferLoad: index != activeIndex
            )
            if sessionTab.isPinned {
                tab.isPinned = true
                tab.pinnedURL = pinnedURL ?? url
                tab.pinnedTitle = sessionTab.pinnedTitle
            }
            wireUpPopupHandling(for: tab)
            wireUpPiPHandling(for: tab)
            wireUpNewTabHandling(for: tab)
            tabs.append(tab)
        }
        if tabs.indices.contains(activeIndex) {
            activateTab(tabs[activeIndex])
        }
    }

    /// Saves the currently open tabs (and which one is active) so they can
    /// be restored on the next launch.
    func persistSession() {
        let activeIndex = activeTabId.flatMap { id in tabs.firstIndex { $0.id == id } }
        let sessionTabs = tabs.map { tab in
            SessionTab(
                url: tab.url.absoluteString,
                isPinned: tab.isPinned,
                pinnedURL: tab.pinnedURL?.absoluteString,
                pinnedTitle: tab.pinnedTitle
            )
        }
        SessionStore.save(tabs: sessionTabs, activeIndex: activeIndex)
    }

    func addNewTab(url: URL = URL(string: "https://www.google.com")!, activate: Bool = true) {
        let tab = BrowserTab(url: url)
        wireUpPopupHandling(for: tab)
        wireUpPiPHandling(for: tab)
        wireUpNewTabHandling(for: tab)
        tabs.insert(tab, at: 0)
        if activate {
            selectTab(tab)
        }
        persistSession()
    }

    /// Wires Cmd+click on a link (the standard "open in a new tab" gesture)
    /// to actually open a new tab in the background — WKWebView doesn't
    /// handle this itself, and a Cmd+click shouldn't jump you away from the
    /// page you were reading.
    private func wireUpNewTabHandling(for tab: BrowserTab) {
        tab.onOpenInNewTab = { [weak self] url in
            self?.addNewTab(url: url, activate: false)
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

        // A pinned tab's "close" just unloads the page instead of removing
        // the tab — the sidebar icon (and its remembered url) stays put.
        if tab.isPinned {
            tab.unload()
            if activeTabId == tab.id {
                if let next = tabs.first(where: { $0.id != tab.id }) {
                    selectTab(next)
                } else {
                    activeTabId = nil
                    addressInput = ""
                }
            }
            persistSession()
            return
        }

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

    /// Pinning moves the tab to the very front of `tabs` (rendered above
    /// the sidebar's "+" button — see ContentView.sidebar); unpinning
    /// leaves it wherever it already is, since there's no other ordering
    /// to restore it to.
    func togglePin(_ tab: BrowserTab) {
        tab.isPinned.toggle()
        if tab.isPinned {
            tab.pinnedURL = tab.url
            tab.pinnedTitle = tab.title
            tab.pinnedFavicon = tab.faviconImage
            if let index = tabs.firstIndex(where: { $0.id == tab.id }) {
                tabs.move(fromOffsets: IndexSet(integer: index), toOffset: 0)
            }
        } else {
            tab.pinnedURL = nil
            tab.pinnedTitle = nil
            tab.pinnedFavicon = nil
        }
        persistSession()
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
        tab.reloadIfUnloaded()
        tab.lastAccessedAt = Date()
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
