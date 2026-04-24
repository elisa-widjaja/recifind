import UIKit
import SwiftUI
import UniformTypeIdentifiers

// Share extension host. Extracts the first URL from the share payload (fast
// path from the previous version), fetches a preview from the worker, and
// renders a SwiftUI form with thumbnail + editable title + Save. On Save,
// POSTs to /recipes with the JWT from shared Keychain. Any failure path
// falls back to deep-linking `recifriend://add-recipe?url=<raw>` to the main
// app's existing drawer flow (A2 fallback).
final class ShareViewController: UIViewController {
    private var hostingController: UIHostingController<ShareFormView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        extractFirstURL { [weak self] url in
            guard let self = self else { return }
            if let url = url {
                DispatchQueue.main.async { self.presentForm(for: url) }
            } else {
                DispatchQueue.main.async { self.completeWithError("No URL found") }
            }
        }
    }

    // MARK: - URL extraction (first-URL-wins, unchanged from previous fast path)

    private func extractFirstURL(completion: @escaping (URL?) -> Void) {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            completion(nil); return
        }
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
                    if let url = data as? URL { completion(url); return }
                    self.tryPlainTextFallback(items: items, completion: completion)
                }
                return
            }
        }
        tryPlainTextFallback(items: items, completion: completion)
    }

    private func tryPlainTextFallback(items: [NSExtensionItem], completion: @escaping (URL?) -> Void) {
        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
                    if let text = data as? String, let url = Self.extractFirstHTTPURL(from: text) {
                        completion(url); return
                    }
                    completion(nil)
                }
                return
            }
        }
        completion(nil)
    }

    private static func extractFirstHTTPURL(from text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = detector?.firstMatch(in: text, options: [], range: range),
              let url = match.url,
              url.scheme == "http" || url.scheme == "https" else { return nil }
        return url
    }

    // MARK: - Form presentation

    private func presentForm(for sourceURL: URL) {
        let viewModel = ShareFormViewModel(sourceURL: sourceURL, onFinish: { [weak self] outcome in
            DispatchQueue.main.async { self?.finish(with: outcome, sourceURL: sourceURL) }
        })
        let root = ShareFormView(viewModel: viewModel)
        let host = UIHostingController(rootView: root)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    // MARK: - Finish / fallback

    enum Outcome {
        case saved(recipeId: String)
        case cancelled
        case fallback  // A2: open main-app drawer via deep link
        case viewInApp(recipeId: String)  // User tapped "View on ReciFriend" after save
    }

    private func finish(with outcome: Outcome, sourceURL: URL) {
        switch outcome {
        case .saved:
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        case .cancelled:
            self.extensionContext?.cancelRequest(withError: NSError(
                domain: "com.recifriend.share", code: 0,
                userInfo: [NSLocalizedDescriptionKey: "Cancelled"]
            ))
        case .fallback:
            // Wait for the URL to actually be delivered before the extension
            // dismisses — iOS can tear us down before completing the open,
            // causing the main app to miss the appUrlOpen event.
            openDeepLink(for: sourceURL) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
        case .viewInApp(let recipeId):
            openRecipeInApp(recipeId: recipeId) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            }
        }
    }

    private func openDeepLink(for sourceURL: URL, completion: @escaping (Bool) -> Void) {
        var components = URLComponents()
        components.scheme = "recifriend"
        components.host = "add-recipe"
        components.queryItems = [URLQueryItem(name: "url", value: sourceURL.absoluteString)]
        guard let deepLink = components.url else { completion(false); return }
        openURL(deepLink, completion: completion)
    }

    private func openRecipeInApp(recipeId: String, completion: @escaping (Bool) -> Void) {
        // recifriend://recipes (no id) opens the recipe collection page.
        // Handled by the main app's deepLinkDispatch recipes_list kind.
        // recipeId unused for now — kept on the outcome for a possible future
        // "open this specific recipe" flavor.
        _ = recipeId
        guard let url = URL(string: "recifriend://recipes") else { completion(false); return }
        openURL(url, completion: completion)
    }

    private func openURL(_ url: URL, completion: @escaping (Bool) -> Void) {
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(url, options: [:], completionHandler: completion)
                return
            }
            responder = responder?.next
        }
        completion(false)
    }

    private func completeWithError(_ message: String) {
        let error = NSError(domain: "com.recifriend.share", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
        self.extensionContext?.cancelRequest(withError: error)
    }
}
