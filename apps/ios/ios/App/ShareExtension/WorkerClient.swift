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

/// Result of a synchronous /recipes/enrich call. Any field may be nil/empty
/// when the server couldn't extract that field; callers should prefer
/// their own local snapshots (user-typed title, preview image) first and
/// fall back to these values.
struct EnrichResult {
    let title: String?
    let imageUrl: String?
    let mealTypes: [String]
    let ingredients: [String]
    let steps: [String]
    let durationMinutes: Int?
    let notes: String?
    let provenance: String? // "extracted" | "inferred" | nil
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

    /// Runs the worker's enrichment chain synchronously against sourceUrl +
    /// title. Returns `nil` on any failure path (timeout, 401, network,
    /// parse error) so the caller can silently fall back to a fast save.
    /// Absolute 10s wall-clock deadline via URLSessionConfiguration so the
    /// share extension never blocks longer than that on a slow Gemini call.
    static func enrichRecipe(
        sourceUrl: String,
        title: String,
        jwt: String
    ) async -> EnrichResult? {
        let url = apiBase.appendingPathComponent("recipes/enrich")
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = ["sourceUrl": sourceUrl, "title": title]
        guard let httpBody = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        req.httpBody = httpBody

        // Dedicated session so timeoutIntervalForResource enforces an
        // absolute wall-clock limit (unlike per-request timeoutInterval
        // which resets on streamed chunks).
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10.0
        config.timeoutIntervalForResource = 10.0
        let session = URLSession(configuration: config)

        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let enriched = json["enriched"] as? [String: Any]
            else { return nil }

            let titleValue = (enriched["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let imageValue = (enriched["imageUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let notesValue = (enriched["notes"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let durationValue: Int? = {
                if let i = enriched["durationMinutes"] as? Int { return i }
                if let d = enriched["durationMinutes"] as? Double, d.isFinite { return Int(d) }
                return nil
            }()
            return EnrichResult(
                title: titleValue,
                imageUrl: imageValue,
                mealTypes: (enriched["mealTypes"] as? [String]) ?? [],
                ingredients: (enriched["ingredients"] as? [String]) ?? [],
                steps: (enriched["steps"] as? [String]) ?? [],
                durationMinutes: durationValue,
                notes: notesValue,
                provenance: enriched["provenance"] as? String
            )
        } catch {
            return nil
        }
    }

    /// Saves a recipe. 12s timeout (up from 5s) because when a caller passes
    /// non-nil `enriched`, the POST body is larger and a cold-TLS first
    /// share can still complete comfortably within that window.
    /// On 401, callers should clear the stored JWT and deep-link to the main app.
    static func createRecipe(
        title: String,
        sourceUrl: String,
        imageUrl: String?,
        enriched: EnrichResult? = nil,
        jwt: String
    ) async throws -> CreateRecipeResult {
        let url = apiBase.appendingPathComponent("recipes")
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 12.0)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        var payload: [String: Any] = [
            "title": title,
            "sourceUrl": sourceUrl,
            "ingredients": enriched?.ingredients ?? [],
            "steps": enriched?.steps ?? [],
        ]
        if let imageUrl = imageUrl { payload["imageUrl"] = imageUrl }
        if let enriched = enriched {
            if !enriched.mealTypes.isEmpty { payload["mealTypes"] = enriched.mealTypes }
            if let d = enriched.durationMinutes { payload["durationMinutes"] = d }
            if let n = enriched.notes { payload["notes"] = n }
            if let p = enriched.provenance { payload["provenance"] = p }
        }
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
