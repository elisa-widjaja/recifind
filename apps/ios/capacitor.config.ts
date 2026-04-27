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
