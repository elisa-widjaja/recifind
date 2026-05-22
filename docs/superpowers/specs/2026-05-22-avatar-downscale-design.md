# Downscale avatars to 256×256 on upload

**Date:** 2026-05-22
**Status:** Approved, ready for implementation

## Problem

Avatar uploads are size-capped (8 MB client pre-check in `App.jsx`, 5 MB hard cap
in the worker via `MAX_IMAGE_BYTES`) but are **not resized or compressed**. Whatever
the user uploads, up to 5 MB, is stored at full resolution in Supabase Storage
(`avatars/{userId}-{timestamp}.{ext}`) and served at full resolution everywhere an
avatar appears (activity feed, friend lists, suggestion cards, recipe drawers).

Because avatars re-render across many surfaces per session, a multi-MB avatar is a
disproportionately large **Supabase egress** consumer — ~90× the size of a typical
recipe thumbnail (~54 KB avg). The free tier's 5 GB/month egress is the binding
constraint, so avatars are the cheapest thing to fix.

## Goal

Shrink every uploaded avatar to a 256×256 square before it reaches storage, taking a
5 MB photo down to ~10–30 KB, protecting both storage size and egress — without
breaking the upload flow or touching shared recipe-import code.

## Approach

**Client-side resize via `<canvas>` (chosen).** The browser decodes, center-crops,
scales, and re-encodes the image before upload. The worker is left almost untouched.

Rejected alternatives:
- **Worker-side WASM resize** (`@cf-wasm/photon`): adds hundreds of KB to the worker
  bundle and burns CPU per upload — risky against the free plan's CPU budget. Overkill
  for avatars.
- **Cloudflare Images / `cf.image` resizing**: a paid zone feature, defeats the
  free-tier goal.

Trade-off accepted: resize happens client-side, so a hand-crafted request could skip
it. The worker's existing 5 MB cap remains as a backstop, so storage/egress stay
bounded in practice.

## Changes

All changes are in `apps/recipe-ui/src/App.jsx`. **The worker is unchanged** — it
already maps a `webp` mime to the correct extension (`index.ts:1379`) and enforces the
5 MB cap (`index.ts:1371`).

### New helper: `downscaleAvatar(file) -> Promise<string>`

Returns a data URL of the resized image.

1. Load the file into an `<img>` element via `URL.createObjectURL(file)`. Using `<img>`
   (rather than `createImageBitmap`) means modern browsers apply EXIF orientation
   automatically — important for phone selfies that arrive rotated.
2. Center-crop to a square: `side = min(naturalWidth, naturalHeight)`, with
   `sx = (naturalWidth - side) / 2`, `sy = (naturalHeight - side) / 2`.
3. Draw the cropped square onto a 256×256 `<canvas>` via
   `ctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256)`.
4. Export `canvas.toDataURL('image/webp', 0.85)`. If the result does not start with
   `data:image/webp` (older Safari cannot encode WebP from canvas), fall back to
   `canvas.toDataURL('image/jpeg', 0.85)`.
5. Revoke the object URL and return the data URL.

### Updated `onPickAvatar` handler (~`App.jsx:5669`)

- Keep the existing 8 MB pre-check — it now guards the fallback path and avoids
  decoding absurdly large files.
- Replace the raw `FileReader.readAsDataURL(file)` step with
  `await downscaleAvatar(file)`.
- Derive `contentType` from the produced data URL's mime so the worker picks the right
  extension.
- **Fail-safe:** if `downscaleAvatar` throws (decode failure, exotic format), fall back
  to the original raw `FileReader.readAsDataURL` upload so avatar upload never breaks —
  still bounded by the worker's 5 MB cap.

## Edge cases (acceptable)

- **Animated GIF**: flattens to its first frame at 256px static. Fine for an avatar.
- **SVG**: rendered to a 256px raster. Fine for an avatar.
- **Decode failure / unsupported format**: falls back to raw upload (5 MB cap applies).

## Testing

The resize runs in the browser and depends on `<canvas>`, which is not available in
jsdom/vitest, so this is verified manually:

1. Upload a large (multi-MB) photo as an avatar.
2. Confirm the stored Supabase object is small (~10–30 KB) — check the response
   `avatarUrl` object size or the network payload.
3. Confirm the rendered avatar is square, un-distorted, and correctly oriented
   (test with a portrait phone photo that has EXIF rotation).
4. Confirm a non-resizable input still uploads via the fallback path.

No automated test is added; the absence is intentional and noted here.

## Out of scope

- Resizing existing avatars already in storage (could be a separate one-shot backfill).
- The recipe-preview image path (separate `?size=` resize stub remains a TODO).
