import SwiftUI
import AppKit

private struct HoveredTabInfo: Equatable {
    let title: String
    let isPlayingMedia: Bool
    let frame: CGRect
}

private struct HoveredTabKey: PreferenceKey {
    static let defaultValue: HoveredTabInfo? = nil
    static func reduce(value: inout HoveredTabInfo?, nextValue: () -> HoveredTabInfo?) {
        if let next = nextValue() { value = next }
    }
}

private struct DownloadsIconFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}

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

    var body: some View {
        ZStack {
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
            .background(Color.black)
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
        .overlay(alignment: .topLeading) {
            if isDownloadsListShowing {
                Color.clear
                    .contentShape(Rectangle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onTapGesture { isDownloadsListShowing = false }
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
        .onChange(of: downloadManager.flyRequest) { _, newValue in
            if let newValue { activeFlyRequests.append(newValue) }
        }
        .onAppear {
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
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

                DownloadsButton(isShowingList: $isDownloadsListShowing)
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
                        .padding(.leading, 6)
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
        .background(
            ZStack {
                Color.black
                WindowDragArea()
            }
        )
        .onChange(of: viewModel.addressBarFocusTrigger) { _, _ in
            isEditingAddress = true
        }
    }

    private var sidebar: some View {
        VStack(spacing: 4) {
            SidebarAddButton {
                viewModel.startNewTab()
            }
            .padding(.top, 8)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(viewModel.tabs) { tab in
                        let tabId = tab.id
                        SidebarIcon(tab: tab, isActive: tabId == viewModel.activeTabId) {
                            isEditingAddress = false
                            NSApp.keyWindow?.makeFirstResponder(nil)
                            viewModel.selectTab(id: tabId)
                        } onClose: {
                            viewModel.closeTab(id: tabId)
                        }
                    }
                }
            }
            Spacer()
        }
        .frame(width: 56)
        .background(Color.black)
    }
}

private struct SidebarAddButton: View {
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(Color(red: 0xAC / 255, green: 0xAC / 255, blue: 0xAC / 255))
            .frame(width: 48, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white.opacity(isHovering ? 0.1 : 0))
            )
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .animation(.easeOut(duration: 0.15), value: isHovering)
            .onHover { hovering in
                isHovering = hovering
            }
    }
}

private struct SidebarIcon: View {
    @ObservedObject var tab: BrowserTab
    let isActive: Bool
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        SidebarIconBody(
            faviconImage: tab.faviconImage,
            faviconColor: tab.faviconColor,
            faviconLetter: tab.faviconLetter,
            title: tab.title,
            isActive: isActive,
            isPlayingMedia: tab.isPlayingMedia,
            onSelect: onSelect,
            onClose: onClose
        )
    }
}

// Intentionally holds no reference to BrowserTab: `.onHover` below captures
// this struct's `self` wholesale into a long-lived SwiftUI HoverResponder,
// which can outlive a removed sidebar row if the pointer was over it at
// removal time (e.g. closing a tab via its context menu). Keeping only
// plain values here means a closed tab's BrowserTab/WKWebView can still
// deallocate even if this stale hover responder lingers.
private struct SidebarIconBody: View {
    let faviconImage: NSImage?
    let faviconColor: Color
    let faviconLetter: String
    let title: String
    let isActive: Bool
    let isPlayingMedia: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    @State private var isHovering = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(isActive ? Color.white.opacity(0.15) : Color.white.opacity(isHovering ? 0.1 : 0))
                .frame(width: 48, height: 36)

            ZStack(alignment: .topTrailing) {
                if let image = faviconImage {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 16, height: 16)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                } else {
                    Circle()
                        .fill(faviconColor)
                        .frame(width: 16, height: 16)
                        .overlay(
                            Text(faviconLetter)
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundColor(.white)
                        )
                }

