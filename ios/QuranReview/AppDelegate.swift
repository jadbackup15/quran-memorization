import UIKit

/// Shared, process-wide pieces. The scene builds the UI; this owns the things
/// that must exist before any window does and must outlive all of them.
enum AppCore {
    static let payload = WebPayload()
    static let server = LocalWebServer(payload: payload)

    static func startIfNeeded() {
        guard !started else { return }
        started = true
        do {
            try server.start()
        } catch {
            // The port is persisted so the storage origin never moves, which
            // means the usual cause is a stale listener from a previous run.
            NSLog("[QuranReview] could not start local server: \(error)")
        }
    }
    private static var started = false
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions:
                        [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppCore.startIfNeeded()
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
