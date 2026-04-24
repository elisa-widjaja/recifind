import UIKit
import Capacitor

// Custom CAPBridgeViewController so we can register inline Capacitor plugins
// that aren't installed as npm packages. Capacitor 8 auto-discovers plugins
// via capacitor.config.json's packageClassList (populated only for npm
// plugins), so anything built into the main-app target must be registered
// manually here.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SharedAuthStorePlugin())
    }
}
