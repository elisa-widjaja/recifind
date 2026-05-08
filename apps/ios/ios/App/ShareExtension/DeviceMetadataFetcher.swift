import Foundation

// On-device metadata fetcher for the Share Extension's preview pre-fill.
//
// Why this exists: the worker's /recipes/parse runs from Cloudflare's
// datacenter IPs, which Instagram aggressively rate-limits — even with the
// fixes shipped in the worker (Safari UA, og:description fallback, retry,
// KV cache), a brand-new reel often comes back as the stripped login wall.
// The user sees the iOS extension's hostname fallback ("www.instagram.com")
// in the title field on first share.
//
// This fetcher does the same fetch but on the user's device, where:
//   • Requests come from a residential IP (no datacenter rate limit)
//   • The user's Safari cookies / Instagram session apply if they're
//     signed in to either, further reducing 401-style stripped responses
//   • Total wall-clock budget stays inside the share-extension's 4s window
//
// We race this against WorkerClient.parseRecipe in ShareFormView.loadPreview
// — whichever returns a useful title first wins. The worker stays valuable
// because its KV cache makes repeat shares of the same URL instant, and its
// extraction logic handles JSON-LD blogs / TikTok oEmbed / etc. better than
// a single device fetch.

struct DeviceMetadataFetcher {
    /// Fetches og:description (and og:image) from a public Instagram /
    /// TikTok / YouTube URL and synthesizes a clean dish-name title.
    /// Returns nil for non-social hosts or any fetch / parse failure —
    /// the caller falls back to the worker result or hostname.
    static func fetchSocialPreview(sourceUrl: URL) async -> ParsePreview? {
        let host = sourceUrl.host?.lowercased() ?? ""
        let isInstagram = host.contains("instagram.com")
        let isTikTok = host.contains("tiktok.com")
        let isYouTube = host.contains("youtube.com") || host.contains("youtu.be")
        guard isInstagram || isTikTok || isYouTube else { return nil }

        var req = URLRequest(url: sourceUrl, timeoutInterval: 3.5)
        // Real Safari UA — same fix as the worker. Bot-shaped UAs trigger
        // Instagram's stripped login-wall response.
        req.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        req.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
        req.setValue("en-US,en;q=0.5", forHTTPHeaderField: "Accept-Language")

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 3.5
        config.timeoutIntervalForResource = 3.5
        let session = URLSession(configuration: config)

        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let html = String(data: data, encoding: .utf8)
            else { return nil }

            let ogDesc = matchMetaContent(html: html, attr: "property", value: "og:description")
                      ?? matchMetaContent(html: html, attr: "name", value: "twitter:description")
            let ogImage = matchMetaContent(html: html, attr: "property", value: "og:image")
                      ?? matchMetaContent(html: html, attr: "name", value: "twitter:image")

            guard var caption = ogDesc?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !caption.isEmpty else { return nil }

            caption = decodeHtmlEntities(caption)

            // Strip the Instagram-specific metadata prefix:
            //   "1,075 likes, 23 comments - alicelovesbreakfast on May 6, 2026: "<caption>""
            if isInstagram {
                if let prefixRange = caption.range(
                    of: #"^[\d,]+\s+likes?,\s+[\d,]+\s+comments?\s+-\s+[^:]+:\s*[\u{201C}\u{201D}"\u{0022}]?"#,
                    options: .regularExpression
                ) {
                    caption = String(caption[prefixRange.upperBound...])
                    caption = caption.replacingOccurrences(
                        of: #"[\u{201C}\u{201D}"\u{0022}]\s*\.?\s*$"#,
                        with: "",
                        options: .regularExpression
                    )
                    caption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }

            let title = extractDishName(from: caption)
            guard !title.isEmpty else { return nil }
            return ParsePreview(title: title, imageUrl: ogImage)
        } catch {
            return nil
        }
    }

    // MARK: - Helpers

