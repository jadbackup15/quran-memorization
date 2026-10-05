import Foundation
import Network

/// Serves the bundled web app over HTTP on 127.0.0.1, on a random high port.
///
/// **Why a loopback server rather than `WKURLSchemeHandler`.** The web app is
/// unchanged from what GitHub Pages serves, and it leans on things that only
/// work from a real, secure origin:
///
/// - `localhost` is "potentially trustworthy" per spec, so the page is a
///   SECURE CONTEXT — `navigator.clipboard` works, and so would a service
///   worker. A custom scheme is not secure, and WebKit sends `Origin: null`
///   from one, which the app's own Cloud Run bot and Firestore's WebChannel
///   can reject.
/// - Relative `fetch()` of `agent-prompts/prompts.md` and `version.js` just
///   works, with no handler to get subtly wrong.
/// - `localStorage` is keyed to the origin, and this origin is stable for the
///   life of the install — see `Self.port`.
///
/// The cost is this file. It is deliberately the smallest HTTP server that can
/// serve static files correctly: GET and HEAD, byte ranges (the mushaf JPEGs
/// are large and WebKit asks for ranges), correct MIME types, and nothing else.
final class LocalWebServer {

    /// The port is derived once and then reused for the life of the install.
    ///
    /// This matters more than it looks: `localStorage` and IndexedDB are keyed
    /// to the ORIGIN, and the origin includes the port. A fresh random port on
    /// every launch would hand the user an empty app each time — every
    /// mistake, session and setting gone, with the data still sitting in
    /// WebKit under the old origin. So it is chosen once and persisted.
    static let port: UInt16 = {
        let key = "QuranReviewLocalPort"
        if let saved = UserDefaults.standard.object(forKey: key) as? Int,
           saved >= 1024, saved <= 65535 {
            return UInt16(saved)
        }
        let picked = UInt16.random(in: 49152...65500)   // ephemeral range
        UserDefaults.standard.set(Int(picked), forKey: key)
        return picked
    }()

    private var listener: NWListener?
    /// CONCURRENT, deliberately. The Mutashabihat compare renders four page
    /// images at once and the mushaf spread two, so several ~200 KB reads are
    /// genuinely in flight together. On a serial queue each one blocked the
    /// next — including its send completion — which is what made the sends
    /// below pile up and truncate.
    private let queue = DispatchQueue(label: "local-web-server", qos: .userInitiated,
                                      attributes: .concurrent)

    /// Where files are served from, in order: the updated copy in Application
    /// Support first, then the copy shipped inside the app. `WebPayload` owns
    /// that decision; this server just asks it to resolve a path.
    private let payload: WebPayload

    init(payload: WebPayload) {
        self.payload = payload
    }

    func start() throws {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback      // never reachable off-device
        params.allowLocalEndpointReuse = true

        let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!)
        listener.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    var origin: String { "http://127.0.0.1:\(Self.port)" }

