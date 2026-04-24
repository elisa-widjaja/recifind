import { registerPlugin, Capacitor } from '@capacitor/core';

// Registered in apps/ios/ios/App/App/MainViewController.swift via
// bridge?.registerPluginInstance(SharedAuthStorePlugin()). Plugin class
// lives in apps/ios/ios/App/App/Plugins/SharedAuthStore/.
const SharedAuthStoreNative = registerPlugin('SharedAuthStore');

// Thin wrapper that no-ops on non-iOS platforms. Write-and-verify pattern
// catches silent plugin-registration regressions — if the native plugin
// is ever absent, the verify-read will reject and we'll get a useful
// console.error instead of a silent keychain miss on the extension side.
export const SharedAuthStore = {
  async setJwt(token) {
    if (!Capacitor.isNativePlatform() || !token) return;
    try {
      await SharedAuthStoreNative.setJwt({ token });
      const res = await SharedAuthStoreNative.getJwt();
      if (res?.token?.length !== token.length) {
        // eslint-disable-next-line no-console
        console.error('[SharedAuthStore] setJwt verify mismatch:', res?.token?.length, 'vs', token.length);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SharedAuthStore] setJwt failed:', err?.message ?? err);
    }
  },

  async clearJwt() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.clearJwt();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SharedAuthStore] clearJwt failed:', err?.message ?? err);
    }
  },
};
