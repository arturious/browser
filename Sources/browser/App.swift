import SwiftUI
import AppKit

/// No SwiftUI `App`/`WindowGroup`/`Scene` here — that layer kept fighting
/// manual window customizations (native edge-resize intermittently
/// breaking, `.resizable`/min-max size changes not sticking) because
/// SwiftUI's own window-scene management continuously re-asserts its own
/// idea of the window's traits. A plain manual NSApplication/AppDelegate/
/// NSWindow bootstrap sidesteps all of that — see main.swift for the entry
/// point.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSWindow.allowsAutomaticWindowTabbing = false

        let contentRect = NSRect(x: 0, y: 0, width: 1100, height: 750)
        // `.titled` (kept, just visually hidden below) is required for
        // AppKit's automatic native edge-resize behavior to work at all —
        // it's only wired up for titled windows, not `.borderless` ones.
        let window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        self.window = window
        window.identifier = Self.mainWindowIdentifier
        window.title = "Browser"
        // Without this, `toggleFullScreen(_:)` (Cmd+Ctrl+F / the View menu
        // item below) silently does nothing — a manually created NSWindow
        // isn't fullscreen-eligible by default the way Xcode's template
        // main menu's window is.
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.tabbingMode = .disallowed
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.contentMinSize = NSSize(width: 900, height: 600)
        // The window has no visible chrome to drag by; WindowDragArea inside
        // ContentView's topBar background handles dragging deliberately instead.
        window.isMovableByWindowBackground = false
        window.center()
        window.contentView = NSHostingView(rootView: ContentView())

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        AdBlockManager.shared.start()
        UpdateChecker.shared.checkForUpdates(userInitiated: false)
    }

    /// Tags the main browser window so it can be reliably found later (e.g.
    /// to bring back to the front when returning from PiP) even after the
    /// Settings window has been opened at least once and started showing up
    /// in `NSApp.windows` too.
    static let mainWindowIdentifier = NSUserInterfaceItemIdentifier("main-browser-window")

    @objc func checkForUpdates() {
        UpdateChecker.shared.checkForUpdates(userInitiated: true)
    }

    @objc func showSettings() {
        if settingsWindow == nil {
            let settingsWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 360, height: 120),
                styleMask: [.titled, .closable],
                backing: .buffered,
                defer: false
            )
            settingsWindow.title = "Settings"
            settingsWindow.contentView = NSHostingView(rootView: SettingsView())
            settingsWindow.isReleasedWhenClosed = false
            settingsWindow.center()
            self.settingsWindow = settingsWindow
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
