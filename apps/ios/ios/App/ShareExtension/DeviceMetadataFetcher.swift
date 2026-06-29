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
//   • A per-platform User-Agent is sent: Facebook serves desktop Safari UAs an
//     empty/login-walled page (no og tags), so FB uses an iPhone Safari UA;
//     IG/TikTok/YouTube keep the macOS Safari UA that already works for them.
//     (The session is ephemeral — no app/Safari cookies are shared into it.)
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
        // fb.watch short links resolve to facebook.com/reel/... — URLSession
        // follows the redirect by default, so we fetch the source URL directly.
        let isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")
        guard isInstagram || isTikTok || isYouTube || isFacebook else { return nil }

        var req = URLRequest(url: sourceUrl, timeoutInterval: 3.5)
        // Per-platform User-Agent. Facebook serves DESKTOP Safari UAs an
        // empty/login-walled page (no og tags); an iPhone Safari UA returns the
        // real og:title/og:description/og:image. IG/TikTok/YouTube keep the macOS
        // Safari UA that already works for them — bot-shaped UAs trip Instagram's
        // stripped login wall.
        let userAgent = isFacebook
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
            : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
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

            return Self.parseSocialPreview(html: html, sourceUrl: sourceUrl)
        } catch {
            return nil
        }
    }

    /// Pure HTML → ParsePreview parsing, split out from the network fetch above
    /// so it can be unit-tested. Returns nil when no usable title can be derived
    /// (the caller then falls back to the worker result or hostname).
    static func parseSocialPreview(html: String, sourceUrl: URL) -> ParsePreview? {
        let host = sourceUrl.host?.lowercased() ?? ""
        let isInstagram = host.contains("instagram.com")
        let isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")

        let ogDesc = matchMetaContent(html: html, attr: "property", value: "og:description")
                  ?? matchMetaContent(html: html, attr: "name", value: "twitter:description")
        // Decode HTML entities in the image URL too. Facebook's signed CDN URLs
        // come back with &amp;-encoded query params; the signature (oh=/oe=) is
        // rejected and the CDN 403s the thumbnail unless the ampersands are real.
        // (Harmless for IG/TikTok/YouTube URLs.)
        let ogImage = (matchMetaContent(html: html, attr: "property", value: "og:image")
                  ?? matchMetaContent(html: html, attr: "name", value: "twitter:image"))
                  .map(decodeHtmlEntities)

        let rawCaption = ogDesc?.trimmingCharacters(in: .whitespacesAndNewlines)
        if rawCaption == nil || rawCaption!.isEmpty {
            // No og:description. Facebook photo posts (facebook.com/photo.php)
            // expose og:title + og:image but no og:description — fall back to
            // og:title so the recipe gets a real name + thumbnail instead of the
            // "Facebook Reel"/"Redirecting…" placeholder. Other platforms keep the
            // original behavior (nil → caller falls back to the worker/host).
            if isFacebook,
               let rawTitle = (matchMetaContent(html: html, attr: "property", value: "og:title")
                            ?? matchMetaContent(html: html, attr: "name", value: "twitter:title"))?
                            .trimmingCharacters(in: .whitespacesAndNewlines),
               !rawTitle.isEmpty {
                let title = decodeHtmlEntities(rawTitle)
                if !looksLikeFacebookGeneric(title) {
                    return ParsePreview(title: title, imageUrl: ogImage, caption: nil)
                }
            }
            return nil
        }

        var caption = decodeHtmlEntities(rawCaption!)

        // For Facebook, the FULL caption (the imported recipe text) is recovered
        // from the page HTML below; nil for other platforms.
        var fullCaption: String? = nil

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

        // Facebook og:description sometimes leads with engagement stats, e.g.
        // "562K views · 5K reactions · <caption>". Strip a leading run of
        // "<number><K/M/B?> <views|reactions|likes|comments|shares>" segments
        // (separated by ·, •, |, commas, or whitespace).
        // NOTE: kept in sync with stripFacebookEngagementPrefix in the worker
        // (apps/worker/src/index.ts).
        if isFacebook {
            caption = caption.replacingOccurrences(
                of: #"^(?:[\d.,]+\s*[KMB]?\s+(?:views?|reactions?|likes?|comments?|shares?)\s*[·•|,]?\s*)+"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            ).trimmingCharacters(in: .whitespacesAndNewlines)

            // Defensive: FB's response is inconsistent. When it serves engagement
            // stats or the generic logged-out Watch-hub blurb instead of a real
            // caption, bail so the caller falls back to the clean "Facebook Reel"
            // placeholder rather than titling a recipe with FB boilerplate.
            if caption.isEmpty
                || Self.looksLikeEngagementNoise(caption)
                || Self.looksLikeFacebookGeneric(caption) {
                return nil
            }

            // Recover the FULL caption from the page HTML (og:description is
            // truncated). Anchored on the cleaned caption so it locates the post's
            // message text in FB's inline JSON. This long text is what gets passed
            // to the worker for Gemini ingredient/step extraction.
            fullCaption = Self.extractFullCaption(html: html, ogDescription: caption)

            // Reels/videos expose the ENTIRE recipe in og:title (FB caps
            // og:description at ~197 chars), so the body-anchored extraction above
            // misses the back half of the caption. Treat the cleaned og:title as an
            // extra candidate and keep whichever caption is longest. A group/photo
            // post's og:title cleans down to just the page name (short), so it loses
            // this comparison and the truncated-but-walled path is preserved.
            if let rawTitle = matchMetaContent(html: html, attr: "property", value: "og:title")
                            ?? matchMetaContent(html: html, attr: "name", value: "twitter:title") {
                let titleCaption = Self.cleanFacebookOgTitle(decodeHtmlEntities(rawTitle))
                if !titleCaption.isEmpty,
                   !Self.looksLikeFacebookGeneric(titleCaption),
                   titleCaption.count > (fullCaption?.count ?? 0) {
                    fullCaption = titleCaption
                }
            }
        }

        let title = extractDishName(from: caption)
        guard !title.isEmpty else { return nil }
        return ParsePreview(title: title, imageUrl: ogImage, caption: fullCaption)
    }

    // MARK: - Helpers

    /// True when the (already prefix-stripped) caption still reads as Facebook
    /// engagement noise — a "<number> views/reactions/likes/comments/shares"
    /// token survived, meaning we never recovered a real dish name. Used to
    /// bail to the "Facebook Reel" placeholder instead of titling a recipe with
    /// stats. Kept conservative: a real caption only trips this if it literally
    /// contains "<number> <one of those words>", which dish captions don't.
    static func looksLikeEngagementNoise(_ s: String) -> Bool {
        return s.range(
            of: #"[\d.,]+\s*[KMB]?\s*(?:views?|reactions?|likes?|comments?|shares?)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    /// True when a Facebook title/description is generic FB chrome rather than a
    /// real recipe — the logged-out Watch hub, a login/redirect interstitial, or
    /// the bare site name. We bail on these so the caller shows the clean
    /// "Facebook Reel" placeholder instead of saving "Redirecting…" / "Discover
    /// Popular Videos" as the recipe title.
    static func looksLikeFacebookGeneric(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty { return true }
        if t == "facebook" || t == "facebook reel" { return true }
        let needles = [
            "discover popular videos",
            "video is the place to enjoy",
            "redirecting",
            "log in to facebook",
            "log into facebook",
            "you must log in",
        ]
        return needles.contains(where: { t.contains($0) })
    }

    /// Cleans a Facebook `og:title` down to just the post caption. FB reels/videos
    /// put the ENTIRE recipe in `og:title` (while `og:description` is capped at
    /// ~197 chars), wrapped as:
    ///   "[<N> views · <M> reactions | ]<caption incl hashtags> | <Page> | Facebook"
    /// Strips the leading engagement prefix (same pattern used on og:description)
    /// and the trailing " | <Page> | Facebook" chrome. Returns the bare caption
    /// (may be "" if the title was pure chrome). The caller passes an
    /// already-entity-decoded title.
    static func cleanFacebookOgTitle(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // Leading engagement prefix -- kept in sync with the og:description strip.
        t = t.replacingOccurrences(
            of: #"^(?:[\d.,]+\s*[KMB]?\s+(?:views?|reactions?|likes?|comments?|shares?)\s*[·•|,]?\s*)+"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        // Trailing FB chrome: " | <Page> | Facebook", then a bare " | Facebook".
        t = t.replacingOccurrences(
            of: #"\s*\|\s*[^|]+\s*\|\s*Facebook\s*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        t = t.replacingOccurrences(
            of: #"\s*\|\s*Facebook\s*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Recovers the full caption from FB's page HTML. `og:description` is a
    /// TRUNCATED prefix of the full caption, so we anchor on its leading words
    /// and read out to the enclosing JSON string boundary. The same anchor text
    /// appears in BOTH the truncated `og:description` meta tag (in <head>) and
    /// the full caption in the body's inline JSON, so we scan EVERY occurrence
    /// and keep the longest extraction — the meta yields the short truncated
    /// string, the body JSON yields the full caption. Falls back to
    /// `ogDescription` if nothing longer is found. No FB-specific JSON keys.
    ///
    /// `ogDescription` arrives HTML-entity-DECODED (the caller decodes it before
    /// calling), but FB serves the page with emoji and other non-ASCII as HTML
    /// entities (`&#x2728;`) in BOTH the meta tag and the inline JSON. So we
    /// decode the whole HTML up front before anchoring — otherwise a caption that
    /// leads with an entity-encoded char (e.g. a `✨` reel) builds an anchor whose
    /// literal emoji never byte-matches the entity-encoded body, and the full
    /// caption (ingredients + steps) is silently lost.
    static func extractFullCaption(html rawHtml: String, ogDescription: String) -> String {
        let trimmedOg = ogDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedOg.count >= 12 else { return trimmedOg }

        // Normalize the page to the same (decoded) form as the anchor. JSON
        // escapes (\n, \", \uXXXX) and structural quotes are untouched by
        // decodeHtmlEntities, so the boundary walk and unescapeJsonString below
        // still operate correctly.
        let html = decodeHtmlEntities(rawHtml)

        // Drop FB's trailing truncation ("…" or "...") so the anchor is clean
        // text that also appears verbatim in the full (untruncated) caption.
        let anchorSource = trimmedOg.replacingOccurrences(
            of: #"\s*(?:\.\.\.|…)\s*$"#, with: "", options: .regularExpression
        )
        let cap = min(40, anchorSource.count)
        var anchor = String(anchorSource.prefix(cap))
        // Back off to a word boundary so a partial truncated word can't break
        // the match against the full caption.
        if cap < anchorSource.count, let lastSpace = anchor.range(of: " ", options: .backwards) {
            anchor = String(anchor[..<lastSpace.lowerBound])
        }
        guard anchor.count >= 8 else { return trimmedOg }

        var best = trimmedOg
        var searchStart = html.startIndex
        while let anchorRange = html.range(of: anchor, options: [], range: searchStart..<html.endIndex) {
            // Walk forward to the next unescaped double-quote (JSON string end).
            var idx = anchorRange.upperBound
            var end = idx
            while idx < html.endIndex {
                let c = html[idx]
                if c == "\"" && (idx == html.startIndex || html[html.index(before: idx)] != "\\") {
                    end = idx
                    break
                }
                idx = html.index(after: idx)
                end = idx
            }
            // html is already entity-decoded; only JSON unescaping remains.
            let candidate = unescapeJsonString(String(html[anchorRange.lowerBound..<end]))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if candidate.count > best.count { best = candidate }
            searchStart = anchorRange.upperBound
        }
        return best
    }

    /// Unescapes a JSON string body: \n \t \r \" \/ \\ and \uXXXX.
    private static func unescapeJsonString(_ s: String) -> String {
        var out = ""
        var i = s.startIndex
        while i < s.endIndex {
            let c = s[i]
            if c == "\\", let next = s.index(i, offsetBy: 1, limitedBy: s.endIndex), next < s.endIndex {
                let e = s[next]
                switch e {
                case "n": out += "\n"; i = s.index(after: next)
                case "t": out += "\t"; i = s.index(after: next)
                case "r": i = s.index(after: next)
                case "\"": out += "\""; i = s.index(after: next)
                case "/": out += "/"; i = s.index(after: next)
                case "\\": out += "\\"; i = s.index(after: next)
                case "u":
                    let hexStart = s.index(after: next)
                    if let hexEnd = s.index(hexStart, offsetBy: 4, limitedBy: s.endIndex),
                       let code = UInt32(s[hexStart..<hexEnd], radix: 16),
                       let scalar = Unicode.Scalar(code) {
                        out.append(Character(scalar)); i = hexEnd
                    } else { out.append(c); i = s.index(after: i) }
                default: out.append(e); i = s.index(after: next)
                }
            } else {
                out.append(c); i = s.index(after: i)
            }
        }
        return out
    }

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
