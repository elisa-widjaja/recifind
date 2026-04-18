import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recifriend.app',
  appName: 'ReciFriend',
  webDir: '../recipe-ui/dist',
  ios: {
    scheme: 'recifriend',
    // contentInset 'always' makes the native WebView respect safe areas —
    // status bar / Dynamic Island no longer overlaps content, and the home
    // indicator area stays clear. The CSS env(safe-area-inset-*) values
    // inside the webview return 0 when contentInset is always, so the
    // #root env() padding in index.html only fires for web PWA users.
    contentInset: 'always',
  },
};

export default config;
