import AppKit
import WebKit

struct DownloadItem: Identifiable, Equatable {
    let id: UUID
    var filename: String
    var progress: Double
    var isFinished: Bool
    var failed: Bool
    var destinationURL: URL?

    static func == (lhs: DownloadItem, rhs: DownloadItem) -> Bool {
        lhs.id == rhs.id && lhs.progress == rhs.progress && lhs.isFinished == rhs.isFinished && lhs.failed == rhs.failed
    }
}

/// A one-shot trigger for the "file flies to the downloads icon" animation.
struct DownloadFlyRequest: Identifiable, Equatable {
    let id = UUID()
}

@MainActor
final class DownloadManager: NSObject, WKDownloadDelegate, ObservableObject {
    static let shared = DownloadManager()

    @Published var downloads: [DownloadItem] = []
    @Published var flyRequest: DownloadFlyRequest?
    @Published var hasUnseenFinishedDownloads = false

    private var progressObservations: [UUID: NSKeyValueObservation] = [:]
    private var downloadItemIds: [ObjectIdentifier: UUID] = [:]

    func markDownloadsSeen() {
        hasUnseenFinishedDownloads = false
    }

    func beginTracking(_ download: WKDownload) {
        download.delegate = self
        flyRequest = DownloadFlyRequest()
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String
    ) async -> URL? {
        let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let destination = Self.uniqueDestination(in: downloadsDir, filename: suggestedFilename)

        let itemId = UUID()
        downloadItemIds[ObjectIdentifier(download)] = itemId
        downloads.insert(
            DownloadItem(id: itemId, filename: destination.lastPathComponent, progress: 0, isFinished: false, failed: false, destinationURL: destination),
            at: 0
        )

        let observation = download.progress.observe(\.fractionCompleted, options: [.new]) { [weak self] progress, _ in
            Task { @MainActor in
                guard let self, let index = self.downloads.firstIndex(where: { $0.id == itemId }) else { return }
                self.downloads[index].progress = progress.fractionCompleted
            }
        }
        progressObservations[itemId] = observation

        return destination
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        guard let itemId = downloadItemIds[key],
              let index = downloads.firstIndex(where: { $0.id == itemId }) else { return }
        downloads[index].isFinished = true
        downloads[index].progress = 1
        progressObservations[itemId] = nil
        downloadItemIds[key] = nil
        hasUnseenFinishedDownloads = true
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        guard let itemId = downloadItemIds[key],
              let index = downloads.firstIndex(where: { $0.id == itemId }) else { return }
        downloads[index].failed = true
        downloads[index].isFinished = true
        progressObservations[itemId] = nil
        downloadItemIds[key] = nil
    }

    func revealInFinder(_ item: DownloadItem) {
        guard let url = item.destinationURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func openFile(_ item: DownloadItem) {
        guard let url = item.destinationURL else { return }
        NSWorkspace.shared.open(url)
    }

    private static func uniqueDestination(in directory: URL, filename: String) -> URL {
        var candidate = directory.appendingPathComponent(filename)
        guard FileManager.default.fileExists(atPath: candidate.path) else { return candidate }

        let ext = (filename as NSString).pathExtension
        let base = (filename as NSString).deletingPathExtension
        var counter = 1
        repeat {
            let newName = ext.isEmpty ? "\(base) (\(counter))" : "\(base) (\(counter)).\(ext)"
            candidate = directory.appendingPathComponent(newName)
            counter += 1
        } while FileManager.default.fileExists(atPath: candidate.path)
        return candidate
    }
}
