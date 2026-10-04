import UIKit
import WebKit

/// The whole app: one full-screen `WKWebView` pointed at the loopback server,
/// plus the native side of the bridge.
///
/// The guiding rule is that this file stays THIN. Anything that could live in
/// `native-bridge.js` does, because that file is shared with Android; what is
/// left here is only what genuinely needs UIKit.
final class WebViewController: UIViewController {

    private var webView: WKWebView!
    private let payload: WebPayload
    private let server: LocalWebServer
    private var statusBarDark = true
    private var hidesChrome = false

    init(payload: WebPayload, server: LocalWebServer) {
        self.payload = payload
        self.server = server
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: - Setup

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        // The DEFAULT (persistent) data store, so localStorage and IndexedDB
        // survive relaunch. This is where every mistake, session and setting
        // lives — a non-persistent store would hand the user an empty app on
        // every launch.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: "native")

        // Must run BEFORE review.html's own first inline script, which decides
        // IS_DEV_MODE from the hostname — and our host IS 127.0.0.1. Without
        // this the app would silently run in dev mode: console calls wrapped
        // and persisted into localStorage (500 entries per level, competing
        // with the user's own data for the same quota), POSTs to a /log
        // endpoint that does not exist, and a debug bar in the UI.
        controller.addUserScript(WKUserScript(
            source: "window.__NATIVE_APP__ = true; window.__NATIVE_PLATFORM__ = 'ios';",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        // The bridge is injected by the SHELL rather than loaded by a <script>
        // tag in review.html. Two reasons: the site on GitHub Pages should not
        // carry a file that only no-ops in a browser, and Android injects the
        // very same file the very same way — so one copy serves both and the
        // web app stays unaware it is running inside anything.
        if let bridgeURL = payload.resolve(path: "/native-bridge.js"),
           let bridge = try? String(contentsOf: bridgeURL, encoding: .utf8) {
            controller.addUserScript(WKUserScript(
                source: bridge, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        } else {
            NSLog("[QuranReview] native-bridge.js missing — dialogs and printing will not work")
        }

        controller.addUserScript(WKUserScript(
            source: Self.feelsNativeCSS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self

        // WKWebView's own back-swipe is OFF, deliberately. It walks history,
        // which knows nothing about the mushaf overlay or the ayah-history
        // panel — so in a full-screen overlay the gesture did nothing and
        // there was no way out ("I'm stuck and can't go back"). The edge pan
        // below asks the page first, through one rule that dismisses what is
        // open and only then falls through to history.
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false          // no long-press link popovers

        // The page already handles safe areas itself: review.html sets
        // `viewport-fit=cover` and uses env(safe-area-inset-*) in nine places.
        // Letting UIKit ALSO inset would double every one of them.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive

        // Bounce is kept — native apps bounce. What makes bounce look webby is
        // revealing a different-coloured void behind the page, so the view and
        // its scroll view take the page's own background instead.
        let ground = UIColor(red: 0.059, green: 0.082, blue: 0.125, alpha: 1)  // #0f1520
        webView.isOpaque = false
        webView.backgroundColor = ground
        webView.scrollView.backgroundColor = ground
        view.backgroundColor = ground

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // The gesture people reach for, wired to the page's own idea of "back".
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgeBack(_:)))
        edge.edges = .left
        edge.delegate = self
        webView.addGestureRecognizer(edge)

        load()

        // Only AFTER the page is already loading from disk — a slow network
        // must never delay launch, which is the entire reason for bundling.
        payload.checkForUpdate { updated in
            if updated { NSLog("[QuranReview] web files updated; applies next launch") }
        }
    }

    private func load() {
        guard let url = URL(string: server.origin + "/review.html") else { return }
        webView.load(URLRequest(url: url))
    }

    /// Asks the page to dismiss whatever is open. `__nativeBack()` returns true
    /// if it handled it; false means there is nothing left, and on iOS that is
    /// simply a no-op (unlike Android, where it would exit).
    @objc private func handleEdgeBack(_ gr: UIScreenEdgePanGestureRecognizer) {
        guard gr.state == .ended else { return }
        webView.evaluateJavaScript("window.__nativeBack && window.__nativeBack()")
    }

    // MARK: - Status bar

    override var preferredStatusBarStyle: UIStatusBarStyle {
        statusBarDark ? .lightContent : .darkContent
    }
    override var prefersStatusBarHidden: Bool { hidesChrome }
    override var prefersHomeIndicatorAutoHidden: Bool { hidesChrome }

    /// Every orientation. The mushaf spread is explicitly a landscape layout —
    /// it even shows a "turn your phone sideways" hint — so locking to
    /// portrait would make the app advise something it then forbids.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    // MARK: - Injected CSS

    /// The tells that a page is a page, removed. Deliberately small and
    /// deliberately HERE rather than in the stylesheet: it must not change how
    /// the site looks in a browser.
    private static let feelsNativeCSS = """
    (function () {
      const css = `
        html, body { overscroll-behavior: none; }
        body { -webkit-touch-callout: none; }
        /* Selection is off by default — in an app, long-pressing a label and
           getting a selection magnifier is a webpage tell. Put it back where
           text is genuinely there to be read and copied. */
        * { -webkit-touch-callout: none; }
        .ayah-ar, .mushaf-note, .mistake-ayah-preview, .mob-ar-block,
        .mdp-ayah, input, textarea, [contenteditable] {
          -webkit-touch-callout: default; -webkit-user-select: text; user-select: text;
        }
        /* The page sizes the mushaf against 100vh. In a browser that excludes
           the toolbars; in an app there are none, so the spread computes
           taller than it ever did in Safari. dvh is the honest unit for the
           visible viewport and matches what the layout assumed. */
        @supports (height: 100dvh) {
          :root { --app-vh: 100dvh; }
        }
      `;
      const style = document.createElement('style');
      style.id = 'native-feel';
      style.textContent = css;
      document.head.appendChild(style);
    })();
    """
}

// MARK: - The 128 dialogs

/// `alert`, `confirm` and `prompt` do NOTHING in a WKWebView unless these three
/// are implemented — and `confirm` returns false, so every destructive guard in
/// the app silently aborts. There are 90 alerts, 31 confirms and 7 prompts, and
/// the prompts are real data entry: ayah notes, rep counts, last-reviewed
/// dates, and which surah a Telegram message belongs to.
/// The edge pan must not fight the page's own horizontal panning — a zoomed
/// mushaf page is scrolled with exactly that motion.
extension WebViewController: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ g: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

extension WebViewController: WKUIDelegate {

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = defaultText
            // Several of these ask for a number (reps, a page) and several for
            // a date. Plain text is the only safe default, but selecting the
            // existing value means a correction is one tap rather than a
            // backspace-held-down.
            field.clearButtonMode = .whileEditing
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
            // Cancel must be nil, NOT "". The app distinguishes them: null
            // means "changed nothing", empty means "delete this note".
            completionHandler(nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        present(alert, animated: true)
    }
}

// MARK: - Navigation

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        // Our own origin navigates in place (review.html <-> hizb.html).
        if url.absoluteString.hasPrefix(server.origin) { decisionHandler(.allow); return }
        // Anything else is the wider web and belongs in the system browser,
        // not inside an app with no address bar or back button of its own.
        if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        NSLog("[QuranReview] load failed: \(error.localizedDescription)")
    }
}

// MARK: - The bridge

extension WebViewController: WKScriptMessageHandler {

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let name = body["name"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        let replyId = payload["__id"] as? Int

        switch name {
        case "haptic":
            let kind = payload["kind"] as? String ?? "light"
            let style: UIImpactFeedbackGenerator.FeedbackStyle =
                kind == "heavy" ? .heavy : kind == "medium" ? .medium : .light
            UIImpactFeedbackGenerator(style: style).impactOccurred()

        case "clipboard":
            UIPasteboard.general.string = payload["text"] as? String ?? ""
            reply(replyId, value: "true")

        case "clipboardRead":
            let text = UIPasteboard.general.string ?? ""
            reply(replyId, value: Self.jsString(text))

        case "share":
            let text = payload["text"] as? String ?? ""
            let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            // Required on iPad, harmless on iPhone.
            sheet.popoverPresentationController?.sourceView = view
            sheet.popoverPresentationController?.sourceRect =
                CGRect(x: view.bounds.midX, y: view.bounds.maxY, width: 0, height: 0)
            present(sheet, animated: true)
            reply(replyId, value: "true")

        case "print":
            printHTML(payload["html"] as? String ?? "",
                      title: payload["title"] as? String ?? "Quran Review")

        case "theme":
            statusBarDark = payload["dark"] as? Bool ?? true
            setNeedsStatusBarAppearanceUpdate()

        case "fullscreen":
            hidesChrome = payload["on"] as? Bool ?? false
            UIView.animate(withDuration: 0.2) {
                self.setNeedsStatusBarAppearanceUpdate()
                self.setNeedsUpdateOfHomeIndicatorAutoHidden()
            }

        case "backup":
            writeBackup(payload["json"] as? String ?? "")

        case "openExternal":
            if let s = payload["url"] as? String, let url = URL(string: s) {
                UIApplication.shared.open(url)
            }

        default:
            NSLog("[QuranReview] unknown bridge message: \(name)")
        }
    }

    private func reply(_ id: Int?, value: String) {
        guard let id else { return }
        webView.evaluateJavaScript("window.__nativeReply(\(id), \(value));")
    }

    private static func jsString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(json.dropFirst().dropLast())
    }

    /// Renders a complete HTML document with the system print panel.
    ///
    /// The app builds that document itself in `printHtmlDocument()`, inlining
    /// all of its print CSS, so what prints is exactly what the browser would
    /// have shown — no second stylesheet to drift.
    private func printHTML(_ html: String, title: String) {
        let formatter = UIMarkupTextPrintFormatter(markupText: html)
        formatter.perPageContentInsets = UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36)

        let info = UIPrintInfo.printInfo()
        info.outputType = .general
        info.jobName = title

        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printFormatter = formatter
        controller.present(animated: true)
    }

    /// A rolling JSON copy of everything, in the app's Documents directory so
    /// it is picked up by device and iCloud backups. All of the user's data
    /// otherwise lives only in WebKit's storage, which iOS may evict and which
    /// "Offload App" deletes outright.
    private func writeBackup(_ json: String) {
        guard !json.isEmpty,
              let dir = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return }
        let url = dir.appendingPathComponent("quran-log-backup.json")
        try? Data(json.utf8).write(to: url, options: .atomic)
    }
}
