import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recifriend.app',
  appName: 'ReciFriend',
  webDir: '../recipe-ui/dist',
  server: {
    // iosScheme stays set in both dev AND release builds. Bundled-assets builds
    // (no `url`) get WebView origin `https://localhost` instead of the default
    // `capacitor://localhost`. The latter triggers YouTube embed Error 153 in
    // WKWebView; https origin is treated as legitimate.
    // NOTE: changing iosScheme invalidates origin-bound web storage (localStorage,
    // cookies, IndexedDB) — users will be logged out on next install.
    iosScheme: 'https',
    // For release builds: comment out the `url` and `cleartext` lines below.
    // For dev: uncomment to live-reload from the named tunnel.
    url: 'https://dev.recifriend.com',
    cleartext: false,
  },
  ios: {
    scheme: 'recifriend',
    // Safe-area handling is done via CSS env(safe-area-inset-*) on individual
    // components (AppBar, drawers, dialogs, FABs). Setting contentInset here
    // would cause double-padding since env() still returns device insets.
    // Allow inline (non-fullscreen) playback so YouTube/TikTok iframes can autoplay
    // in WKWebView. Without this, iOS tries to force fullscreen and blocks the embed.
    allowsInlineMediaPlayback: true,
    // Default is 'audio video' — blocks autoplay entirely. 'none' allows muted autoplay.
    mediaTypesRequiringUserActionForPlayback: 'none',
    // Capacitor's default WKWebView UA omits the "Safari/X" identifier that
    // mobile Safari sends. YouTube's player config parses UA to validate
    // "is this a real browser?" and bails with Error 153 when it can't find
    // a Safari token. Appending it makes WKWebView identify as Safari to YT.
    appendUserAgent: 'Safari/604.1',
  },
  plugins: {
    SplashScreen: {
      // Native splash holds over the WebView until JS calls hide() — this is
      // what fades the LaunchScreen logo away. Without launchAutoHide:false
      // the native splash dismisses the moment Capacitor finishes booting,
      // leaving a flash of empty WebView before React's first paint.
      launchAutoHide: false,
      // Safety net: auto-dismiss after 4s if JS never calls hide() (crash etc.)
      launchShowDuration: 4000,
      backgroundColor: '#ffffff',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
