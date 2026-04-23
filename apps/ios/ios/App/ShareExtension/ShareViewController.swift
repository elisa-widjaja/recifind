import UIKit
import UniformTypeIdentifiers
import MobileCoreServices

// Share extension: grab the first URL from the shared payload and hand it to
// the main app via `recifriend://add-recipe?url=…`. The VC has no UI — iOS
// typically transitions from the share sheet directly to the main app before
// any extension-owned frames render, so adding a custom splash here just
// introduced a visible flash without reducing latency.
//
// The key optimization vs. the original: the original iterated every
// attachment on every input item, entered a DispatchGroup for each, and
// waited for ALL loadItem calls to complete before acting. On a typical
// Instagram/TikTok share with a URL + a video attachment, that meant
// waiting for the slow video provider before the app opened, even though
// the URL was the first item resolved. This version stops at the first
// URL-type provider, acts on its result immediately, skips the rest, and
// only falls back to plain-text extraction if no URL-type provider exists.
// A `hasDispatched` flag makes re-entry safe.
class ShareViewController: UIViewController {
    private var hasDispatched = false

    override func viewDidLoad() {
        super.viewDidLoad()
        extractURLAndOpenApp()
    }

    private func extractURLAndOpenApp() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completeWithError("No items"); return
        }

        // Fast path: first URL-type provider wins.
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                    guard let self = self, !self.hasDispatched else { return }
                    if let url = data as? URL {
                        self.hasDispatched = true
                        DispatchQueue.main.async { self.openMainApp(with: url) }
                    } else {
                        self.tryPlainTextFallback(items: items)
                    }
                }
                return
            }
        }

        tryPlainTextFallback(items: items)
    }

    private func tryPlainTextFallback(items: [NSExtensionItem]) {
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                    guard let self = self, !self.hasDispatched else { return }
                    if let text = data as? String, let url = self.extractFirstHTTPURL(from: text) {
                        self.hasDispatched = true
                        DispatchQueue.main.async { self.openMainApp(with: url) }
                    } else {
                        DispatchQueue.main.async { self.completeWithError("No URL found") }
                    }
                }
                return
            }
        }
        DispatchQueue.main.async { self.completeWithError("No URL found") }
    }

    private func extractFirstHTTPURL(from text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let url = match.url,
              url.scheme == "http" || url.scheme == "https" else { return nil }
        return url
    }

    private func openMainApp(with sharedURL: URL) {
        var components = URLComponents()
        components.scheme = "recifriend"
        components.host = "add-recipe"
        components.queryItems = [URLQueryItem(name: "url", value: sharedURL.absoluteString)]
        guard let deepLink = components.url else { completeWithError("Bad URL"); return }

        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(deepLink, options: [:], completionHandler: nil)
                break
            }
            responder = responder?.next
        }
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    private func completeWithError(_ message: String) {
        let error = NSError(domain: "com.recifriend.share", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
        self.extensionContext?.cancelRequest(withError: error)
    }
}
