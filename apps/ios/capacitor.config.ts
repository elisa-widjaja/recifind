import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.recifriend.app',
  appName: 'ReciFriend',
  webDir: '../recipe-ui/dist',
  server: {
    // Live reload via the named dev tunnel. Comment out + `cap sync` to revert
    // to bundled assets for a release build.
    url: 'https://dev.recifriend.com',
    cleartext: false,
  },
  ios: {
    scheme: 'recifriend',
    // Safe-area handling is done via CSS env(safe-area-inset-*) on individual
    // components (AppBar, drawers, dialogs, FABs). Setting contentInset here
    // would cause double-padding since env() still returns device insets.
  },
};

export default config;
