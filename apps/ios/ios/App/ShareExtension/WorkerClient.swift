import Foundation

// Prod API base — hardcoded because the extension has no env vars.
// Match the Capacitor main-app config (apps/ios/capacitor.config.ts points
// webDir at the production worker via VITE_RECIPES_API_BASE_URL).
private let apiBase = URL(string: "https://api.recifriend.com")!

struct ParsePreview {
    let title: String
    let imageUrl: String?
}

struct CreateRecipeResult {
    let recipeId: String
    let statusCode: Int
}

enum WorkerClientError: Error {
    case badResponse(Int)
    case decoding
    case transport(Error)
    case timeout
    case unauthenticated
}

enum WorkerClient {
    /// Fetches og:title + og:image preview. 2s timeout per spec.
    static func parseRecipe(sourceUrl: String) async throws -> ParsePreview {
        let url = apiBase.appendingPathComponent("recipes/parse")
        // 4s (not 2s): each share invocation spawns a fresh extension process
        // with a cold TLS connection to api.recifriend.com. 2s was hitting
        // intermittent timeouts on second-and-later shares.
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 4.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["sourceUrl": sourceUrl])

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw WorkerClientError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let parsed = json["parsed"] as? [String: Any]
        else { throw WorkerClientError.decoding }

        let title = (parsed["title"] as? String) ?? ""
        let imageUrl = (parsed["imageUrl"] as? String) ?? nil
        return ParsePreview(title: title, imageUrl: imageUrl?.isEmpty == false ? imageUrl : nil)
    }

    /// Saves a minimum-viable recipe. 5s timeout per spec.
    /// On 401, callers should clear the stored JWT and deep-link to the main app.
    static func createRecipe(
        title: String,
        sourceUrl: String,
        imageUrl: String?,
        jwt: String
    ) async throws -> CreateRecipeResult {
        let url = apiBase.appendingPathComponent("recipes")
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 5.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "title": title,
            "sourceUrl": sourceUrl,
            "ingredients": [],
            "steps": [],
        ]
        if let imageUrl = imageUrl { payload["imageUrl"] = imageUrl }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw WorkerClientError.badResponse(-1)
        }
        if http.statusCode == 401 { throw WorkerClientError.unauthenticated }
        guard (200...299).contains(http.statusCode) else { throw WorkerClientError.badResponse(http.statusCode) }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let recipe = json["recipe"] as? [String: Any],
            let id = recipe["id"] as? String
        else { throw WorkerClientError.decoding }

        return CreateRecipeResult(recipeId: id, statusCode: http.statusCode)
    }
}
