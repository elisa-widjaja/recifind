import UIKit
import UniformTypeIdentifiers
import MobileCoreServices

class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        extractURLAndOpenApp()
    }

    private func extractURLAndOpenApp() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completeWithError("No items"); return
        }
        let group = DispatchGroup()
        var foundURL: URL?
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                        if let url = data as? URL, foundURL == nil { foundURL = url }
                        group.leave()
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                        if let text = data as? String, foundURL == nil, let extracted = self.extractFirstHTTPURL(from: text) {
                            foundURL = extracted
                        }
                        group.leave()
                    }
                }
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            guard let url = foundURL else { self.completeWithError("No URL found"); return }
            self.openMainApp(with: url)
        }
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
