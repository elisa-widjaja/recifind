import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

// App version/build for display + feedback. The version/build only exist in the
// native iOS bundle (read via @capacitor/app); in a browser/PWA there is no
// native build number, so we report `{ native: false }` and callers label it "Web".
export async function getAppInfo() {
  try {
    if (Capacitor.isNativePlatform()) {
      const { version, build } = await CapacitorApp.getInfo();
      return { native: true, version, build };
    }
  } catch {
    // @capacitor/app unavailable (web) — fall through to the web label.
  }
  return { native: false };
}

// About page: "Version 1.0.7 (27)" in the iOS app, "Web" otherwise.
export function aboutVersionLabel(info) {
  return info.native ? `Version ${info.version} (${info.build})` : 'Web';
}

// Feedback tag: "iOS 1.0.7 (27)" in the iOS app, "Web" otherwise.
export function feedbackVersionLabel(info) {
  return info.native ? `iOS ${info.version} (${info.build})` : 'Web';
}
