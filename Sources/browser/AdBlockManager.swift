import WebKit

/// Downloads EasyList/EasyPrivacy, converts the subset of rules WKContentRuleList
/// can express (domain/host blocking) into its declarative JSON format, and
/// keeps every tab's WKWebView using the latest compiled list.
///
/// WKContentRuleList is WebKit's native content-blocking mechanism (the same
/// one Safari's content blockers use) — a static, precompiled rule set the
/// engine applies before a request is even made, rather than running JS on
/// every page load.
@MainActor
final class AdBlockManager: ObservableObject {
    static let shared = AdBlockManager()

    private static let listIdentifier = "AdBlockRules"
    private static let enabledDefaultsKey = "adBlockEnabled"
    private static let sourceURLs = [
        URL(string: "https://easylist.to/easylist/easylist.txt")!,
        URL(string: "https://easylist.to/easylist/easyprivacy.txt")!,
    ]

    private var cachedTextFileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("browser", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("adblock-filters.txt")
    }

    private(set) var currentRuleList: WKContentRuleList?
    private var registeredControllers: [WKUserContentController] = []
    private let updateInterval: TimeInterval = 24 * 60 * 60

    @Published var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledDefaultsKey)
            applyEnabledState()
        }
    }

    private init() {
        if UserDefaults.standard.object(forKey: Self.enabledDefaultsKey) == nil {
            isEnabled = true
        } else {
            isEnabled = UserDefaults.standard.bool(forKey: Self.enabledDefaultsKey)
        }
    }

    func start() {
        loadCachedListIfPresent()
        refreshIfStale()
    }

    /// Registers a tab's content controller so it gets the current rule list
    /// immediately (if already compiled) and any future updates.
    func register(_ controller: WKUserContentController) {
        registeredControllers.append(controller)
        if isEnabled, let currentRuleList {
            controller.add(currentRuleList)
        }
    }

    private func applyEnabledState() {
        guard let currentRuleList else { return }
        for controller in registeredControllers {
            if isEnabled {
                controller.add(currentRuleList)
            } else {
                controller.remove(currentRuleList)
            }
        }
    }

    private func loadCachedListIfPresent() {
        guard let text = try? String(contentsOf: cachedTextFileURL, encoding: .utf8) else { return }
        compile(filterText: text)
    }

    private func refreshIfStale() {
        let attributes = try? FileManager.default.attributesOfItem(atPath: cachedTextFileURL.path)
        let lastModified = attributes?[.modificationDate] as? Date
        if let lastModified, Date().timeIntervalSince(lastModified) < updateInterval {
            return
        }
        Task {
            await downloadAndCompile()
        }
    }

    private func downloadAndCompile() async {
        var combined = ""
        for url in Self.sourceURLs {
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200,
                  let text = String(data: data, encoding: .utf8) else { continue }
            combined += text + "\n"
        }
        guard !combined.isEmpty else { return }

        // Overwrite the single cached file in place — never accumulate
        // dated copies, so disk usage stays flat at a few MB regardless of
        // how many times this runs.
        try? combined.write(to: cachedTextFileURL, atomically: true, encoding: .utf8)
        compile(filterText: combined)
    }

    private func compile(filterText: String) {
        let json = Self.convertToContentRuleListJSON(filterText)
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: Self.listIdentifier,
            encodedContentRuleList: json
        ) { [weak self] ruleList, error in
            guard let self, let ruleList else { return }
            // Swap in the new list for every already-open tab.
            if let old = self.currentRuleList {
                for controller in self.registeredControllers {
                    controller.remove(old)
                }
            }
            self.currentRuleList = ruleList
            guard self.isEnabled else { return }
            for controller in self.registeredControllers {
                controller.add(ruleList)
            }
        }
    }

    /// Converts the domain-blocking subset of Adblock Plus filter syntax
    /// (`||domain.com^`) into WKContentRuleList's declarative JSON format.
    /// Cosmetic rules (`##...`), exceptions (`@@...`), and option-qualified
    /// rules are skipped for this first pass — domain/host blocking alone
    /// covers the large majority of ad/tracker requests in these lists.
    private static func convertToContentRuleListJSON(_ filterText: String) -> String {
        var rules: [[String: Any]] = []
        var seenDomains = Set<String>()

        for rawLine in filterText.split(separator: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("||"), line.hasSuffix("^") else { continue }
            guard !line.contains("#"), !line.contains("$"), !line.contains("*") else { continue }

            let domain = String(line.dropFirst(2).dropLast(1))
            guard !domain.isEmpty, domain.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }) else {
                continue
            }
            guard seenDomains.insert(domain).inserted else { continue }

            let escaped = domain.replacingOccurrences(of: ".", with: "\\.")
            rules.append([
                "trigger": [
                    "url-filter": "^https?://([a-z0-9-]+\\.)*\(escaped)",
                    "url-filter-is-case-sensitive": false,
                ] as [String: Any],
                "action": ["type": "block"],
            ])
        }

        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return json
    }
}
