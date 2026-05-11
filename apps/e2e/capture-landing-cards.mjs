import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = '/Users/elisa/Desktop/VibeCode/image assets/AppStore Submission';
const LANDING_URL = process.env.LANDING_URL || 'https://recifriend.com';

// Card dimensions per PublicLanding.jsx WHY_CARD_SX: width is calc(85vw)
// capped at 308px, height 384px. The viewport width must be ≥ 308/0.85 ≈ 363
// so 85vw saturates the cap and the card lays out at the same natural size
// it does on a phone hitting recifriend.com — otherwise internal absolutely-
// positioned children (e.g. the phone shell) overlap text re-flowed at a
// smaller width.
const CARD_W = 308;
const CARD_H = 384;
const PAD = 12;
const VIEWPORT = { width: 363, height: CARD_H + PAD * 2 };
const CARD_LEFT = Math.round((VIEWPORT.width - CARD_W) / 2);

const CARDS = [
  { idx: 0, label: 'save',     filename: 'card 1 - save' },
  { idx: 1, label: 'cook',     filename: 'card 2 - cook' },
  { idx: 2, label: 'discover', filename: 'card 3 - discover' },
];

// Each card's animation should play through ≥ 1 cycle. The Cook ticker holds
// ~3s per frame with 3 frames; Save sheet slides up in <1s but the card has
// a 2-state storyboard that cycles every few seconds. 9s is enough to show
// motion in all three.
const RECORD_MS = 9000;

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const card of CARDS) {
    const browser = await chromium.launch();
    const tmpVideoDir = `/tmp/recifriend-card-${card.label}-${Date.now()}`;
    mkdirSync(tmpVideoDir, { recursive: true });

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      recordVideo: { dir: tmpVideoDir, size: VIEWPORT },
    });

    // Inject a max-z-index white overlay BEFORE any page paint. Otherwise the
    // first ~2-3 seconds of the recorded video would show the landing's header,
    // hero, etc. before our pin-the-card step runs.
    await context.addInitScript(() => {
      const setupOverlay = () => {
        if (!document.body) return setTimeout(setupOverlay, 5);
        if (document.getElementById('__capture_overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = '__capture_overlay';
        overlay.style.cssText = [
          'position: fixed !important',
          'top: 0 !important', 'left: 0 !important',
          'right: 0 !important', 'bottom: 0 !important',
          'background: white !important',
          'z-index: 2147483646 !important',
          'pointer-events: none !important',
        ].join(';');
        document.body.appendChild(overlay);
      };
      setupOverlay();
    });

    const page = await context.newPage();

    console.log(`[capture] ${card.label}: loading ${LANDING_URL}…`);
    await page.goto(LANDING_URL, { waitUntil: 'networkidle' });

    // Wait for the section to mount.
    await page.getByText('Save, cook, share', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });

    // Isolate the target card in the viewport: fix it to (PAD, PAD), hide
    // everything else with a white overlay so only the card and its animations
    // are visible to the recorder.
    await page.evaluate(({ idx, pad, cardLeft }) => {
      const allNodes = Array.from(document.querySelectorAll('*'));
      const heading = allNodes.find(
        el => el.children.length === 0 && el.textContent?.trim() === 'Save, cook, share'
      );
      if (!heading) throw new Error('heading not found');

      // Find the carousel scroller by walking up from the heading.
      let section = heading.parentElement;
      let scroller = null;
      while (section && !scroller) {
        scroller = Array.from(section.querySelectorAll('*')).find(el => {
          const cs = getComputedStyle(el);
          return cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        });
        if (!scroller) section = section.parentElement;
      }
      if (!scroller) throw new Error('scroller not found');

      const target = scroller.querySelectorAll(':scope > *')[idx];
      if (!target) throw new Error(`card index ${idx} not found`);

      // The init-script overlay (#__capture_overlay) is already in place at
      // z-index 2147483646. Lift the target card one above that and pin it.
      // No width/height override — let WHY_CARD_SX (calc(85vw) capped at 308,
      // height 384) drive the natural size at the chosen viewport.
      target.style.position = 'fixed';
      target.style.top = `${pad}px`;
      target.style.left = `${cardLeft}px`;
      target.style.zIndex = '2147483647';
      target.style.margin = '0';
    }, { idx: card.idx, pad: PAD, cardLeft: CARD_LEFT });

    // Wait for fonts so the text doesn't wrap with fallback metrics
    // (which is what made Card 2's subhead spill over the phone screen).
    await page.evaluate(() => document.fonts.ready);

    // Let animations settle (ticker mount, image loads).
    await page.waitForTimeout(800);

    // Sanity PNG so we can verify framing without playing the WebM.
    await page.screenshot({ path: `/tmp/recifriend-${card.label}-frame.png` });

    // Record the animation cycle.
    await page.waitForTimeout(RECORD_MS);

    // Close page to flush the video file, then move it into place.
    await page.close();
    await context.close();
    await browser.close();

    // The video file lands in tmpVideoDir with a generated name; grab it.
    const { readdirSync } = await import('node:fs');
    const written = readdirSync(tmpVideoDir).find(f => f.endsWith('.webm'));
    if (!written) {
      console.error(`[capture] ${card.label}: no video file written`);
      continue;
    }
    const dest = join(OUT_DIR, `${card.filename}.webm`);
    if (existsSync(dest)) rmSync(dest);
    renameSync(join(tmpVideoDir, written), dest);
    rmSync(tmpVideoDir, { recursive: true, force: true });
    console.log(`[capture] ✓ ${card.label} → ${card.filename}.webm`);
  }
})().catch(err => {
  console.error('[capture] failed:', err);
  process.exit(1);
});
