import { registerPlugin, Capacitor } from '@capacitor/core';

// Registered in apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m
// via CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore", ...).
const SharedAuthStoreNative = registerPlugin('SharedAuthStore');

// Exposes a narrow promise API. On non-iOS platforms every call is a no-op so
// the main app can call it unconditionally.
export const SharedAuthStore = {
  async setJwt(token) {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.setJwt({ token });
    } catch (err) {
      console.warn('[SharedAuthStore] setJwt failed:', err?.message ?? err);
    }
  },
  async clearJwt() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.clearJwt();
    } catch (err) {
      console.warn('[SharedAuthStore] clearJwt failed:', err?.message ?? err);
    }
  },
};