    // MARK: - Connection handling

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(on: conn, buffer: Data())
    }

    /// Reads until the end of the request head. Requests here are always small
    /// (no bodies — the page only ever GETs from this origin), so the headers
    /// are the whole request.
    private func receive(on conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }

            if let range = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buf[..<range.lowerBound], as: UTF8.self)
                self.respond(to: head, on: conn)
                return
            }
            if error != nil || isComplete || buf.count > 64 * 1024 {
                conn.cancel()
                return
            }
            self.receive(on: conn, buffer: buf)
        }
    }

    private func respond(to head: String, on conn: NWConnection) {
        let lines = head.split(separator: "\r\n", omittingEmptySubsequences: false)
        guard let requestLine = lines.first else { conn.cancel(); return }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { conn.cancel(); return }

        let method = String(parts[0]).uppercased()
        guard method == "GET" || method == "HEAD" else {
            send(status: "405 Method Not Allowed", headers: [:], body: Data(), on: conn)
            return
        }

        // Strip the query string — the app uses it (`hizb.html?hizb=3`) but it
        // never selects a file. Keeping it would simply fail to resolve.
        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path == "/" { path = "/review.html" }

        // A `Range:` header, which WebKit sends for the larger page images.
        let rangeHeader = lines.first { $0.lowercased().hasPrefix("range:") }
            .map { String($0.dropFirst("range:".count)).trimmingCharacters(in: .whitespaces) }

        guard let url = payload.resolve(path: path),
              let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int else {
            send(status: "404 Not Found", headers: ["Content-Type": "text/plain"],
                 body: Data("Not found: \(path)".utf8), on: conn)
            return
        }

        var headers = [
            "Content-Type": Self.mimeType(for: url.pathExtension),
            "Accept-Ranges": "bytes",
            // The app is the only client and it ships with its own files, so
            // nothing here should be cached by WebKit across an update — the
            // updater swapping a file must take effect on the next load.
            "Cache-Control": "no-cache",
        ]

        var status = "200 OK"
        var body = Data()

        if let spec = rangeHeader, let (start, end) = Self.parseRange(spec, size: size) {
            status = "206 Partial Content"
            headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
            if method == "GET" { body = Self.read(url, from: start, count: end - start + 1) }
            headers["Content-Length"] = String(end - start + 1)
        } else {
            if method == "GET" { body = (try? Data(contentsOf: url, options: .mappedIfSafe)) ?? Data() }
            headers["Content-Length"] = String(size)
        }

        send(status: status, headers: headers, body: body, on: conn)
    }

    /// Sends the response and closes GRACEFULLY.
    ///
    /// This used to be `send(... .contentProcessed { _ in conn.cancel() })`,
    /// which truncates. `.contentProcessed` fires when the bytes have been
    /// handed to the transport, NOT when they have reached the peer, and
    /// `cancel()` tears the connection down immediately — any bytes still in
    /// the send buffer are discarded and the peer sees a short read.
    ///
    /// On a ~200 KB JPEG that is the difference between a page and a broken
    /// image icon, and it is INTERMITTENT: a single small response usually
    /// drains within one segment, while several large ones in flight together
    /// do not. That is exactly the reported shape — "the first time I tried
    /// Mutashabihat the images were not loading, the second time it works" —
    /// since that view asks for four page images at once.
    ///
    /// Sending `nil` with `.finalMessage` queues a real FIN after the payload,
    /// so the close happens in order, after the data. The connection is then
    /// cancelled from the state handler rather than from here.
    private func send(status: String, headers: [String: String], body: Data, on conn: NWConnection) {
        var head = "HTTP/1.1 \(status)\r\n"
        for (k, v) in headers { head += "\(k): \(v)\r\n" }
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)

        conn.send(content: out, completion: .contentProcessed { error in
            if error != nil { conn.cancel(); return }
            conn.send(content: nil, contentContext: .finalMessage, isComplete: true,
                      completion: .contentProcessed { _ in
                          // The FIN is queued behind the payload; closing now
                          // cannot discard it.
                          conn.cancel()
                      })
        })
    }

    // MARK: - Helpers

    /// Reads a byte range without pulling the whole file into memory — the
    /// mushaf pages are up to a few hundred KB each and WebKit will ask for
    /// ranges of several at once while paging.
    private static func read(_ url: URL, from offset: Int, count: Int) -> Data {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return Data() }
        defer { try? handle.close() }
        try? handle.seek(toOffset: UInt64(offset))
        return (try? handle.read(upToCount: count)) ?? Data()
    }

    /// Only the single-range form, which is all WebKit sends for images.
    static func parseRange(_ spec: String, size: Int) -> (Int, Int)? {
        guard spec.hasPrefix("bytes="), size > 0 else { return nil }
        let value = spec.dropFirst("bytes=".count)
        guard !value.contains(",") else { return nil }          // multi-range: fall back to 200
        let halves = value.split(separator: "-", omittingEmptySubsequences: false)
        guard halves.count == 2 else { return nil }

        let startText = halves[0].trimmingCharacters(in: .whitespaces)
        let endText = halves[1].trimmingCharacters(in: .whitespaces)

        if startText.isEmpty {                                   // "bytes=-500" — the last N bytes
            guard let n = Int(endText), n > 0 else { return nil }
            return (max(0, size - n), size - 1)
        }
        guard let start = Int(startText), start < size else { return nil }
        let end = Int(endText).map { min($0, size - 1) } ?? size - 1
        guard end >= start else { return nil }
        return (start, end)
    }

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm":  return "text/html; charset=utf-8"
        case "js", "mjs":    return "text/javascript; charset=utf-8"
        case "css":          return "text/css; charset=utf-8"
        case "json":         return "application/json; charset=utf-8"
        case "md":           return "text/markdown; charset=utf-8"
        case "jpg", "jpeg":  return "image/jpeg"
        case "png":          return "image/png"
        case "svg":          return "image/svg+xml"
        case "webmanifest":  return "application/manifest+json"
        case "woff2":        return "font/woff2"
        case "woff":         return "font/woff"
        case "txt":          return "text/plain; charset=utf-8"
        default:             return "application/octet-stream"
        }
    }
}
