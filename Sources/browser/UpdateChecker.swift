import AppKit

/// Checks GitHub Releases for a newer tagged version than the one currently
/// running, since this app isn't distributed through the App Store (no
/// built-in update mechanism) or via Sparkle (no extra dependency for this
/// small a feature).
@MainActor
final class UpdateChecker {
    static let shared = UpdateChecker()

    static let currentVersion = "1.0.0"
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
        if latestVersion.compare(Self.currentVersion, options: .numeric) == .orderedDescending {
            showUpdateAvailableAlert(version: latestVersion, releaseURL: json["html_url"] as? String)
        } else if userInitiated {
            showAlert(title: "You're Up to Date", message: "browser \(Self.currentVersion) is the latest version.")
        }
    }

    private func showUpdateAvailableAlert(version: String, releaseURL: String?) {
        let alert = NSAlert()
        alert.messageText = "A New Version is Available"
        alert.informativeText = "browser \(version) is available (you have \(Self.currentVersion))."
        alert.addButton(withTitle: "View Release")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn, let releaseURL, let url = URL(string: releaseURL) {
            NSWorkspace.shared.open(url)
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
