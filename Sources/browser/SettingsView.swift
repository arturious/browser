import SwiftUI

struct SettingsView: View {
    @ObservedObject private var adBlockManager = AdBlockManager.shared

    var body: some View {
        Form {
            Toggle("Block ads and trackers", isOn: $adBlockManager.isEnabled)
        }
        .padding(24)
        .frame(width: 360)
    }
}
