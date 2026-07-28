import Foundation

/// Persists the open tabs' URLs (and which one was active) so the app can
/// restore them on the next launch, the way most browsers do.
enum SessionStore {
    private static let urlsKey = "sessionTabURLs"
    private static let activeIndexKey = "sessionActiveTabIndex"

    static func save(urls: [URL], activeIndex: Int?) {
        UserDefaults.standard.set(urls.map { $0.absoluteString }, forKey: urlsKey)
        if let activeIndex {
            UserDefaults.standard.set(activeIndex, forKey: activeIndexKey)
        } else {
            UserDefaults.standard.removeObject(forKey: activeIndexKey)
        }
    }

    static func load() -> (urls: [URL], activeIndex: Int?)? {
        guard let strings = UserDefaults.standard.stringArray(forKey: urlsKey), !strings.isEmpty else {
            return nil
        }
        let urls = strings.compactMap { URL(string: $0) }
        guard !urls.isEmpty else { return nil }
        let activeIndex = UserDefaults.standard.object(forKey: activeIndexKey) as? Int
        return (urls, activeIndex)
    }
}
