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
            DispatchQueue.main.async {
                field.window?.makeFirstResponder(field)
                let end = (field.stringValue as NSString).length
                field.currentEditor()?.selectedRange = NSRange(location: end, length: 0)
            }
        }

        return field
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
