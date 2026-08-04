import SwiftUI

struct HistoryButton: View {
    @Binding var isShowingList: Bool
    @State private var isHovering = false
    @State private var wiggleTrigger = 0

    var body: some View {
        Image(systemName: "clock.arrow.trianglehead.counterclockwise.rotate.90")
            .font(.system(size: 14, weight: .bold))
            .symbolEffect(.wiggle, options: .nonRepeating, value: wiggleTrigger)
            .foregroundColor(Color.toolbarIcon)
            .frame(width: 32, height: 24)
            .hoverHighlight(isHovering)
            .contentShape(Rectangle())
            .onTapGesture {
                wiggleTrigger += 1
                isShowingList.toggle()
            }
            .onHover { isHovering = $0 }
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: HistoryIconFrameKey.self, value: proxy.frame(in: .named("browserRoot")))
                }
            )
    }
}

struct HistoryListView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("History")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(white: 0.65))
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 6)

            Text("No history yet")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
        }
        .padding(.bottom, 6)
        .frame(width: 280)
        .background(Color(white: 0.13))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.4), radius: 16, y: 6)
    }
}
