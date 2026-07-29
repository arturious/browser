import SwiftUI
import AppKit

struct FocusedTextField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String = ""
    var font: NSFont
    var alignment: NSTextAlignment = .natural
    var focusOnAppear: Bool = true
    var onSubmit: () -> Void
    var onFocusChange: ((Bool) -> Void)? = nil

    func makeNSView(context: Context) -> NSTextField {
        let field = DismissOnEmptyClickTextField()
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = font
        field.alignment = alignment
        field.placeholderString = placeholder
        field.stringValue = text
        field.delegate = context.coordinator
        field.lineBreakMode = .byClipping
        field.cell?.wraps = false
        field.cell?.isScrollable = true
        field.usesSingleLineMode = true

        if focusOnAppear {
            Self.requestFocus(for: field, attemptsRemaining: 10)
        }

        return field
    }

    /// The field can appear before it's actually attached to a window (e.g.
    /// right as a new tab's address bar swaps in), in which case
    /// `field.window` is still nil and a single deferred focus attempt
    /// silently does nothing — hence the retry, giving it a few more run
    /// loop turns to actually land in the view hierarchy.
    private static func requestFocus(for field: NSTextField, attemptsRemaining: Int) {
        guard attemptsRemaining > 0 else { return }
        DispatchQueue.main.async {
            guard let window = field.window else {
                requestFocus(for: field, attemptsRemaining: attemptsRemaining - 1)
                return
            }
            window.makeFirstResponder(field)
            field.currentEditor()?.selectAll(nil)
        }
    }

    func updateNSView(_ nsView: NSTextField, context: Context) {
        if nsView.stringValue != text {
            // Prevent the AppKit delegate callback from bouncing this write
            // straight back into SwiftUI during the same update pass.
            context.coordinator.isProgrammaticUpdate = true
            nsView.stringValue = text
            context.coordinator.isProgrammaticUpdate = false
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, onSubmit: onSubmit, onFocusChange: onFocusChange)
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        let text: Binding<String>
        let onSubmit: () -> Void
        let onFocusChange: ((Bool) -> Void)?
        var isProgrammaticUpdate = false

        init(text: Binding<String>, onSubmit: @escaping () -> Void, onFocusChange: ((Bool) -> Void)?) {
            self.text = text
            self.onSubmit = onSubmit
            self.onFocusChange = onFocusChange
        }

        func controlTextDidBeginEditing(_ obj: Notification) {
            onFocusChange?(true)
        }

        func controlTextDidEndEditing(_ obj: Notification) {
            onFocusChange?(false)
        }

        func controlTextDidChange(_ notification: Notification) {
            guard !isProgrammaticUpdate else { return }
            guard let field = notification.object as? NSTextField else { return }
            text.wrappedValue = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                onSubmit()
                control.window?.makeFirstResponder(nil)
                return true
            }
            if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
                control.window?.makeFirstResponder(nil)
                return true
            }
            return false
        }
    }
}

private final class DismissOnEmptyClickTextField: NSTextField {
    override func mouseDown(with event: NSEvent) {
        if stringValue.isEmpty, window?.firstResponder === currentEditor() {
            window?.makeFirstResponder(nil)
            return
        }
        super.mouseDown(with: event)
    }
}
