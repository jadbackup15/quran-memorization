import Foundation

/// Where the web files come from, and how they are kept current.
///
/// Two layers, checked in order:
/// 1. **Updates** — `Application Support/web/`, written by `checkForUpdate()`.
/// 2. **Bundle** — `QuranReview.app/web/`, shipped with the build.
///
/// So a file the updater has never fetched falls through to the bundled copy,
/// and the app works fully offline from first launch with no network at all.
/// The 123 MB of mushaf page images live ONLY in the bundle and are never
/// updated — they are fixed for this mushaf edition, and `quran-line-bands.js`
/// is keyed to exactly these images (swapping one without the other shifts
/// every highlight by a line, silently).
final class WebPayload {

    private let fm = FileManager.default
    private let bundleRoot: URL
    private let updateRoot: URL

    /// Files the updater may replace. Deliberately an allow-list rather than
    /// "whatever the server has": this fetches over the network into a
    /// directory we then serve as the app, so it must not be possible for an
    /// unexpected path to appear in it.
    static let updatableFiles = [
        "review.html",
        "hizb.html",
        "version.js",
        "log.js",
        "quran-data.js",
        "quran-cache.js",
        "mistake-analytics.js",
        "quran-line-bands.js",
        "native-bridge.js",
        "native-app.css",
        "manifest.json",
        "agent-prompts/prompts.md",
        "agent-prompts/ai-clusters-prompt.md",
    ]

    static let remoteBase = URL(string: "https://jadbackup15.github.io/quran-memorization/")!