                if isPlayingMedia {
                    Circle()
                        .fill(Color(white: 0.15))
                        .frame(width: 16, height: 16)
                        .overlay(
                            Image(systemName: "speaker.wave.2")
                                .font(.system(size: 11, weight: .regular))
                                .foregroundColor(Color(red: 0xC5 / 255, green: 0xC5 / 255, blue: 0xC5 / 255))
                        )
                        .offset(x: 7, y: -7)
                }
            }
        }
        .contentShape(Rectangle())
        .overlay(ClickCountCatcher(onSelect: onSelect, onClose: onClose))
        .contextMenu {
            Button("Close Tab", role: .destructive, action: onClose)
        }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: HoveredTabKey.self,
                    value: isHovering ? HoveredTabInfo(title: title, isPlayingMedia: isPlayingMedia, frame: proxy.frame(in: .named("browserRoot"))) : nil
                )
            }
        )
        .animation(.easeOut(duration: 0.15), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

private struct ClickCountCatcher: NSViewRepresentable {
    let onSelect: () -> Void
    let onClose: () -> Void

    func makeNSView(context: Context) -> ClickCountView {
        let view = ClickCountView()
        view.onSelect = onSelect
        view.onClose = onClose
        return view
    }

    func updateNSView(_ nsView: ClickCountView, context: Context) {
        nsView.onSelect = onSelect
        nsView.onClose = onClose
    }
}

private final class ClickCountView: NSView {
    var onSelect: (() -> Void)?
    var onClose: (() -> Void)?
    private var lastClickTime: CFAbsoluteTime = 0
    private let fastDoubleClickWindow: CFAbsoluteTime = 0.2

    override func mouseDown(with event: NSEvent) {
        let now = CFAbsoluteTimeGetCurrent()
        if now - lastClickTime < fastDoubleClickWindow {
            lastClickTime = 0
            onClose?()
        } else {
            lastClickTime = now
            onSelect?()
        }
    }
}

private struct TabNavigationControls: View {
    @ObservedObject var tab: BrowserTab
    @State private var showStopIcon = false
    @State private var isSpinning = false

    var body: some View {
        ToolbarIconButton(systemName: "arrow.backward", isDisabled: !tab.canGoBack) {
            tab.goBack()
        }
        ToolbarIconButton(systemName: "arrow.forward", isDisabled: !tab.canGoForward) {
            tab.goForward()
        }
        ToolbarIconButton(systemName: showStopIcon ? "xmark" : "arrow.clockwise", isSpinning: isSpinning) {
            if tab.isLoading {
                tab.stopLoading()
            } else {
                tab.reload()
            }
        }
        .onChange(of: tab.isLoading) { _, loading in
            if loading {
                showStopIcon = false
                isSpinning = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    if tab.isLoading {
                        isSpinning = false
                        withAnimation {
                            showStopIcon = true
                        }
                    }
                }
            } else {
                showStopIcon = false
                isSpinning = false
            }
        }
    }
}

private struct DownloadProgressPie: Shape {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        path.move(to: center)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(-90),
            endAngle: .degrees(-90 + 360 * progress),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

/// Our own visual for the trackpad swipe-back/forward gesture, replacing
/// WebKit's built-in swipe animation (which isn't publicly customizable at
/// all — see SwipeAwareWebView, which reports live gesture progress instead
/// of letting WebKit handle the gesture itself).
private struct SwipeNavigationOverlay: View {
    @ObservedObject var tab: BrowserTab

    var body: some View {
        HStack(spacing: 0) {
            if tab.swipeIsBack {
                indicator
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                indicator
            }
        }
        .allowsHitTesting(false)
    }

    private var indicator: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.4 * tab.swipeProgress), .clear],
                startPoint: tab.swipeIsBack ? .leading : .trailing,
                endPoint: tab.swipeIsBack ? .trailing : .leading
            )

            Image(systemName: tab.swipeIsBack ? "chevron.left" : "chevron.right")
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(.white.opacity(tab.swipeProgress))
                .scaleEffect(0.7 + 0.3 * tab.swipeProgress)
                .frame(maxWidth: 100, alignment: tab.swipeIsBack ? .leading : .trailing)
                .padding(tab.swipeIsBack ? .leading : .trailing, 16)
        }
        .frame(width: 100)
        .frame(maxHeight: .infinity)
        .animation(.easeOut(duration: 0.12), value: tab.swipeProgress)
    }
}

private struct PiPToggleButton: View {
    @ObservedObject var tab: BrowserTab
    @State private var isHovering = false

