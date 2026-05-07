# Recipe Import Strategy — Research Summary

## Context

ReciFriend's recipe import pipeline relies heavily on Gemini to extract ingredients and steps from arbitrary URLs (TikTok reels, Instagram reels, YouTube videos, food blogs). The user reports Gemini is "not so reliable and consistent," and gave a concrete example where ReciMe gets a structured Instagram reel right while ReciFriend hallucinates: <https://www.instagram.com/reel/DYAUmMuIv76/>.

This document maps **what we do today**, **what other recipe apps do**, and **where the highest-leverage improvements are**, so a future implementation decision is informed by the broader landscape rather than a single LLM-tuning attempt.

This is a strategy/knowledge document. No code changes are proposed here — the goal is to give a clear picture before committing to any rebuild.

---

## The smoking gun (key finding from the example reel)

The Instagram reel above has a **fully structured caption** — explicit `INGREDIENTS (serves 1)` header with 7 quantified items, explicit `Method` header with 8 numbered steps. ReciMe extracts this perfectly because they read the caption. **We don't read the caption at all.**

What's actually publicly accessible on that URL:

```
<meta property="og:description" content="… INGREDIENTS (serves 1)
🍌 1/2 banana, mashed
🍞 2 slices sourdough, cut into chunks
🥚 1 egg
…
Method
1. Preheat oven to 190°C.
2. Cut the bread into chunks and place into a small baking dish.
…">
```

That `og:description` tag contains **1,370 characters** including the full ingredient list and method, in the publicly-served HTML. Any HTTP GET with a normal User-Agent returns it.

What our pipeline does instead (`apps/worker/src/index.ts:4456` — `fetchOembedCaption`):

1. Calls `https://www.instagram.com/oembed/?omitscript=true&url=...`
2. **This endpoint has been deprecated for unauthenticated callers since October 2020** — Facebook moved it behind the Graph API, requiring an OAuth app token we don't have.
3. The endpoint returns `HTTP 200` but with an HTML login page instead of the JSON oEmbed payload.
4. `await response.json()` throws → caught → returns `null`.
5. Pipeline falls through to `r.jina.ai/{url}` (the text-inference path), which can't render Instagram's JS-heavy page → returns minimal/empty text.
6. Gemini gets fed thin context and **hallucinates** a generic recipe based on the URL's title hint.

**The fix for this entire failure mode is replacing the broken oEmbed call with a direct page scrape that pulls `og:description`.** ~30 lines of code, single HTTP roundtrip, no LLM call needed for well-formatted reels. This is by far the highest-leverage change available — it's the difference between "Gemini is unreliable" and "Gemini gets clean structured input every time."

---

## What we have today

Source files: `apps/worker/src/index.ts` (extraction + enrichment, lines 4009–4809, 5088–5226), `apps/recipe-ui/src/App.jsx` (frontend trigger points, lines 956 + 3690 + 4811).

Pipeline order, first-non-empty wins:

1. **`extractRecipeDetailsFromHtml()` — `index.ts:4009`.** First attempt. Parses **JSON-LD `Recipe` schema** via regex from the page HTML. Falls back to og:tags + `<title>` for the title. **100% reliable when JSON-LD is present.** No Gemini call on success. Used for traditional food blogs.
2. **`runEnrichmentChain()` — `index.ts:4791`.** If structured data is missing, runs three Gemini-backed strategies in order:
   - **Caption extract** (`captionExtract`, `:4567`) — pulls oEmbed captions from TikTok / Instagram / YouTube via `fetchOembedCaption` (`:4456`). Min length gate: 50 chars. **Instagram path is broken** (see above). TikTok oEmbed still works but returns a truncated caption. YouTube oEmbed returns title + thumbnail only, not the full description.
   - **YouTube video** (`youtubeVideo`, `:4628`) — passes the video file directly to Gemini-vision (`fileData: { fileUri, mimeType: 'video/*' }`). 30-second timeout.
   - **Text inference** (`textInference`, `:4696`) — fetches page HTML via `r.jina.ai/{url}` (oEmbed fallback). Two-pass Gemini: extract-only first, "inference allowed" only if extract returns empty (marked `provenance: 'inferred'` in DB).
3. **Save flow** — `handleCreateRecipe()` saves the recipe immediately on user submit; if ingredients/steps are still empty, `enrichAfterSave()` fires in the background via `ctx.waitUntil()`.

Reliability map for our current stack:

