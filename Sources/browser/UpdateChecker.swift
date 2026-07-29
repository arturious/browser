import AppKit

/// Checks GitHub Releases for a newer tagged version than the one currently
/// running, since this app isn't distributed through the App Store (no
/// built-in update mechanism) or via Sparkle (no extra dependency for this
/// small a feature). When a newer version's release has a `.dmg` asset, this
/// can also download it, mount it, swap it in for the running app on disk,
/// and relaunch — a minimal hand-rolled version of what Sparkle does.
@MainActor
final class UpdateChecker {
    static let shared = UpdateChecker()

    static let currentVersion = "1.2.0"
    private static let repo = "arturious/browser"

    private init() {}

    func checkForUpdates(userInitiated: Bool) {
        Task {
            await performCheck(userInitiated: userInitiated)
        }
    }

    private func performCheck(userInitiated: Bool) async {
        guard let url = URL(string: "https://api.github.com/repos/\(Self.repo)/releases/latest") else { return }
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tagName = json["tag_name"] as? String else {
            if userInitiated {
                showAlert(title: "Couldn't Check for Updates", message: "Please check your internet connection and try again.")
            }
            return
        }

        let latestVersion = tagName.hasPrefix("v") ? String(tagName.dropFirst()) : tagName
        guard latestVersion.compare(Self.currentVersion, options: .numeric) == .orderedDescending else {
            if userInitiated {
                showAlert(title: "You're Up to Date", message: "browser \(Self.currentVersion) is the latest version.")
            }
            return
        }

        let assets = json["assets"] as? [[String: Any]] ?? []
        let dmgAsset = assets.first { ($0["name"] as? String)?.hasSuffix(".dmg") == true }
        let dmgURL = (dmgAsset?["browser_download_url"] as? String).flatMap(URL.init(string:))
        let releaseURL = (json["html_url"] as? String).flatMap(URL.init(string:))

        showUpdateAvailableAlert(version: latestVersion, dmgURL: dmgURL, releaseURL: releaseURL)
    }

    private func showUpdateAvailableAlert(version: String, dmgURL: URL?, releaseURL: URL?) {
        // Only offer the in-place install when running as a real installed
        // .app (not the bare SPM debug/release binary used during dev).
        let canInstallInPlace = dmgURL != nil && Bundle.main.bundlePath.hasSuffix(".app")

        let alert = NSAlert()
        alert.messageText = "A New Version is Available"
        alert.informativeText = "browser \(version) is available (you have \(Self.currentVersion))."
        alert.addButton(withTitle: canInstallInPlace ? "Update Now" : "View Release")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        if canInstallInPlace, let dmgURL {
            Task { await performInPlaceUpdate(dmgURL: dmgURL) }
        } else if let releaseURL {
            NSWorkspace.shared.open(releaseURL)
        }
    }

    private func performInPlaceUpdate(dmgURL: URL) async {
        let progress = UpdateProgressWindow.show(message: "Downloading update…")
        defer { progress.close() }

        do {
            let (downloadedFileURL, _) = try await URLSession.shared.download(from: dmgURL)
            let stagedDMGURL = FileManager.default.temporaryDirectory.appendingPathComponent("BrowserUpdate-\(UUID().uuidString).dmg")
            try FileManager.default.moveItem(at: downloadedFileURL, to: stagedDMGURL)
            defer { try? FileManager.default.removeItem(at: stagedDMGURL) }

            progress.update(message: "Installing update…")
            let mountPoint = try mountDMG(at: stagedDMGURL)
            defer { try? unmountDMG(at: mountPoint) }

            guard let newAppURL = try FileManager.default.contentsOfDirectory(at: mountPoint, includingPropertiesForKeys: nil)
                .first(where: { $0.pathExtension == "app" }) else {
                throw UpdateError.appNotFoundInImage
            }

            let currentAppURL = Bundle.main.bundleURL
            let stagingAppURL = currentAppURL.deletingLastPathComponent()
                .appendingPathComponent(".\(currentAppURL.lastPathComponent).update-\(UUID().uuidString)")
            try FileManager.default.copyItem(at: newAppURL, to: stagingAppURL)

            try FileManager.default.trashItem(at: currentAppURL, resultingItemURL: nil)
            try FileManager.default.moveItem(at: stagingAppURL, to: currentAppURL)

            progress.close()
            relaunch(at: currentAppURL)
        } catch {
            progress.close()
            showAlert(title: "Update Failed", message: error.localizedDescription)
        }
    }

    private func mountDMG(at fileURL: URL) throws -> URL {
        let mountPoint = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
        process.arguments = ["attach", fileURL.path, "-mountpoint", mountPoint.path, "-nobrowse", "-quiet"]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw UpdateError.mountFailed }
        return mountPoint
    }

    private func unmountDMG(at mountPoint: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
        process.arguments = ["detach", mountPoint.path, "-quiet"]
        try process.run()
        process.waitUntilExit()
    }

    private func relaunch(at appURL: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-n", appURL.path]
        try? process.run()
        // `open` hands off to Launch Services and returns almost
        // immediately, before the new process is actually up — waiting for
        // it to exit (rather than terminating self right away) avoids a
        // race where our own process disappears before the relaunch request
        // is fully handed off.
        process.waitUntilExit()
        NSApp.terminate(nil)
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private enum UpdateError: LocalizedError {
        case mountFailed
        case appNotFoundInImage

        var errorDescription: String? {
            switch self {
            case .mountFailed: return "Couldn't open the downloaded update image."
            case .appNotFoundInImage: return "Couldn't find the app inside the downloaded update."
            }
        }
    }
}

/// A tiny non-modal "please wait" panel shown while an update downloads and
/// installs, so the app doesn't look frozen — deliberately not an NSAlert,
/// since NSAlert.runModal() is meant for one-shot decisions, not a progress
/// display whose text needs to change mid-flight.
@MainActor
private final class UpdateProgressWindow {
    private let panel: NSPanel
    private let label: NSTextField

    static func show(message: String) -> UpdateProgressWindow {
        UpdateProgressWindow(message: message)
    }

    private init(message: String) {
        label = NSTextField(labelWithString: message)
        label.font = .systemFont(ofSize: 13)
        label.alignment = .center

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.startAnimation(nil)

        let stack = NSStackView(views: [spinner, label])
        stack.orientation = .horizontal
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 280, height: 60),
            styleMask: [.titled, .nonactivatingPanel, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "Updating"
        panel.titlebarAppearsTransparent = true
        panel.isReleasedWhenClosed = false
        panel.center()

        panel.contentView?.addSubview(stack)
        if let contentView = panel.contentView {
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                stack.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            ])
        }

        panel.orderFrontRegardless()
    }

    func update(message: String) {
        label.stringValue = message
    }

    func close() {
        panel.close()
    }
}