    private static func matchMetaContent(html: String, attr: String, value: String) -> String? {
        let escapedValue = NSRegularExpression.escapedPattern(for: value)
        // Two patterns to handle either attribute order: <meta {attr}="..." content="..."> or vice-versa.
        let patterns = [
            #"<meta\s+\#(attr)=["']\#(escapedValue)["']\s+content=["']([^"']*)["']"#,
            #"<meta\s+content=["']([^"']*)["']\s+\#(attr)=["']\#(escapedValue)["']"#,
        ]
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { continue }
            let nsRange = NSRange(html.startIndex..., in: html)
            if let match = regex.firstMatch(in: html, options: [], range: nsRange),
               match.numberOfRanges > 1,
               let r = Range(match.range(at: 1), in: html) {
                return String(html[r])
            }
        }
        return nil
    }

    /// Decodes HTML entities (numeric hex/decimal + common named entities).
    /// Mirrors the worker's decodeHtmlEntities — captions arrive with
    /// `&amp;`, `&quot;`, and food-emoji numeric entities like `&#x1f34c;`.
    private static func decodeHtmlEntities(_ s: String) -> String {
        var result = s

        // Numeric hex (food emoji): &#x1f34c; → 🍌
        if let regex = try? NSRegularExpression(pattern: #"&#x([0-9a-fA-F]+);"#) {
            let nsRange = NSRange(result.startIndex..., in: result)
            // Reverse-iterate so range offsets stay valid as we mutate.
            for match in regex.matches(in: result, range: nsRange).reversed() {
                guard let codeRange = Range(match.range(at: 1), in: result),
                      let codePoint = UInt32(result[codeRange], radix: 16),
                      let scalar = Unicode.Scalar(codePoint),
                      let fullRange = Range(match.range, in: result)
                else { continue }
                result.replaceSubrange(fullRange, with: String(Character(scalar)))
            }
        }

        // Numeric decimal: &#65; → A
        if let regex = try? NSRegularExpression(pattern: #"&#(\d+);"#) {
            let nsRange = NSRange(result.startIndex..., in: result)
            for match in regex.matches(in: result, range: nsRange).reversed() {
                guard let codeRange = Range(match.range(at: 1), in: result),
                      let codePoint = UInt32(result[codeRange]),
                      let scalar = Unicode.Scalar(codePoint),
                      let fullRange = Range(match.range, in: result)
                else { continue }
                result.replaceSubrange(fullRange, with: String(Character(scalar)))
            }
        }

        // Common named entities
        let named: [(String, String)] = [
            ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
            ("&quot;", "\""), ("&apos;", "'"), ("&nbsp;", " "),
            ("&hellip;", "…"), ("&mdash;", "—"), ("&ndash;", "–"),
        ]
        for (entity, replacement) in named {
            result = result.replacingOccurrences(of: entity, with: replacement)
        }
        return result
    }

    /// Extracts a clean dish name from a caption — same heuristic as the
    /// worker's extractInstagramRecipeTitle: prefer the text before the
    /// first food emoji, else the first sentence, else a truncated head.
    private static func extractDishName(from caption: String) -> String {
        // Prefer the text before the first emoji / pictograph (cooking
        // reels typically lead with the dish name then a food emoji,
        // e.g. "BANANA BREAD FRENCH TOAST BAKE 🍌🍞").
        if let emojiRange = caption.range(of: #"\p{Extended_Pictographic}"#, options: .regularExpression) {
            let prefix = String(caption[..<emojiRange.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if prefix.count > 3 && prefix.count <= 100 {
                return prefix
            }
        }

        // First sentence/line as a secondary fallback.
        if let firstLine = caption.split(whereSeparator: { ".\n!?".contains($0) }).first.map(String.init) {
            let trimmed = firstLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count > 3 && trimmed.count <= 100 {
                return trimmed
            }
        }

        // Long-caption truncation, snapped to the last word boundary.
        if caption.count > 60 {
            let truncated = String(caption.prefix(60)).trimmingCharacters(in: .whitespacesAndNewlines)
            if let lastSpace = truncated.range(of: " ", options: .backwards) {
                return String(truncated[..<lastSpace.lowerBound])
            }
            return truncated
        }
        return caption
    }
}