    init() {
        bundleRoot = Bundle.main.bundleURL.appendingPathComponent("web", isDirectory: true)
        updateRoot = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                  appropriateFor: nil, create: true))?
            .appendingPathComponent("web", isDirectory: true)
            ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("web")
        try? fm.createDirectory(at: updateRoot, withIntermediateDirectories: true)
    }

    /// Maps a request path onto a real file, update layer first.
    ///
    /// Rejects anything that escapes the roots. A path like `/../../Documents`
    /// would otherwise serve the app's own data over HTTP — only to loopback,
    /// but there is no reason to allow it.
    func resolve(path: String) -> URL? {
        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard !relative.isEmpty, !relative.contains("..") else { return nil }

        for root in [updateRoot, bundleRoot] {
            let candidate = root.appendingPathComponent(relative).standardizedFileURL
            guard candidate.path.hasPrefix(root.standardizedFileURL.path) else { continue }
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: candidate.path, isDirectory: &isDir), !isDir.boolValue {
                return candidate
            }
        }
        return nil
    }

    // MARK: - Update on launch

    /// Fetches any web file whose remote copy differs, into the update layer.
    ///
    /// Runs in the background AFTER the web view has already loaded from what
    /// is on disk, so a slow or absent network never delays launch — the whole
    /// point of bundling. Anything fetched takes effect on the NEXT launch
    /// rather than mid-session: swapping `review.html` under a running page
    /// would leave the loaded script and the files it then fetches from
    /// different versions of the app.
    /// What the update check found, so the UI can SAY it.
    ///
    /// An update applies on the next launch, so without this the user has no
    /// way to tell a successful update from one that never happened — reported
    /// as "it doesn't seem you updated the latest version" after a push that
    /// was verifiably live.
    struct UpdateStatus {
        /// The version being served right now.
        let current: String
        /// The newest published version, or nil if the server was unreachable.
        let latest: String?
        /// A newer version is on disk and takes effect on the next launch.
        let pending: Bool
    }

    func checkForUpdate(completion: @escaping (UpdateStatus) -> Void) {
        let current = currentVersion()
        fetchRemoteVersion { [weak self] remote in
            guard let self else { return }
            guard let remote else {
                completion(UpdateStatus(current: current, latest: nil, pending: false))
                return
            }
            guard Self.isNewer(remote, than: current) else {
                completion(UpdateStatus(current: current, latest: remote, pending: false))
                return
            }
            self.downloadAll { changed in
                completion(UpdateStatus(current: current, latest: remote, pending: changed))
            }
        }
    }

    /// The version actually being served — update layer first, like `resolve`.
    func currentVersion() -> String {
        guard let url = resolve(path: "/version.js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "0.0.0" }
        return Self.parseVersion(text) ?? "0.0.0"
    }

    private func fetchRemoteVersion(_ done: @escaping (String?) -> Void) {
        var req = URLRequest(url: Self.remoteBase.appendingPathComponent("version.js"))
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 10
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data, let text = String(data: data, encoding: .utf8) else { done(nil); return }
            done(Self.parseVersion(text))
        }.resume()
    }

    /// Downloads every updatable file to a staging directory, and only moves
    /// them into place once ALL of them have arrived. A half-applied update —
    /// a new `review.html` beside an old `quran-data.js` — is worse than no
    /// update at all, and this is the only thing standing between the two.
    private func downloadAll(_ done: @escaping (Bool) -> Void) {
        let staging = updateRoot.deletingLastPathComponent()
            .appendingPathComponent("web-staging", isDirectory: true)
        try? fm.removeItem(at: staging)
        try? fm.createDirectory(at: staging, withIntermediateDirectories: true)

        let group = DispatchGroup()
        var failed = false
        let lock = NSLock()

        for relative in Self.updatableFiles {
            group.enter()
            var req = URLRequest(url: Self.remoteBase.appendingPathComponent(relative))
            req.cachePolicy = .reloadIgnoringLocalCacheData
            req.timeoutInterval = 30
            URLSession.shared.dataTask(with: req) { data, response, _ in
                defer { group.leave() }
                guard let data, !data.isEmpty,
                      let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    lock.lock(); failed = true; lock.unlock()
                    return
                }
                let dest = staging.appendingPathComponent(relative)
                try? self.fm.createDirectory(at: dest.deletingLastPathComponent(),
                                             withIntermediateDirectories: true)
                do { try data.write(to: dest, options: .atomic) }
                catch { lock.lock(); failed = true; lock.unlock() }
            }.resume()
        }

        group.notify(queue: .main) {
            defer { try? self.fm.removeItem(at: staging) }
            guard !failed else {
                NSLog("[QuranReview] update: a file failed to download; nothing applied")
                done(false); return
            }
            for relative in Self.updatableFiles {
                let from = staging.appendingPathComponent(relative)
                let to = self.updateRoot.appendingPathComponent(relative)
                try? self.fm.createDirectory(at: to.deletingLastPathComponent(),
                                             withIntermediateDirectories: true)
                // `replaceItemAt` REQUIRES the destination to already exist.
                // On a first update nothing is there, so every file failed
                // silently inside `try?` — the updater downloaded the whole
                // payload correctly and then threw it away, every time, for
                // the life of the install. Reported as "it still looks the
                // same" after a push that was verifiably live.
                do {
                    if self.fm.fileExists(atPath: to.path) {
                        _ = try self.fm.replaceItemAt(to, withItemAt: from)
                    } else {
                        try self.fm.moveItem(at: from, to: to)
                    }
                } catch {
                    NSLog("[QuranReview] update: could not place \(relative): \(error)")
                }
            }
            NSLog("[QuranReview] update: applied \(Self.updatableFiles.count) files")
            done(true)
        }
    }

    // MARK: - Version parsing

    /// Reads `const APP_VERSION = "6.9.0";` out of version.js.
    static func parseVersion(_ text: String) -> String? {
        guard let r = text.range(of: #"APP_VERSION\s*=\s*"([^"]+)""#, options: .regularExpression)
        else { return nil }
        let match = String(text[r])
        guard let q = match.range(of: #""([^"]+)""#, options: .regularExpression) else { return nil }
        return String(match[q]).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }

    /// Same numeric, per-segment comparison as `isNewerVersion()` in
    /// version.js — the minor rolls over at 100 there, so comparing segment by
    /// segment as integers is required, not string ordering.
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<3 {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
