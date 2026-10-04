import UIKit

/// Builds the single window.
///
/// A scene delegate rather than the old app-delegate `window` property: on a
/// current SDK the app launches, creates a scene, and then shows nothing at
/// all if the scene has no delegate to build a window — the process stays
/// alive with no UI, which looks exactly like a crash from the outside.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        AppCore.startIfNeeded()

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebViewController(payload: AppCore.payload,
                                                      server: AppCore.server)
        window.makeKeyAndVisible()
        self.window = window
    }
}
