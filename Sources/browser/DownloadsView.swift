import SwiftUI

struct DownloadProgressPie: Shape {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2
        path.move(to: center)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(-90),
            endAngle: .degrees(-90 + 360 * progress),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

struct DownloadsButton: View {
    @ObservedObject var manager = DownloadManager.shared
    @Binding var isShowingList: Bool
    @State private var isHovering = false

    private var activeDownloads: [DownloadItem] {
        manager.downloads.filter { !$0.isFinished }
    }

    private var aggregateProgress: Double {
        guard !activeDownloads.isEmpty else { return 0 }
        return activeDownloads.reduce(0) { $0 + $1.progress } / Double(activeDownloads.count)
    }

    private var isActive: Bool { !activeDownloads.isEmpty }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ZStack {
                Image(systemName: "tray")
                    .font(.system(size: 14, weight: .bold))
                    .opacity(isActive ? 0 : 1)
                    .scaleEffect(isActive ? 0.4 : 1)

                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.25), lineWidth: 1.5)
                    DownloadProgressPie(progress: aggregateProgress)
                        .fill(Color.toolbarIcon)
                }
                .frame(width: 16, height: 16)
                .animation(.easeInOut(duration: 0.2), value: aggregateProgress)
                .opacity(isActive ? 1 : 0)
                .scaleEffect(isActive ? 1 : 0.4)
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.7), value: isActive)
            .foregroundColor(Color.toolbarIcon)
            .frame(width: 32, height: 24)
            .hoverHighlight(isHovering)

            if manager.hasUnseenFinishedDownloads && !isActive {
                Circle()
                    .fill(Color.red)
                    .frame(width: 7, height: 7)
                    .offset(x: -4, y: 4)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: manager.hasUnseenFinishedDownloads)
        .contentShape(Rectangle())
        .onTapGesture {
            isShowingList.toggle()
            if isShowingList {
                manager.markDownloadsSeen()
            }
        }
        .onHover { isHovering = $0 }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: DownloadsIconFrameKey.self, value: proxy.frame(in: .named("browserRoot")))
            }
        )
    }
}

struct DownloadsListView: View {
    @ObservedObject var manager: DownloadManager

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Downloads")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(white: 0.65))
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 6)

            if manager.downloads.isEmpty {
                Text("No downloads")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
            } else {
                VStack(spacing: 0) {
                    ForEach(manager.downloads) { item in
                        DownloadRow(item: item, manager: manager)
                        if item.id != manager.downloads.last?.id {
                            Divider().background(Color.white.opacity(0.08))
                        }
                    }
                }
            }
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

private struct DownloadRow: View {
    let item: DownloadItem
    let manager: DownloadManager
    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: item.failed ? "xmark.circle" : (item.isFinished ? "checkmark.circle" : "arrow.down.circle"))
                    .foregroundColor(item.failed ? .red : (item.isFinished ? .green : Color(white: 0.8)))
                Text(item.filename)
                    .font(.system(size: 12))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer()
            }
            if !item.isFinished {
                ProgressView(value: item.progress)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(isHovering ? 0.06 : 0))
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .onTapGesture {
            if item.isFinished && !item.failed {
                manager.openFile(item)
            }
        }
        .contextMenu {
            if item.isFinished && !item.failed {
                Button("Show in Finder") { manager.revealInFinder(item) }
            }
        }
    }
}

struct DownloadFlyOverlay: View {
    let iconFrame: CGRect
    let onComplete: () -> Void
    @State private var isAtIcon = false

    var body: some View {
        Circle()
            .fill(Color.accentColor)
            .frame(width: 12, height: 12)
            .position(
                x: iconFrame.midX,
                y: isAtIcon ? iconFrame.midY : iconFrame.midY - 220
            )
            .scaleEffect(isAtIcon ? 0.3 : 1)
            .opacity(isAtIcon ? 0 : 1)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeIn(duration: 0.45)) {
                    isAtIcon = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    onComplete()
                }
            }
    }
}
