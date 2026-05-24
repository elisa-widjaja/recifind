import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    allowedHosts: true,
    // Cloudflare's tunnel (dev.recifriend.com) was caching JS responses for
    // 4h, so the iOS WebView kept importing stale supabaseClient.js after a
    // module-level edit. Force every dev response to be uncacheable so HMR
    // is the only state we trust.
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  },
  build: {
    // No production source maps: nothing consumes them (no Sentry / map upload),
    // and `true` emitted a ~3.8 MB index.js.map that `cap copy` bundled into the
    // iOS app for no runtime benefit. `false` (not 'hidden', which still writes
    // the .map to dist) strips it. Dev source maps are unaffected — the Vite dev
    // server generates its own regardless of this build-only setting.
    sourcemap: false,
  },
});
