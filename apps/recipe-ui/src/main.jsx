import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Splash handoff. We fire two fades in sync once React has painted and a
// minimum on-screen budget has elapsed:
//   - body.app-ready triggers the HTML #app-splash CSS fade (web's only
//     splash; on iOS it's a defensive layer inside the WebView).
//   - SplashScreen.hide() fades the native @capacitor/splash-screen overlay
//     on iOS (configured launchAutoHide:false, so the native splash holds
//     over the WebView until this call).
// Without the min-visible floor the splash dismisses the instant React
// paints (~50ms with cached bundle), which reads as a flash rather than
// a deliberate handoff.
const SPLASH_MIN_VISIBLE_MS = 800;
const SPLASH_FADE_MS = 500;
// Hard cap: once JS is running, never let the native splash sit longer than this.
// Catches the case where rAF fires but React throws synchronously before we
// reach fadeSplash, or where the splash overlay element somehow blocks input.
const SPLASH_MAX_VISIBLE_MS = 4000;
const startedAt = performance.now();
let splashHidden = false;
const fadeSplash = () => {
  if (splashHidden) return;
  splashHidden = true;
  const wait = Math.max(0, SPLASH_MIN_VISIBLE_MS - (performance.now() - startedAt));
  setTimeout(() => {
    document.body.classList.add('app-ready');
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeOutDuration: SPLASH_FADE_MS }).catch(() => {});
    }
    setTimeout(() => {
      const splash = document.getElementById('app-splash');
      if (splash) splash.remove();
    }, SPLASH_FADE_MS + 60);
  }, wait);
};
requestAnimationFrame(() => requestAnimationFrame(fadeSplash));
setTimeout(fadeSplash, SPLASH_MAX_VISIBLE_MS);
