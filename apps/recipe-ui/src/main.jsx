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
const startedAt = performance.now();
const fadeSplash = () => {
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