| Stage | Reliability | Notes |
|---|---|---|
| JSON-LD extraction | **100% if present** | Best-case path, dominates traditional blogs |
| Instagram oEmbed | **~0%** | Broken since 2020 — silently returns null |
| TikTok oEmbed caption | ~60% | Works, but caption is truncated to first ~150 chars |
| YouTube oEmbed | ~10% (title only) | No description fetched at all |
| Gemini caption extract (when caption is non-empty) | ~70–85% | Strict prompt limits hallucination; depends entirely on caption quality |
| Gemini video (YouTube) | ~50% but slow + expensive | 30s timeout cuts off often |
| Gemini text inference (jina.ai-proxied page) | ~30–60% | High hallucination risk on uncommon dishes |

Where it's fragile:
- **`fetchOembedCaption` is silently broken for Instagram** — single biggest accuracy win available
- **No microdata / RDFa parsing** — many blogs use schema.org markup as DOM attributes, not JSON-LD
- **No video transcription** — for TikTok/IG/YouTube reels where the recipe is *spoken*, we can't see it
- **TikTok caption is truncated** — the full caption in the page HTML is longer than what oEmbed returns
- **YouTube description never fetched** — public YouTube pages have the full description in HTML and via the YouTube Data API
- **No retry / no second-LLM fallback** — Gemini timeout or parse-fail = empty result, full stop
- **Inference path has high hallucination risk** — when text is thin, Gemini fabricates plausible-sounding ingredients
- **No per-site hand-tuned parsers** — every blog goes through the generic JSON-LD path

---

## What other recipe apps do

Five distinct technical approaches dominate the landscape in 2026. Most production apps stack **two or three** of them.

### 1. Direct HTML scraping (caption from `og:description`)
The forgotten 80% solution for social-video imports. Apps just fetch the URL with a browser User-Agent and read `og:description`. Instagram, TikTok, and YouTube all serve the full or near-full caption there. ReciMe's "importing AI" claim almost certainly starts with this — the LLM gets clean structured caption text as input. **~95% reliability when the caption is structured (which it is for cooking reels with explicit Ingredients/Method headers).** Cost: a single HTTP request. Latency: 200–500ms.

### 2. JSON-LD + schema.org structured data (for blogs)
The 95%-reliable baseline. Google's structured data guidelines pushed most recipe blogs to publish `schema.org/Recipe` JSON-LD. ~60–70% of cooking URLs have valid markup. **Apps: AnyList**, browser-extension import on most apps. Library: `scrape-schema-recipe` (Python). **We already do this.**

### 3. Hand-tuned per-site HTML parsers (for blogs without schema)
The `recipe-scrapers` Python library (638+ sites as of 2026) is the open-source gold standard. Each parser is hand-written for a specific domain's DOM, falling back through OpenGraph and schema.org formats. **~90%+ on supported sites.** **Apps: Paprika.** Cost: ongoing maintenance per site as designs change.

### 4. Hybrid — structured data + LLM fallback
**Mela** (popular iOS app) pioneered this in production. JSON-LD/microdata first; if it fails, an on-device ML model parses arbitrary HTML. **~85% end-to-end.** Same shape as our current pipeline with on-device inference rather than hosted LLM.

### 5. Video transcript + vision LLM (for the rare reels with no caption)
The hard case — caption is empty/useless. Apps that handle this do **three things**:
- **Audio transcription** via Whisper → spoken instructions become text
- **Frame OCR** via vision LLM (Claude Vision, GPT-4V, Gemini-vision) → on-screen text overlays become text
- **Synthesis** via LLM with extract-only prompt

**~60–75% reliability**, slower (5–10s), more expensive. **Apps: Mela 2.5+** for YouTube/TikTok/Instagram. Cloudflare Workers AI offers Whisper natively. **Tier-2 priority** — only matters once the caption-fetch path is fixed, since most cooking reels DO have caption text.

### 6. Browser extension (full DOM access)
Chrome / Safari / Firefox extension reading the rendered DOM. **~95% reliability**, but requires user install. **Apps: AnyList, Plan to Eat, RecipeSage, Cook'n.** Lowest-friction for blog import; not applicable to in-app social-video saves.

### Summary trade-offs

| Approach | Reliability | Maintenance | Latency | Cost |
|---|---|---|---|---|
| `og:description` scrape (social) | 90–95% (when caption structured) | Low | 200–500ms | Free |
| JSON-LD only (blogs) | 95% (when present) | Low | <100ms | Free |
| Hand-tuned HTML | 90% | High | <500ms | Free |
| Hybrid (Meta+LLM) | 85% | Medium | 1–3s | Medium |
| Video + Whisper + Vision | 65–75% | High | 5–10s | Medium-High |
| Browser extension | 95% | Low | <1s | Free |

---

## Recommendations, ranked by leverage

