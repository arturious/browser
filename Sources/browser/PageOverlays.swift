import SwiftUI

/// A small pill-shaped loading indicator, styled after Zen Browser's: it
/// pulses gently (breathing scale + opacity) while a page loads, and if
/// loading takes more than a few seconds, settles into a steady wider pill
/// with a shimmer sweeping across it — rather than tracking exact load
/// percentage like a traditional progress bar.
struct PageLoadingBar: View {
    @ObservedObject var tab: BrowserTab
    @State private var isLongLoad = false
    @State private var isPulsing = false
    @State private var shimmerOffset: CGFloat = -1
    /// True once a load has been stuck in `isLongLoad` for an unusually
    /// long time (a hung/never-finishing navigation, not a normal slow
    /// page) — freezes the shimmer to a static bar instead of letting its
    /// `repeatForever` animation drive Core Animation at full frame rate
    /// indefinitely for however long the tab happens to sit there loading.
    @State private var isStalled = false
    @State private var longLoadTask: Task<Void, Never>?
    @State private var stallTask: Task<Void, Never>?

    private let pillWidth: CGFloat = 70
    private let longLoadWidth: CGFloat = 140
    private let pillHeight: CGFloat = 5

    var body: some View {
        Capsule()
            .fill(tab.themeColor ?? Color(white: 0.6))
            .overlay {
                if isLongLoad && !isStalled {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(Color.white.opacity(0.35))
                            .frame(width: proxy.size.width * 0.6)
                            .offset(x: shimmerOffset * proxy.size.width * 1.6)
                    }
                    .clipShape(Capsule())
                }
            }
            .frame(width: isLongLoad ? longLoadWidth : pillWidth, height: pillHeight)
            .scaleEffect(tab.isLoading ? (isLongLoad ? 1 : (isPulsing ? 0.95 : 0.85)) : 0.01)
            .opacity(tab.isLoading ? (isLongLoad ? 1 : (isPulsing ? 1 : 0.6)) : 0)
            .animation(.easeOut(duration: 0.3), value: tab.isLoading)
            .animation(.easeOut(duration: 0.3), value: isLongLoad)
            .animation(
                tab.isLoading && !isLongLoad
                    ? .easeInOut(duration: 1).repeatForever(autoreverses: true)
                    : .default,
                value: isPulsing
            )
            .allowsHitTesting(false)
            .onChange(of: tab.isLoading) { _, loading in
                longLoadTask?.cancel()
                stallTask?.cancel()
                isStalled = false
                if loading {
                    isLongLoad = false
                    isPulsing = false
                    DispatchQueue.main.async { isPulsing = true }
                    longLoadTask = Task {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        guard !Task.isCancelled, tab.isLoading else { return }
                        isLongLoad = true
                        startShimmer()
                    }
                } else {
                    isLongLoad = false
                }
            }
    }

    private func startShimmer() {
        shimmerOffset = -1
        withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
            shimmerOffset = 1
        }
        stallTask = Task {
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled, tab.isLoading else { return }
            withAnimation(.easeOut(duration: 0.3)) {
                isStalled = true
            }
        }
    }
}

/// Our own visual for the trackpad swipe-back/forward gesture, replacing
/// WebKit's built-in swipe animation (which isn't publicly customizable at
/// all — see SwipeAwareWebView, which reports live gesture progress instead
/// of letting WebKit handle the gesture itself).
struct SwipeNavigationOverlay: View {
    @ObservedObject var tab: BrowserTab

    var body: some View {
        HStack(spacing: 0) {
            if tab.swipeIsBack {
                indicator
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                indicator
            }
        }
        .allowsHitTesting(false)
    }

    private var indicator: some View {
        ZStack {
            LinearGradient(
                colors: [Color.black.opacity(0.4 * tab.swipeProgress), .clear],
                startPoint: tab.swipeIsBack ? .leading : .trailing,
                endPoint: tab.swipeIsBack ? .trailing : .leading
            )

            Image(systemName: tab.swipeIsBack ? "chevron.left" : "chevron.right")
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(.white.opacity(tab.swipeProgress))
                .scaleEffect(0.7 + 0.3 * tab.swipeProgress)
                .frame(maxWidth: 100, alignment: tab.swipeIsBack ? .leading : .trailing)
                .padding(tab.swipeIsBack ? .leading : .trailing, 16)
        }
        .frame(width: 100)
        .frame(maxHeight: .infinity)
        .animation(.easeOut(duration: 0.12), value: tab.swipeProgress)
    }
}
