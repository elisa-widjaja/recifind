import { registerPlugin, Capacitor } from '@capacitor/core';

// Registered in apps/ios/ios/App/App/Plugins/SharedAuthStore/SharedAuthStorePlugin.m
// via CAP_PLUGIN(SharedAuthStorePlugin, "SharedAuthStore", ...).
const SharedAuthStoreNative = registerPlugin('SharedAuthStore');

// Module-level diagnostics so App.jsx can surface why setJwt may not be
// reaching the shared Keychain. Latest attempt only; overwritten each call.
let lastAttempt = null; // { at: number, action: string, ok: boolean, detail: string }
const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(lastAttempt); } catch {} }); }

function record(action, ok, detail) {
  lastAttempt = { at: Date.now(), action, ok, detail };
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('[SharedAuthStore]', action, 'failed:', detail);
  } else {
    // eslint-disable-next-line no-console
    console.log('[SharedAuthStore]', action, 'ok:', detail);
  }
  emit();
}

export const SharedAuthStore = {
  async setJwt(token) {
    if (!Capacitor.isNativePlatform()) return;
    if (!token) { record('setJwt', false, 'no token passed'); return; }
    try {
      await SharedAuthStoreNative.setJwt({ token });
      // Verify the write actually landed. If the plugin is an unimplemented
      // web-fallback proxy, setJwt may silently resolve — getJwt will reveal it.
      try {
        const res = await SharedAuthStoreNative.getJwt();
        const readLen = res?.token?.length ?? 0;
        if (readLen === token.length) {
          record('setJwt', true, `verified, len=${token.length}`);
        } else {
          record('setJwt', false, `verify mismatch: wrote=${token.length} read=${readLen}`);
        }
      } catch (readErr) {
        record('setJwt', false, `wrote, verify-read threw: ${readErr?.message ?? readErr}`);
      }
    } catch (err) {
      record('setJwt', false, err?.message ?? String(err));
    }
  },

  async clearJwt() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.clearJwt();
      record('clearJwt', true, 'ok');
    } catch (err) {
      record('clearJwt', false, err?.message ?? String(err));
    }
  },

  getDiagnostics() {
    return {
      isNative: Capacitor.isNativePlatform(),
      pluginHasSetJwt: typeof SharedAuthStoreNative?.setJwt === 'function',
      lastAttempt,
    };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