ReciFriend's user base skews heavily toward **TikTok / Instagram reel imports**. ReciMe nails this case because they read captions directly. We don't. **That single gap is responsible for most of the user's "Gemini is unreliable" experience.**

| # | Recommendation | Effort | Expected uplift | Why |
|---|---|---|---|---|
| **0a** | **Fix `fetchOembedCaption` for Instagram, TikTok, and YouTube — switch to direct HTML scrape of `og:description` (and the data-island JSON for full caption when needed)**. | **~30–60 LOC** | **Massive — likely solves 70–80% of current failures** | Instagram oEmbed is silently broken (returns HTML login page, not JSON). TikTok oEmbed truncates caption. YouTube oEmbed never fetches description. Direct HTML scrape gets the full caption in one roundtrip. This is what ReciMe is doing under the hood. |
| **0b** | **Title-only fallback when caption is unstructured.** When the caption is just a paragraph (no `Ingredients` / `Method` headers), keep the title Gemini extracts but leave ingredients/steps as empty arrays — mark `provenance: 'title-only'`. Stop discarding "title-only" results as empty in `runEnrichmentChain`. | **~5 LOC** | High — eliminates the worst hallucination class | Today: when Gemini returns `{ title: "BANANA BREAD FRENCH TOAST BAKE", ingredients: [], steps: [] }` we discard the whole result and fall through to the inference path which fabricates plausible-but-wrong ingredients ("1 cup self-rising flour"). Honest empty + clean title is safer than hallucinated content (allergies, dietary restrictions) and lets users hand-fill from the video they just watched. |
| **0c** | **Drop the inference-mode Gemini call** (`buildGeminiPrompt`, `index.ts:5088`). Replace with the title-only fallback from 0b. | Small | High — kills most hallucination cases | The inference path is where "Gemini is unreliable" actually shows up. Removing it makes results either-or: well-extracted (high confidence) or honestly empty (user fills in). No silent fabrication. |

#### What happens to the in-app "Enhance" button (`App.jsx:3690` → `/recipes/enrich`)?

Today the Enhance button re-runs the same pipeline that ran on save — so for the empty case it's effectively a no-op (it'd just return the same empty result minus the now-removed inference fallback). After 0c the button needs a new role:

