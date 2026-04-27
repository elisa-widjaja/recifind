// Supabase auth-state storage backed by iOS Keychain (via SharedAuthStorePlugin).
// Replaces Capacitor Preferences (UserDefaults) which writes asynchronously to
// disk — UserDefaults could lose the OAuth PKCE code_verifier if iOS killed
// the app between the OAuth start and its callback. Keychain writes are
// synchronous and durable before the call returns.
//
// On web this falls through to localStorage via Supabase's default (caller
// passes `undefined` for storage on web, which we don't override).
import { Capacitor } from '@capacitor/core';
import { SharedAuthStoreNative } from '../native/SharedAuthStore';

export const keychainStorage = {
  async getItem(key) {
    if (!Capacitor.isNativePlatform()) return null;
    try {
      const { value } = await SharedAuthStoreNative.getKeychainItem({ key });
      const found = value != null;
      // eslint-disable-next-line no-console
      console.log('[keychainStorage] getItem', key, '->', found ? `len=${value.length}` : 'NULL');
      return found ? value : null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[keychainStorage] getItem failed:', key, err?.message ?? err);
      return null;
    }
  },
  async setItem(key, value) {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.setKeychainItem({ key, value });
      // eslint-disable-next-line no-console
      console.log('[keychainStorage] setItem', key, 'len=', value?.length ?? 0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[keychainStorage] setItem failed:', key, err?.message ?? err);
    }
  },
  async removeItem(key) {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.removeKeychainItem({ key });
      // eslint-disable-next-line no-console
      console.log('[keychainStorage] removeItem', key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[keychainStorage] removeItem failed:', key, err?.message ?? err);
    }
  },
};