    var body: some View {
        // Always reserves its 24x24 slot (rather than being removed from the
        // hierarchy) so the address bar it sits next to doesn't shift left
        // and right as videos start/stop — only its visibility toggles.
        Image(systemName: "pip")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color(red: 0xB2 / 255, green: 0xB2 / 255, blue: 0xB2 / 255))
            .frame(width: 24, height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(isHovering ? 0.12 : 0))
            )
            .contentShape(Rectangle())
            .onTapGesture {
                PiPManager.shared.togglePiP(for: tab)
            }
            .onHover { hovering in
                isHovering = hovering
            }
            .opacity(tab.hasPlayingVideo ? 1 : 0)
            .allowsHitTesting(tab.hasPlayingVideo)
    }
}

private struct DownloadsButton: View {
    @ObservedObject var manager = DownloadManager.shared
    @Binding var isShowingList: Bool
    @State private var isHovering = false

    private var activeDownloads: [DownloadItem] {
        manager.downloads.filter { !$0.isFinished }
    }

    private var aggregateProgress: Double {
        guard !activeDownloads.isEmpty else { return 0 }
        return activeDownloads.reduce(0) { $0 + $1.progress } / Double(activeDownloads.count)
    }

    private var isActive: Bool { !activeDownloads.isEmpty }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ZStack {
                Image(systemName: "tray")
                    .font(.system(size: 14, weight: .bold))
                    .opacity(isActive ? 0 : 1)
                    .scaleEffect(isActive ? 0.4 : 1)

                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.25), lineWidth: 1.5)
                    DownloadProgressPie(progress: aggregateProgress)
                        .fill(Color(red: 0xAC / 255, green: 0xAC / 255, blue: 0xAC / 255))
                }
                .frame(width: 16, height: 16)
                .animation(.easeInOut(duration: 0.2), value: aggregateProgress)
                .opacity(isActive ? 1 : 0)
                .scaleEffect(isActive ? 1 : 0.4)
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: isActive)
            .foregroundColor(Color(red: 0xAC / 255, green: 0xAC / 255, blue: 0xAC / 255))
            .frame(width: 32, height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(isHovering ? 0.12 : 0))
            )

            if manager.hasUnseenFinishedDownloads && !isActive {
                Circle()
                    .fill(Color.red)
                    .frame(width: 7, height: 7)
                    .offset(x: -4, y: 4)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: manager.hasUnseenFinishedDownloads)
        .contentShape(Rectangle())
        .onTapGesture {
            isShowingList.toggle()
            if isShowingList {
                manager.markDownloadsSeen()
            }
        }
        .onHover { isHovering = $0 }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: DownloadsIconFrameKey.self, value: proxy.frame(in: .named("browserRoot")))
            }
        )
    }
}

private struct DownloadsListView: View {
    @ObservedObject var manager: DownloadManager

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Downloads")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(white: 0.65))
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 6)

            if manager.downloads.isEmpty {
                Text("No downloads")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
            } else {
                VStack(spacing: 0) {
                    ForEach(manager.downloads) { item in
                        DownloadRow(item: item, manager: manager)
                        if item.id != manager.downloads.last?.id {
                            Divider().background(Color.white.opacity(0.08))
                        }
                    }
                }
            }
        }
        .padding(.bottom, 6)
        .frame(width: 280)
        .background(Color(white: 0.13))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.4), radius: 16, y: 6)
    }
}

private struct DownloadRow: View {
    let item: DownloadItem
    let manager: DownloadManager
    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: item.failed ? "xmark.circle" : (item.isFinished ? "checkmark.circle" : "arrow.down.circle"))
                    .foregroundColor(item.failed ? .red : (item.isFinished ? .green : Color(white: 0.8)))
                Text(item.filename)
                    .font(.system(size: 12))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer()
            }
            if !item.isFinished {
                ProgressView(value: item.progress)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(isHovering ? 0.06 : 0))
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .onTapGesture {
            if item.isFinished && !item.failed {
                manager.openFile(item)
            }
        }
        .contextMenu {
            if item.isFinished && !item.failed {
                Button("Show in Finder") { manager.revealInFinder(item) }
            }
        }
    }
}

private struct DownloadFlyOverlay: View {
    let iconFrame: CGRect
    let onComplete: () -> Void
    @State private var isAtIcon = false

    var body: some View {
        Circle()
            .fill(Color.accentColor)
            .frame(width: 12, height: 12)
            .position(
                x: iconFrame.midX,
                y: isAtIcon ? iconFrame.midY : iconFrame.midY - 220
            )
            .scaleEffect(isAtIcon ? 0.3 : 1)
            .opacity(isAtIcon ? 0 : 1)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeIn(duration: 0.45)) {
                    isAtIcon = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    onComplete()
                }
            }
    }
}

