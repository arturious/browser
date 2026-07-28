import Foundation

/// Persists per-site zoom levels across launches, keyed by host, so a page
/// you've zoomed once stays zoomed the next time you visit it.
enum ZoomStore {
    private static let defaultsKey = "hostZoomLevels"

    static func zoom(for host: String) -> CGFloat? {
        let levels = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Double]
        return levels?[host].map { CGFloat($0) }
    }

    static func setZoom(_ zoom: CGFloat, for host: String) {
        var levels = (UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: Double]) ?? [:]
        levels[host] = Double(zoom)
        UserDefaults.standard.set(levels, forKey: defaultsKey)
    }
}
