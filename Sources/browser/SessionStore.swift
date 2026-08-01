import Foundation

/// One tab's persisted state — plain `url` for a regular tab; a pinned tab
/// additionally carries the address/title it was pinned at (frozen there
/// regardless of subsequent navigation — see `BrowserTab.pinnedURL`).
struct SessionTab: Codable {
    let url: String
    let isPinned: Bool
    let pinnedURL: String?
    let pinnedTitle: String?
}

/// Persists the open tabs (and which one was active) so the app can restore
/// them on the next launch, the way most browsers do.
enum SessionStore {
    private static let tabsKey = "sessionTabsV2"
    private static let activeIndexKey = "sessionActiveTabIndex"

    static func save(tabs: [SessionTab], activeIndex: Int?) {
        if let data = try? JSONEncoder().encode(tabs) {
            UserDefaults.standard.set(data, forKey: tabsKey)
        }
        if let activeIndex {
            UserDefaults.standard.set(activeIndex, forKey: activeIndexKey)
        } else {
            UserDefaults.standard.removeObject(forKey: activeIndexKey)
        }
    }

    static func load() -> (tabs: [SessionTab], activeIndex: Int?)? {
        guard let data = UserDefaults.standard.data(forKey: tabsKey),
              let tabs = try? JSONDecoder().decode([SessionTab].self, from: data),
              !tabs.isEmpty else {
            return nil
        }
        let activeIndex = UserDefaults.standard.object(forKey: activeIndexKey) as? Int
        return (tabs, activeIndex)
    }
}