private struct ToolbarIconButton: View {
    let systemName: String
    var isDisabled: Bool = false
    var isSpinning: Bool = false
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Image(systemName: systemName)
            .foregroundColor(Color(red: 0xAC / 255, green: 0xAC / 255, blue: 0xAC / 255))
            .contentTransition(.symbolEffect(.replace.offUp))
            .symbolEffect(.wiggle, options: .repeat(.continuous), isActive: isSpinning)
            .frame(width: 32, height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(isHovering ? 0.12 : 0))
            )
            .contentShape(Rectangle())
            .opacity(isDisabled ? 0.3 : 1)
            .onTapGesture {
                if !isDisabled {
                    action()
                }
            }
            .onHover { hovering in
                isHovering = isDisabled ? false : hovering
            }
    }
}

private struct NewTabIndicator: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "macwindow")
                .font(.system(size: 12, weight: .bold))
            Text("New Tab")
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundColor(Color(red: 0xB2 / 255, green: 0xB2 / 255, blue: 0xB2 / 255))
        .padding(.horizontal, 8)
        .frame(height: 24)
    }
}

private struct LinkCopyButton: View {
    @ObservedObject var tab: BrowserTab
    @State private var showCheckmark = false
    @State private var isHovering = false

    var body: some View {
        Image(systemName: showCheckmark ? "checkmark" : "link")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color(red: 0xB2 / 255, green: 0xB2 / 255, blue: 0xB2 / 255))
            .contentTransition(.symbolEffect(.replace.magic(fallback: .downUp.wholeSymbol), options: .nonRepeating))
            .frame(width: 24, height: 24)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(isHovering ? 0.12 : 0))
            )
            .contentShape(Rectangle())
            .onTapGesture {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(tab.url.absoluteString, forType: .string)
                withAnimation {
                    showCheckmark = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    withAnimation {
                        showCheckmark = false
                    }
                }
            }
            .onHover { hovering in
                isHovering = hovering
            }
    }
}

private struct NewTabAddressField: View {
    @Binding var addressInput: String
    let onSubmit: () -> Void
    let onFocusChange: (Bool) -> Void

    var body: some View {
        FocusedTextField(
            text: $addressInput,
            placeholder: "Search or enter address.",
            font: .systemFont(ofSize: 13, weight: .medium),
            alignment: .left,
            focusOnAppear: true,
            onSubmit: onSubmit,
            onFocusChange: onFocusChange
        )
        .frame(width: measuredWidth(addressInput.isEmpty ? "Search or enter address." : addressInput), height: 20)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private func measuredWidth(_ text: String) -> CGFloat {
        let width = (text as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)]).width
        return min(max(width, 1), 600)
    }
}

private struct AddressDisplayButton: View {
    @ObservedObject var tab: BrowserTab
    @Binding var addressInput: String
    @Binding var isHovering: Bool
    let onSubmit: () -> Void
    let onFocusChange: (Bool) -> Void
    @Binding var isEditing: Bool

    var body: some View {
        Group {
            if isEditing {
                FocusedTextField(
                    text: $addressInput,
                    placeholder: "Search or enter address.",
                    font: .systemFont(ofSize: 13, weight: .medium),
                    alignment: .left,
                    focusOnAppear: true,
                    onSubmit: {
                        onSubmit()
                        isEditing = false
                    },
                    onFocusChange: { focused in
                        onFocusChange(focused)
                        if !focused { isEditing = false }
                    }
                )
                .frame(width: measuredWidth(addressInput.isEmpty ? "Search or enter address." : addressInput), height: 20)
            } else {
                Text(displayHost)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .frame(height: 20)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture {
            if !isEditing {
                addressInput = tab.url.absoluteString
                isEditing = true
            }
        }
        .animation(.easeOut(duration: 0.18), value: isHovering)
        .onHover { hovering in
            isHovering = hovering
        }
    }

    private var displayHost: String {
        tab.url.host?.replacingOccurrences(of: "www.", with: "") ?? tab.url.absoluteString
    }

    private func measuredWidth(_ text: String) -> CGFloat {
        let width = (text as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)]).width
        return min(max(width, 1), 600)
    }
}
