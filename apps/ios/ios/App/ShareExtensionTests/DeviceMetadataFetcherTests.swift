import XCTest
// DeviceMetadataFetcher.swift + WorkerClient.swift are compiled directly into
// this test target (Target Membership), so their types are in-module — no
// `@testable import ShareExtension` needed (app extensions don't import cleanly).

final class DeviceMetadataFetcherTests: XCTestCase {

    // MARK: - looksLikeEngagementNoise

    func testLooksLikeEngagementNoise_falseForCleanCaption() {
        XCTAssertFalse(DeviceMetadataFetcher.looksLikeEngagementNoise("Triple Chocolate Banana Bread"))
    }

    func testLooksLikeEngagementNoise_trueForStatsString() {
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeEngagementNoise("562K views 5K reactions"))
    }

    // MARK: - extractFullCaption (og-anchored)

    func testExtractFullCaption_recoversFullCaptionFromInlineJson() {
        // og:description is truncated; the full caption lives in inline JSON.
        let og = "Lemon Pasta. Ingredients: pasta, lemon..."
        let html = """
        <html><head><meta property="og:description" content="Lemon Pasta. Ingredients: pasta, lemon..." /></head>
        <body><script>{"message":{"text":"Lemon Pasta. Ingredients: pasta, lemon, butter, parmesan. Steps: 1) boil pasta 2) toss with lemon butter"}}</script></body></html>
        """
        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertTrue(full.contains("parmesan"))
        XCTAssertTrue(full.contains("boil pasta"))
        XCTAssertGreaterThan(full.count, og.count)
    }

    func testExtractFullCaption_fallsBackToOgWhenAnchorMissing() {
        let og = "Some Caption That Is Not In The Body"
        let html = "<html><head><meta property=\"og:description\" content=\"x\" /></head><body>nothing relevant</body></html>"
        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertEqual(full, og)
    }

    // Regression: FB reel https://www.facebook.com/reel/777779878458348
    // ("Persian Jeweled Rice"). The reel's caption leads with an emoji that the
    // page entity-encodes (&#x2728;) in BOTH the og:description meta tag and the
    // body's inline JSON — the live page has 20x &#x2728; and zero literal ✨.
    // fetchSocialPreview decodes og:description first (line 74), so the anchor
    // extractFullCaption builds starts with a literal ✨ + U+2028, which never
    // byte-matches the still-entity-encoded body. The full caption (ingredients
    // + steps) is therefore never recovered and the reel imports title-only.
    func testExtractFullCaption_recoversCaptionWhenLeadingEmojiIsEntityEncoded() {
        // og:description as the CALLER passes it: already HTML-entity-decoded
        // (real ✨ / U+2028 / 💛), truncated by FB with a trailing "...".
        let og = "\u{2728} Persian Jeweled Rice \u{2728}\u{2028}A dish as stunning as it is delicious \u{1F49B} golden rice studded with nuts, dried fruit, and citrusy fragrance. Rich in flavor, color, and aroma, and all made in one pot in under..."

        // Page HTML as actually served: emoji entity-encoded in both the meta
        // tag and the inline-JSON body. The body carries the FULL caption with
        // ingredients + instructions.
        let html = """
        <html><head><meta property="og:description" content="&#x2728; Persian Jeweled Rice &#x2728;&#x2028;A dish as stunning as it is delicious &#x1f49b; golden rice studded with nuts, dried fruit, and citrusy fragrance. Rich in flavor, color, and aroma, and all made in one pot in under..." /></head>
        <body><script>{"message":{"text":"&#x2728; Persian Jeweled Rice &#x2728;&#x2028;A dish as stunning as it is delicious &#x1f49b; golden rice studded with nuts, dried fruit, and citrusy fragrance. Rich in flavor, color, and aroma, and all made in one pot in under an hour!\\n\\n&#x1f958; Ingredients:\\n* 2 cups washed basmati rice\\n* 1/2 cup slivered almonds\\n* 1 tsp turmeric\\n\\n&#x1f469;&#x200d;&#x1f373; Instructions:\\n1. Heat oil and saut&#xe9; onions until golden.\\n2. Add rice and water, bring to a boil uncovered."}}</script></body></html>
        """

        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertTrue(full.contains("basmati rice"), "expected ingredients recovered, got: \(full)")
        XCTAssertTrue(full.contains("Instructions"), "expected steps recovered, got: \(full)")
        XCTAssertGreaterThan(full.count, og.count)
    }

    func testExtractFullCaption_unescapesJsonNewlinesAndUnicode() {
        let og = "Garlic Butter Shrimp recipe below"
        let html = """
        <html><head><meta property="og:description" content="Garlic Butter Shrimp recipe below..." /></head>
        <body><script>{"text":"Garlic Butter Shrimp recipe below\\n\\nIngredients:\\n- shrimp\\n- butter \\u2764"}</script></body></html>
        """
        let full = DeviceMetadataFetcher.extractFullCaption(html: html, ogDescription: og)
        XCTAssertTrue(full.contains("\n"))
        XCTAssertTrue(full.contains("shrimp"))
        XCTAssertFalse(full.contains("\\n"))
    }

    // MARK: - looksLikeFacebookGeneric

    func testLooksLikeFacebookGeneric_trueForFacebookChrome() {
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeFacebookGeneric("Discover Popular Videos | Facebook"))
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeFacebookGeneric("Redirecting..."))
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeFacebookGeneric("Facebook"))
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeFacebookGeneric("Video is the place to enjoy videos and shows together."))
        XCTAssertTrue(DeviceMetadataFetcher.looksLikeFacebookGeneric("   "))
    }

    func testLooksLikeFacebookGeneric_falseForRealTitle() {
        XCTAssertFalse(DeviceMetadataFetcher.looksLikeFacebookGeneric("Sticky Mongolian-Style Ground Beef"))
        XCTAssertFalse(DeviceMetadataFetcher.looksLikeFacebookGeneric("Blackened Mahi-Mahi Tacos"))
    }

    // MARK: - cleanFacebookOgTitle

    func testCleanFacebookOgTitle_stripsEngagementPrefixAndChrome() {
        // watch/?v= form: leading "N views · M reactions |" + trailing chrome.
        let raw = "439K views · 12K reactions | banana cream pie\nmakes 4 servings\nbanana pudding mix | Mia Carson | Facebook"
        let cleaned = DeviceMetadataFetcher.cleanFacebookOgTitle(raw)
        XCTAssertTrue(cleaned.hasPrefix("banana cream pie"), "got: \(cleaned)")
        XCTAssertTrue(cleaned.contains("banana pudding mix"))
        XCTAssertFalse(cleaned.contains("439K"))
        XCTAssertFalse(cleaned.contains("reactions"))
        XCTAssertFalse(cleaned.contains("Mia Carson"))
        XCTAssertFalse(cleaned.contains("Facebook"))
    }

    func testCleanFacebookOgTitle_handlesNoEngagementPrefix() {
        // /reel/ form: no engagement prefix, caption leads with an emoji.
        let raw = "💫 Sweet potato waffles\n1/2 cup cooked sweet potato #healthyrecipes | Pretty On Track | Facebook"
        let cleaned = DeviceMetadataFetcher.cleanFacebookOgTitle(raw)
        XCTAssertTrue(cleaned.hasPrefix("💫 Sweet potato waffles"), "got: \(cleaned)")
        XCTAssertTrue(cleaned.contains("1/2 cup cooked sweet potato"))
        XCTAssertFalse(cleaned.contains("Pretty On Track"))
        XCTAssertFalse(cleaned.contains("Facebook"))
    }

    func testCleanFacebookOgTitle_groupTitleReducesToPageName() {
        // Group post og:title is "Group | Dish | Facebook" — cleans to the group
        // name (short), which the caller will discard in favor of og:description.
        let raw = "Anti-inflammatory Recipes | Baked Squash with Feta | Facebook"
        let cleaned = DeviceMetadataFetcher.cleanFacebookOgTitle(raw)
        XCTAssertEqual(cleaned, "Anti-inflammatory Recipes")
    }

    // MARK: - captionFromFacebookOgUrl

    // FB video URLs embed the caption as a slug:
    //   .../videos/air-fryer-pork-ribs-1-lb-pork-ribs-.../<id>/
    // De-slugify it back to readable text (hyphens → spaces).
    func testCaptionFromFacebookOgUrl_deslugifiesVideoSlug() {
        let ogUrl = "https://www.facebook.com/61551387266783/videos/celery-salad-summer-ingredients-celery-2-cups-dates-3-using-terra-delyssa-walnut/1041889132115337/"
        let caption = DeviceMetadataFetcher.captionFromFacebookOgUrl(ogUrl)
        XCTAssertEqual(caption, "celery salad summer ingredients celery 2 cups dates 3 using terra delyssa walnut")
    }

    // Percent-encoded fractions in the slug (½ = %C2%BD) must decode.
    func testCaptionFromFacebookOgUrl_decodesPercentEncodedFraction() {
        let ogUrl = "https://www.facebook.com/1/videos/pancakes-%C2%BD-cup-flour/9/"
        XCTAssertEqual(DeviceMetadataFetcher.captionFromFacebookOgUrl(ogUrl), "pancakes ½ cup flour")
    }

    // The bare Watch-hub URL (watch/?v=<id>) has no descriptive slug → nil.
    func testCaptionFromFacebookOgUrl_returnsNilForBareWatchHub() {
        XCTAssertNil(DeviceMetadataFetcher.captionFromFacebookOgUrl("https://www.facebook.com/watch/?v=123456"))
    }

    // A short, non-caption slug (username / "photo-1") de-slugs to < 12 chars
    // and must be rejected so we don't title a recipe with page chrome.
    func testCaptionFromFacebookOgUrl_returnsNilForShortSlug() {
        XCTAssertNil(DeviceMetadataFetcher.captionFromFacebookOgUrl("https://www.facebook.com/photo-1/videos/9/"))
    }

    // MARK: - parseSocialPreview (Facebook)

    // Regression: the two failing fb.watch imports (air-fryer pork ribs / celery
    // salad). FB serves the video page NO og:title and NO og:description to a
    // device fetch — only og:image and an og:url whose slug is the caption. The
    // fetcher must recover that slug as the caption + a title, keeping the
    // thumbnail, instead of returning nil (thumbnail-only "Facebook Reel").
    func testParseSocialPreview_facebookVideoRecoversCaptionFromOgUrlSlug() {
        let html = """
        <html><head>
        <meta property="og:type" content="video.other" />
        <meta property="og:url" content="https://www.facebook.com/100086743861165/videos/air-fryer-pork-ribs-1-lb-pork-ribs-riblets15-tbsp-oyster-sauce%C2%BD-tbsp-brown-sugar/1357006853131283/" />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/ribs.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/watch/?v=1357006853131283")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertNotNil(preview)
        XCTAssertEqual(preview?.imageUrl, "https://scontent.fbcdn.net/v/ribs.jpg")
        XCTAssertTrue(preview?.caption?.lowercased().contains("pork ribs") ?? false,
                      "got: \(String(describing: preview?.caption))")
        XCTAssertFalse(preview?.caption?.contains("-") ?? true, "hyphens must be de-slugified")
        XCTAssertFalse(preview?.title.isEmpty ?? true)
    }

    // The og:url slug is a LAST resort — when og:description is present the normal
    // caption path wins, so the slug fallback must not shadow it.
    func testParseSocialPreview_facebookVideoPrefersOgDescriptionOverSlug() {
        let html = """
        <html><head>
        <meta property="og:url" content="https://www.facebook.com/1/videos/some-slug-here-that-is-long/9/" />
        <meta property="og:description" content="Miso Glazed Salmon. Ingredients: salmon, miso, mirin, honey." />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/salmon.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/watch/?v=999")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertTrue(preview?.caption?.contains("miso") ?? false, "got: \(String(describing: preview?.caption))")
        XCTAssertFalse(preview?.caption?.contains("slug") ?? true)
    }


    // FB photo posts (facebook.com/photo.php) expose og:title + og:image but NO
    // og:description. The fetcher must fall back to og:title instead of bailing
    // to nil (which surfaced as "Redirecting…"/"Facebook Reel" + no thumbnail).
    func testParseSocialPreview_facebookPhotoFallsBackToOgTitle() {
        let html = """
        <html><head>
        <meta property="og:title" content="Sticky Mongolian-Style Ground... - Healthy Stir-Fry Ideas" />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/photo.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/photo.php?fbid=123&set=a.456&type=3")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertEqual(preview?.title, "Sticky Mongolian-Style Ground... - Healthy Stir-Fry Ideas")
        XCTAssertEqual(preview?.imageUrl, "https://scontent.fbcdn.net/v/photo.jpg")
        XCTAssertNil(preview?.caption)
    }

    // fb.watch reels resolve to the logged-out Watch hub, whose og tags are
    // generic FB chrome — must bail to nil so the caller shows the placeholder.
    func testParseSocialPreview_facebookGenericHubReturnsNil() {
        let html = """
        <html><head>
        <meta property="og:title" content="Discover Popular Videos | Facebook" />
        <meta property="og:description" content="Video is the place to enjoy videos and shows together. Watch the latest reels." />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/watch/?v=123")!
        XCTAssertNil(DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url))
    }

    // og:title-only fallback is Facebook-specific — other platforms keep the
    // original behavior of returning nil when there's no caption.
    func testParseSocialPreview_nonFacebookNoDescriptionReturnsNil() {
        let html = "<html><head><meta property=\"og:title\" content=\"Some TikTok\" /></head><body></body></html>"
        let url = URL(string: "https://www.tiktok.com/@user/video/123")!
        XCTAssertNil(DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url))
    }

    // Regression: a real FB post WITH a caption still derives its title from the
    // caption and carries the full caption forward for ingredient extraction.
    func testParseSocialPreview_facebookPostWithCaptionKeepsCaptionPath() {
        let html = """
        <html><head>
        <meta property="og:description" content="Korean Steamed Eggs. So fluffy and savory!" />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/eggs.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/share/p/abc123/")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertNotNil(preview)
        XCTAssertFalse(preview!.title.isEmpty)
        XCTAssertNotNil(preview?.caption)
    }

    // Reel/video: the FULL recipe is in og:title; og:description is truncated.
    // parseSocialPreview must surface the full caption (ingredients + steps),
    // strip the engagement prefix + " | <Page> | Facebook" chrome, and keep the
    // dish-name title derived from og:description.
    func testParseSocialPreview_facebookReelRecoversFullCaptionFromOgTitle() {
        let html = """
        <html><head>
        <meta property="og:title" content="439K views &#xb7; 12K reactions | banana cream pie&#x1f34c;&#x0a;makes 4 servings&#x0a;Ingredients:&#x0a;2 cups vanilla yogurt&#x0a;3 tbsp banana pudding mix&#x0a;Instructions:&#x0a;Mix and freeze. | Mia Carson | Facebook" />
        <meta property="og:description" content="banana cream pie&#x1f34c; makes 4 servings Ingredients: 2 cups vanilla yogurt 3 tbsp..." />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/banana.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/watch/?v=1564713835013059")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertNotNil(preview)
        XCTAssertEqual(preview?.title, "banana cream pie")
        XCTAssertEqual(preview?.imageUrl, "https://scontent.fbcdn.net/v/banana.jpg")
        XCTAssertTrue(preview?.caption?.contains("banana pudding mix") ?? false, "got: \(String(describing: preview?.caption))")
        XCTAssertTrue(preview?.caption?.contains("Instructions") ?? false)
        XCTAssertFalse(preview?.caption?.contains("Mia Carson") ?? true)
        XCTAssertFalse(preview?.caption?.contains("439K") ?? true)
    }

    // Group/permalink post: og:title is just "Group | Dish | Facebook" with NO
    // recipe; the (truncated) recipe is only in og:description. The short cleaned
    // og:title must LOSE the longest-caption comparison so the walled-post path is
    // preserved (caption stays the og:description text, not the group name).
    func testParseSocialPreview_facebookGroupPostIgnoresShortOgTitle() {
        let html = """
        <html><head>
        <meta property="og:title" content="Anti-inflammatory Recipes | Baked Squash with Feta | Facebook" />
        <meta property="og:description" content="Baked Squash with Feta INGREDIENTS Squash: 1 medium squash 1 tsp olive oil salt pepper Filling: feta spinach bacon..." />
        <meta property="og:image" content="https://scontent.fbcdn.net/v/squash.jpg" />
        </head><body></body></html>
        """
        let url = URL(string: "https://www.facebook.com/groups/514659721546955/permalink/1048253324854256/")!
        let preview = DeviceMetadataFetcher.parseSocialPreview(html: html, sourceUrl: url)
        XCTAssertNotNil(preview)
        XCTAssertTrue(preview?.caption?.contains("INGREDIENTS") ?? false, "got: \(String(describing: preview?.caption))")
        XCTAssertFalse(preview?.caption?.contains("Anti-inflammatory Recipes") ?? false)
    }
}
