import SwiftUI
import AppKit

extension NSImage {
    /// A pre-rendered, 45°-rotated "pin" SF Symbol — SwiftUI's context
    /// menus don't honor `.rotationEffect` (or most other modifiers) on a
    /// `Label`'s icon when converting it to the menu item's actual
    /// `NSImage`, so the rotation has to be baked into the image itself.
    static let diagonalPin: NSImage = {
        let original = NSImage(systemSymbolName: "pin", accessibilityDescription: nil) ?? NSImage()
        let size = original.size
        let rotated = NSImage(size: size)
        rotated.lockFocus()
        let transform = NSAffineTransform()
        transform.translateX(by: size.width / 2, yBy: size.height / 2)
        transform.rotate(byDegrees: 45)
        transform.translateX(by: -size.width / 2, yBy: -size.height / 2)
        transform.concat()
        original.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1.0)
        rotated.unlockFocus()
        rotated.isTemplate = true
        return rotated
    }()
}

struct SidebarAddButton: View {
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Image(systemName: "plus")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(Color.toolbarIcon)
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

struct SidebarIcon: View {
    @ObservedObject var tab: BrowserTab
    let isActive: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    let onTogglePin: () -> Void

    var body: some View {
        SidebarIconBody(
            faviconImage: tab.faviconImage,
            faviconColor: tab.faviconColor,
            faviconLetter: tab.faviconLetter,
            title: tab.title,
            isActive: isActive,
            isPlayingMedia: tab.isPlayingMedia,
            isPinned: tab.isPinned,
            onSelect: onSelect,
            onClose: onClose,
            onTogglePin: onTogglePin
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
    let isPinned: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    let onTogglePin: () -> Void
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
                                .foregroundColor(Color.mediaBadgeIcon)
                        )
                        .offset(x: 7, y: -7)
                }
            }
        }
        .contentShape(Rectangle())
        .overlay(ClickCountCatcher(onSelect: onSelect, onClose: onClose))
        .overlay(alignment: .topLeading) {
            if isPinned {
                // Always visible, purely a status indicator — not a
                // button, doesn't intercept clicks meant for the tab itself.
                Image(nsImage: .diagonalPin)
                    .renderingMode(.template)
                    .foregroundColor(Color(white: 0.6))
                    .frame(width: 14, height: 14)
                    .offset(x: -1, y: -3)
                    .allowsHitTesting(false)
            } else if isHovering {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color(white: 0.75))
                        .frame(width: 16, height: 16)
                }
                .buttonStyle(.plain)
                .offset(x: -2, y: -4)
                .transition(.opacity)
            }
        }
        .contextMenu {
            Button {
                onTogglePin()
            } label: {
                Label {
                    Text(isPinned ? "Unpin" : "Pin")
                } icon: {
                    Image(nsImage: .diagonalPin)
                }
            }
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
