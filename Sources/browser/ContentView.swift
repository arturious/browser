import SwiftUI
import AppKit

struct ContentView: View {
    @StateObject private var viewModel = BrowserViewModel()
    @State private var isSidebarVisible = true
    @State private var isAddressHovering = false
    @State private var isEditingAddress = false
    @State private var hoveredTabInfo: HoveredTabInfo?
    @ObservedObject private var downloadManager = DownloadManager.shared
    @State private var downloadsIconFrame: CGRect = .zero
    @State private var activeFlyRequests: [DownloadFlyRequest] = []
    @State private var isDownloadsListShowing = false
    @State private var historyIconFrame: CGRect = .zero
    @State private var isHistoryListShowing = false

    var body: some View {
        ZStack {
            // Must stay unclipped at this top level — nesting it inside a
            // `.background()` that itself gets `.clipShape()`'d (as the
            // content panel below does) forces SwiftUI to composite it
            // through an offscreen layer, which breaks NSVisualEffectView's
            // `.behindWindow` blending mode entirely (renders solid black
            // instead of blurring what's behind the window). Left plain
            // (untinted) here — the thin margin this shows through (from
            // the content panel's own `.padding(8)` below) is meant to look
            // like plain blur, distinct from that panel's own tinted blur.
            VisualEffectBlur()

            VStack(spacing: 0) {
                topBar
                HStack(spacing: 0) {
                    if isSidebarVisible {
                        sidebar
                            .transition(.move(edge: .leading))
                    }
                    ZStack {
                        Color.black
                        // All tabs stay mounted (not just the active one) so
                        // their WKWebView never loses its window entirely.
                        // Native PiP's "return to tab" button needs
                        // `webView.window` to be non-nil to bring the right
                        // window forward — a fully detached background tab
                        // has no window, so that button silently does nothing.
                        ForEach(viewModel.tabs) { tab in
                            WebViewContainer(webView: tab.webView)
                                .opacity(tab.id == viewModel.activeTabId ? 1 : 0)
                                .allowsHitTesting(tab.id == viewModel.activeTabId)
                        }
                        if let tab = viewModel.activeTab {
                            SwipeNavigationOverlay(tab: tab)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.leading, isSidebarVisible ? 0 : 8)
                    .padding(.trailing, 8)
                    .padding(.bottom, 8)
                }
                .frame(maxHeight: .infinity)
            }
            .overlay(alignment: .top) {
                if let tab = viewModel.activeTab {
                    PageLoadingBar(tab: tab)
                        .padding(.top, 38)
                }
            }
            .background(Color.black.opacity(0.45))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(8)
        }
        .frame(minWidth: 900, minHeight: 600)
        .preferredColorScheme(.dark)
        .ignoresSafeArea(.all, edges: .top)
        .coordinateSpace(name: "browserRoot")
        .overlay(alignment: .topLeading) {
            if let info = hoveredTabInfo {
                VStack(alignment: .leading, spacing: 1) {
                    Text(info.title)
                        .font(.custom("Verdana", size: 10))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    if info.isPlayingMedia {
                        Text("Playing audio")
                            .font(.custom("Verdana", size: 10))
                            .foregroundColor(Color(white: 0.65))
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(white: 0.12))
                .shadow(color: .black.opacity(0.4), radius: 4, y: 2)
                .fixedSize()
                .offset(x: info.frame.maxX - 10, y: info.frame.minY + 27)
                .allowsHitTesting(false)
                .animation(nil, value: info)
            }
        }
        .onPreferenceChange(HoveredTabKey.self) { hoveredTabInfo = $0 }
        .overlay(alignment: .topLeading) {
            if downloadsIconFrame != .zero {
                ForEach(activeFlyRequests) { request in
                    DownloadFlyOverlay(iconFrame: downloadsIconFrame) {
                        activeFlyRequests.removeAll { $0.id == request.id }
                    }
                }
            }
        }
        .onPreferenceChange(DownloadsIconFrameKey.self) { downloadsIconFrame = $0 }
        .onPreferenceChange(HistoryIconFrameKey.self) { historyIconFrame = $0 }
        .overlay(alignment: .topLeading) {
            if isDownloadsListShowing || isHistoryListShowing {
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onTapGesture {
                        isDownloadsListShowing = false
                        isHistoryListShowing = false
                    }
                    .allowsHitTesting(true)
            }
        }
        .overlay(alignment: .topLeading) {
            if isDownloadsListShowing && downloadsIconFrame != .zero {
                DownloadsListView(manager: downloadManager)
                    .offset(x: downloadsIconFrame.maxX - 280, y: downloadsIconFrame.maxY + 6)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .topTrailing)))
            }
        }
        .overlay(alignment: .topLeading) {
            if isHistoryListShowing && historyIconFrame != .zero {
                HistoryListView()
                    .offset(x: historyIconFrame.maxX - 280, y: historyIconFrame.maxY + 6)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .topTrailing)))
            }
        }
        .onChange(of: downloadManager.flyRequest) { _, newValue in
            if let newValue { activeFlyRequests.append(newValue) }
        }
        .onAppear {
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                handleKeyDown(event)
            }
        }
    }

    private func handleKeyDown(_ event: NSEvent) -> NSEvent? {
        guard event.modifierFlags.contains(.command) else {
            return event
        }
        switch event.charactersIgnoringModifiers {
        case "t":
            viewModel.startNewTab()
            return nil
        case "l":
            guard let tab = viewModel.activeTab else { return event }
            viewModel.addressInput = tab.url.absoluteString
            isEditingAddress = true
            return nil
        case "w":
            guard let tab = viewModel.activeTab else { return event }
            viewModel.closeTab(tab)
            return nil
        case "r":
            guard let tab = viewModel.activeTab else { return event }
            tab.reload()
            return nil
        case "[":
            guard let tab = viewModel.activeTab else { return event }
            tab.goBack()
            return nil
        case "]":
            guard let tab = viewModel.activeTab else { return event }
            tab.goForward()
            return nil
        case "=", "+":
            guard let tab = viewModel.activeTab else { return event }
            tab.zoomIn()
            return nil
        case "-":
            guard let tab = viewModel.activeTab else { return event }
            tab.zoomOut()
            return nil
        case "0":
            guard let tab = viewModel.activeTab else { return event }
            tab.resetZoom()
            return nil
        case "1", "2", "3", "4", "5", "6", "7", "8", "9":
            guard let digit = event.charactersIgnoringModifiers.flatMap({ Int($0) }) else { return event }
            let index = digit - 1
            guard viewModel.tabs.indices.contains(index) else { return event }
            viewModel.selectTab(viewModel.tabs[index])
            return nil
        default:
            return event
        }
    }

    private var topBar: some View {
        ZStack {
            HStack(spacing: 16) {
                HStack(spacing: 0) {
                    ToolbarIconButton(systemName: "sidebar.left") {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            isSidebarVisible.toggle()
                        }
                    }
                    if let tab = viewModel.activeTab {
                        TabNavigationControls(tab: tab)
                    }
                }
                .font(.system(size: 14, weight: .bold))
                .padding(.leading, 12)

                Spacer(minLength: 20)

                HStack(spacing: 4) {
                    HistoryButton(isShowingList: $isHistoryListShowing)
                    DownloadsButton(isShowingList: $isDownloadsListShowing)
                }
                .padding(.trailing, 12)
            }

            if let tab = viewModel.activeTab {
                HStack(spacing: -4) {
                    if viewModel.isCreatingNewTab {
                        NewTabIndicator()
                    } else {
                        LinkCopyButton(tab: tab)
                    }
                    AddressDisplayButton(
                        tab: tab,
                        addressInput: $viewModel.addressInput,
                        isHovering: $isAddressHovering,
                        onSubmit: { viewModel.navigateToAddressInput() },
                        onFocusChange: { editing in
                            isEditingAddress = editing
                            if !editing { viewModel.cancelNewTab() }
                        },
                        isEditing: $isEditingAddress
                    )
                    PiPToggleButton(tab: tab)
                }
                .onChange(of: tab.url) { _, newURL in
                    if !isEditingAddress && !viewModel.isCreatingNewTab {
                        viewModel.addressInput = newURL.absoluteString
                    }
                    viewModel.persistSession()
                }
            } else if viewModel.isCreatingNewTab {
                HStack(spacing: -4) {
                    NewTabIndicator()
                    NewTabAddressField(
                        addressInput: $viewModel.addressInput,
                        onSubmit: { viewModel.navigateToAddressInput() },
                        onFocusChange: { editing in
                            isEditingAddress = editing
                            if !editing { viewModel.cancelNewTab() }
                        }
                    )
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 34)
        .buttonStyle(.borderless)
        // No tint of its own — the single window-wide tint behind
        // everything (see `body` above) already shows through uniformly;
        // adding a second one here just double-stacked with it, mismatching
        // the untinted margin around the rounded content by comparison.
        .background(WindowDragArea())
        .onChange(of: viewModel.addressBarFocusTrigger) { _, _ in
            isEditingAddress = true
        }
    }

    private var sidebar: some View {
        VStack(spacing: 4) {
            ForEach(viewModel.tabs.filter(\.isPinned)) { tab in
                sidebarIcon(for: tab)
            }
            .padding(.top, 8)

            SidebarAddButton {
                viewModel.startNewTab()
            }

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(viewModel.tabs.filter { !$0.isPinned }) { tab in
                        sidebarIcon(for: tab)
                    }
                }
            }
            Spacer()
        }
        .frame(width: 56)
    }

    private func sidebarIcon(for tab: BrowserTab) -> some View {
        let tabId = tab.id
        return SidebarIcon(tab: tab, isActive: tabId == viewModel.activeTabId) {
            isEditingAddress = false
            NSApp.keyWindow?.makeFirstResponder(nil)
            viewModel.selectTab(id: tabId)
        } onClose: {
            viewModel.closeTab(id: tabId)
        } onTogglePin: {
            viewModel.togglePin(tab)
        }
    }
}
