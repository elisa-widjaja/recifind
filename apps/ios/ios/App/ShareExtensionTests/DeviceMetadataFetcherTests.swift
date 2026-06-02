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
}
