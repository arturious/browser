import SwiftUI

struct HoveredTabInfo: Equatable {
    let title: String
    let isPlayingMedia: Bool
    let frame: CGRect
}

struct HoveredTabKey: PreferenceKey {
    static let defaultValue: HoveredTabInfo? = nil
    static func reduce(value: inout HoveredTabInfo?, nextValue: () -> HoveredTabInfo?) {
        if let next = nextValue() { value = next }
    }
}

struct DownloadsIconFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}

struct HistoryIconFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}
