import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// No Xcode-generated MainMenu / SwiftUI-synthesized commands here — build
// a minimal one by hand. Without at least a Quit item, Cmd+Q wouldn't do
// anything (there's no menu bar at all otherwise), and without a Settings
// item there'd be no way to reach it since the traffic-light buttons and
// title bar are hidden.
let mainMenu = NSMenu()

let appMenuItem = NSMenuItem()
mainMenu.addItem(appMenuItem)
let appMenu = NSMenu()
appMenu.addItem(
    NSMenuItem(title: "About Browser", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
)
appMenu.addItem(.separator())
appMenu.addItem(
    NSMenuItem(title: "Check for Updates…", action: #selector(AppDelegate.checkForUpdates), keyEquivalent: "")
)
appMenu.addItem(
    NSMenuItem(title: "Settings…", action: #selector(AppDelegate.showSettings), keyEquivalent: ",")
)
appMenu.addItem(.separator())
appMenu.addItem(
    NSMenuItem(title: "Hide Browser", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
)
let hideOthersItem = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
hideOthersItem.keyEquivalentModifierMask = [.command, .option]
appMenu.addItem(hideOthersItem)
appMenu.addItem(
    NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
)
appMenu.addItem(.separator())
appMenu.addItem(
    NSMenuItem(title: "Quit Browser", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
)
appMenuItem.submenu = appMenu

// Without a real Edit menu, AppKit has nothing to route Cmd+X/C/V/A (or
// Cmd+Z/Shift-Cmd+Z) through — text fields (the address bar, page content)
// silently can't cut/copy/paste/undo at all, since the standard
// cut:/copy:/paste:/etc. selectors below are what the responder chain
// actually dispatches those key equivalents to.
let editMenuItem = NSMenuItem()
mainMenu.addItem(editMenuItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
editMenu.addItem(NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
editMenu.addItem(.separator())
editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
editMenuItem.submenu = editMenu

app.mainMenu = mainMenu

app.run()
