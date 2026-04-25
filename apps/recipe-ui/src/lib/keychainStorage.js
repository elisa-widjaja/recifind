// Supabase auth-state storage backed by iOS Keychain (via SharedAuthStorePlugin).
// Replaces Capacitor Preferences (UserDefaults) which writes asynchronously to
// disk — that lost the PKCE code_verifier when iOS killed the app between
// signInWithOtp and the magic-link return trip. Keychain writes are synchronous
// and durable before the call returns.
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
      // Native plugin returns NSNull when the item is missing; bridge it as null.
      return value == null ? null : value;
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[keychainStorage] setItem failed:', key, err?.message ?? err);
    }
  },
  async removeItem(key) {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SharedAuthStoreNative.removeKeychainItem({ key });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[keychainStorage] removeItem failed:', key, err?.message ?? err);
    }
  },
};
