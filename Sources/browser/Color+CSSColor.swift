import SwiftUI
import AppKit

extension Color {
    /// The main topbar/sidebar icon color, shared across toolbar buttons,
    /// the sidebar "+" button, and the history/downloads icons.
    static let toolbarIcon = Color(red: 0xAC / 255, green: 0xAC / 255, blue: 0xAC / 255)
    /// A slightly lighter variant used for icons that sit directly in the
    /// address bar (new-tab indicator, link-copy, PiP toggle).
    static let toolbarIconLight = Color(red: 0xB2 / 255, green: 0xB2 / 255, blue: 0xB2 / 255)
    /// The sidebar's "playing audio" speaker-badge icon color.
    static let mediaBadgeIcon = Color(red: 0xC5 / 255, green: 0xC5 / 255, blue: 0xC5 / 255)

    /// True for colors close to plain white/light-gray — e.g. YouTube
    /// declares `rgba(255,255,255,0.98)` as its theme-color (matching its
    /// own light toolbar). Real browsers don't apply theme-color verbatim
    /// either: the spec explicitly allows a user agent to "adjust the theme
    /// color in UA-defined ways to make it more suitable", and Chrome's own
    /// implementation picks toolbar/icon contrast programmatically rather
    /// than trusting the raw value.
    var isNearWhite: Bool {
        let nsColor = NSColor(self).usingColorSpace(.deviceRGB) ?? NSColor(self)
        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        nsColor.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return saturation < 0.15 && brightness > 0.75
    }

    /// True for a color with enough of its own hue/saturation to read as a
    /// deliberate brand color rather than a shade of gray.
    var isDistinctColor: Bool {
        let nsColor = NSColor(self).usingColorSpace(.deviceRGB) ?? NSColor(self)
        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        nsColor.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return saturation >= 0.15 && brightness > 0.15
    }

    /// Parses the handful of CSS color formats sites actually use for
    /// `<meta name="theme-color">`: `#rgb`, `#rrggbb`, `#rrggbbaa`,
    /// `rgb(r, g, b)`, and `rgba(r, g, b, a)`. Returns nil for anything else
    /// (named colors, hsl(), etc.) rather than guessing.
    init?(cssColor value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.hasPrefix("#") {
            let hex = String(trimmed.dropFirst())
            guard let rgba = Self.parseHex(hex) else { return nil }
            self = Color(red: rgba.0, green: rgba.1, blue: rgba.2, opacity: rgba.3)
            return
        }

        if trimmed.hasPrefix("rgb") {
            let numbers = trimmed
                .drop { $0 != "(" }
                .dropFirst()
                .dropLast(trimmed.hasSuffix(")") ? 1 : 0)
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard numbers.count >= 3,
                  let r = Double(numbers[0]), let g = Double(numbers[1]), let b = Double(numbers[2]) else {
                return nil
            }
            let a = numbers.count >= 4 ? (Double(numbers[3]) ?? 1) : 1
            self = Color(red: r / 255, green: g / 255, blue: b / 255, opacity: a)
            return
        }

        return nil
    }

    private static func parseHex(_ hex: String) -> (Double, Double, Double, Double)? {
        guard let value = UInt32(hex, radix: 16) else { return nil }
        switch hex.count {
        case 3: // rgb, each digit repeated
            let r = (value >> 8) & 0xF, g = (value >> 4) & 0xF, b = value & 0xF
            return (Double(r * 17) / 255, Double(g * 17) / 255, Double(b * 17) / 255, 1)
        case 6: // rrggbb
            let r = (value >> 16) & 0xFF, g = (value >> 8) & 0xFF, b = value & 0xFF
            return (Double(r) / 255, Double(g) / 255, Double(b) / 255, 1)
        case 8: // rrggbbaa
            let r = (value >> 24) & 0xFF, g = (value >> 16) & 0xFF, b = (value >> 8) & 0xFF, a = value & 0xFF
            return (Double(r) / 255, Double(g) / 255, Double(b) / 255, Double(a) / 255)
        default:
            return nil
        }
    }
}