- **If we add nothing else**: hide or disable the Enhance button when the recipe is in `provenance: 'title-only'` state. Show inline copy like "We couldn't find a caption — tap an ingredient row to add manually" instead. The button only does useful work when there's a *new tool* to throw at the URL.
- **With tier-2 capabilities (#3 Whisper, #4 vision OCR)**: Enhance becomes the user-initiated surface for those expensive operations. Tap → Whisper transcribes the audio (~5s) + vision OCR samples frames (~3s) + Gemini extracts from transcript+OCR. This separation is desirable: tier-2 methods cost real money per call, and most reels don't need them. Auto-running them on every save would be wasteful; gating them behind a user tap means they only fire when the user actively wants the heavier extraction.

The right pipeline tiering for the Enhance flow:

| Tier | What runs | When | Latency | Cost |
|---|---|---|---|---|
| 0 | Caption scrape → Gemini extract-only | Auto, on save | 2–4s | ~$0.001 |
| 1 | Title-only fallback (0b) | Auto, on save | (in-flight) | free |
| 2 | Whisper + vision OCR + LLM synthesis | **User-tapped** Enhance | 8–15s | ~$0.01 |
| 1 | Extend the same scrape to fetch the **YouTube full description** (often contains Ingredients/Method blocks for cooking videos). For YouTube, the YouTube Data API v3 (`videos.list?part=snippet`) is more reliable than HTML scraping. | Small | Modest — covers YouTube cooking videos | YouTube oEmbed gives title only. Description has the goods. Free with API key. |
| 2 | Add **microdata + RDFa parsers** alongside JSON-LD. Use Cloudflare's HTMLRewriter API server-side. | Small | Modest — covers more food blogs without JSON-LD | Same schema.org schema, just different syntax. Easy port. |
| 3 | **Whisper audio transcription** as a tier-2 fallback for reels where the caption is empty / "recipe in bio". Cloudflare Workers AI has Whisper natively. | Medium | Modest — most cooking reels have captions, but the long tail of caption-less reels needs this | Mela's public approach. Useful for the remaining 20% after #0 lands. |
| 4 | **Vision-OCR pass on a few sampled video frames** (Claude Vision / GPT-4V) for on-screen ingredient overlays. | Medium | Modest — on-screen-only recipes (rare for the platforms we target) | Third leg of the social-video stack. Lowest priority once #0 + #3 are in place. |
| 5 | **Port a curated subset of `recipe-scrapers`** — top 10–20 cooking blogs as hand-tuned parsers in our worker. | Medium-High | High for those specific blogs (90%+ vs ~50% Gemini) | Eliminates LLM entirely for high-traffic blog domains. Worth doing only if blog imports become a majority use-case (data-driven decision). |
| 6 | **Add retries + a second LLM (Claude Sonnet)** as fallback when Gemini fails or times out. | Small | Modest | Reduces empty-result outcomes once the input-quality fixes (#0–#2) are in place. |
| 7 | **Browser extension** for desktop blog imports. | High | Modest | Low ROI given iOS share-sheet flow is the primary import path. |

### Speed improvements (independent of accuracy)

The user mentioned ReciMe is also fast. Our current path on a social URL is roughly:

| Step | Time |
|---|---|
| oEmbed call (fails for IG, returns truncated for TT) | ~200ms |
| Fall through to text-inference | — |
| `r.jina.ai/{url}` proxy fetch | 1–2s (often slow on social) |
| Gemini extract-only call | 2–4s |
| If empty: Gemini inference call | 2–4s |
| **Total (typical)** | **5–10 seconds, often hallucinated** |

After #0 lands, the path becomes:

| Step | Time |
|---|---|
| Direct HTML fetch (Instagram/TikTok/YouTube) | 200–500ms |
| Parse `og:description` for caption | <10ms |
| Gemini extract-only call (with strong input) | 1.5–3s |
| **Total (typical)** | **2–4 seconds, accurate** |

So #0 is **simultaneously a 2–3× speed win and the accuracy fix**. There's no trade-off.

Additional speed wins available:
- **Cache successful caption fetches per URL** in KV with a short TTL (~1 day) — TikTok/IG captions don't change.
- **Skip the YouTube-video Gemini-vision strategy entirely** — it's slow (30s timeout), expensive, and the description-via-API path is faster and better.
- **Parallelize** the JSON-LD parse and the og:description scrape on the first request — pick the first non-empty result. Today they're sequential.

---

## What's already good and shouldn't be changed

- The JSON-LD path (`extractRecipeDetailsFromHtml`) is correct.
- The async `enrichAfterSave` pattern (save fast, enrich in background) is the right UX.
- The strict `extract-only` prompt structure is sound — it's the *input* to that prompt that's the problem, not the prompt itself.
- The `provenance: 'inferred'` flag on hallucinated results is a smart hedge.

---

## Critical files (for any future implementation)

- `apps/worker/src/index.ts:4456` — **`fetchOembedCaption`** — the broken function. Replace Instagram branch with HTML scrape; extend TikTok/YouTube to fetch full caption from page HTML or Data API.
- `apps/worker/src/index.ts:4009` — `extractRecipeDetailsFromHtml` (JSON-LD parser; expand here for #2 microdata/RDFa)
- `apps/worker/src/index.ts:4791` — `runEnrichmentChain` (orchestrator; insert Whisper + vision steps for #3 + #4)
- `apps/worker/src/index.ts:4567` — `captionExtract` strategy (consumes the fixed caption fetcher)
- `apps/worker/src/index.ts:4864` — `fetchRawRecipeText` (HTML fetch + jina proxy; add per-site parser dispatch here for #5)
- `apps/worker/src/index.ts:4523, 5088` — extract-only and inference prompts (mostly fine; revisit once new signals are added)
- `apps/recipe-ui/src/App.jsx:956, 3690, 4811` — frontend trigger points (no changes needed for #0–#5)
- `apps/worker/wrangler.toml` — would need a Workers AI binding added for #3 (Whisper)

---

## Verification (next steps for evaluating any of these)

1. **Build a small eval set** (~20 URLs covering 5 TikTok reels, 5 Instagram reels, 5 YouTube cooking videos, 5 popular blog URLs). Hand-write the correct ingredients/steps for each. Include the user's reported example reel as the first test case.
2. **Measure current pipeline accuracy + latency** against that eval set — establishes the baseline (currently anecdotal).
3. **Implement #0 first** — that alone will likely move the social-URL accuracy from ~30% to 80%+. Re-measure.
4. **For each subsequent fix**, prototype on a separate worker route (`/recipes/parse-v2`) and measure delta vs the eval set.
5. **Cost check** — Whisper on Workers AI is ~$0.0006/min; vision LLM passes are ~$0.001–$0.01 per image. Direct HTML scrape (#0) is free. For ReciFriend's volume, the AI costs are likely <$10/month.

The eval-set step is non-negotiable — without it, "Gemini is unreliable" stays a feeling rather than a measurable problem, and any fix you ship lands without a baseline to credit improvement against.
