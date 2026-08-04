import SwiftUI
import AppKit

/// Shared by the address bar's editing field and the new-tab address field
/// so the text field grows to fit its content instead of using a fixed width.
func measuredTextWidth(_ text: String, font: NSFont) -> CGFloat {
    let width = (text as NSString).size(withAttributes: [.font: font]).width
    return min(max(width, 1), 600)
}

extension View {
    /// The subtle white-tint fill shown behind a toolbar icon while hovered —
    /// shared by every topbar/sidebar icon button (history, downloads,
    /// address-bar icons, back/forward/reload).
    func hoverHighlight(_ isHovering: Bool, cornerRadius: CGFloat = 6) -> some View {
        background(
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(Color.white.opacity(isHovering ? 0.12 : 0))
        )
    }
}

struct ToolbarIconButton: View {
    let systemName: String
    var isDisabled: Bool = false
    var isSpinning: Bool = false
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Image(systemName: systemName)
            .foregroundColor(Color.toolbarIcon)
            .contentTransition(.symbolEffect(.replace.offUp))
            .symbolEffect(.wiggle, options: .repeat(.continuous), isActive: isSpinning)
            .frame(width: 32, height: 24)
            .hoverHighlight(isHovering)
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

struct TabNavigationControls: View {
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

struct NewTabIndicator: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "macwindow")
                .font(.system(size: 12, weight: .bold))
            Text("New Tab")
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundColor(Color.toolbarIconLight)
        .padding(.horizontal, 8)
        .frame(height: 24)
    }
}

struct NewTabAddressField: View {
    @Binding var addressInput: String
    let onSubmit: () -> Void
    let onFocusChange: (Bool) -> Void

    private static let font = NSFont.systemFont(ofSize: 13, weight: .medium)

    var body: some View {
        FocusedTextField(
            text: $addressInput,
            placeholder: "Search or enter address.",
            font: Self.font,
            alignment: .left,
            focusOnAppear: true,
            onSubmit: onSubmit,
            onFocusChange: onFocusChange
        )
        .frame(width: measuredTextWidth(addressInput.isEmpty ? "Search or enter address." : addressInput, font: Self.font), height: 20)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

struct AddressDisplayButton: View {
    @ObservedObject var tab: BrowserTab
    @Binding var addressInput: String
    @Binding var isHovering: Bool
    let onSubmit: () -> Void
    let onFocusChange: (Bool) -> Void
    @Binding var isEditing: Bool

    private static let font = NSFont.systemFont(ofSize: 13, weight: .medium)

    var body: some View {
        Group {
            if isEditing {
                FocusedTextField(
                    text: $addressInput,
                    placeholder: "Search or enter address.",
                    font: Self.font,
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
                .frame(width: measuredTextWidth(addressInput.isEmpty ? "Search or enter address." : addressInput, font: Self.font), height: 20)
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
}

struct LinkCopyButton: View {
    @ObservedObject var tab: BrowserTab
    @State private var showCheckmark = false
    @State private var isHovering = false

    var body: some View {
        Image(systemName: showCheckmark ? "checkmark" : "link")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color.toolbarIconLight)
            .contentTransition(.symbolEffect(.replace.magic(fallback: .downUp.wholeSymbol), options: .nonRepeating))
            .frame(width: 24, height: 24)
            .hoverHighlight(isHovering)
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

struct PiPToggleButton: View {
    @ObservedObject var tab: BrowserTab
    @State private var isHovering = false

    var body: some View {
        // Always reserves its 24x24 slot (rather than being removed from the
        // hierarchy) so the address bar it sits next to doesn't shift left
        // and right as videos start/stop — only its visibility toggles.
        Image(systemName: "pip")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color.toolbarIconLight)
            .frame(width: 24, height: 24)
            .hoverHighlight(isHovering)
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
