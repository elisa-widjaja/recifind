// Pending-share handoff from the iOS share extension's App Group storage.
// Returns null silently on web and on any plugin error — the drain effect
// in App.jsx treats absence and failure identically.
// Native plugin lives in apps/ios/ios/App/App/Plugins/SharedAuthStore/.
import { Capacitor } from '@capacitor/core';
import { SharedAuthStoreNative } from '../native/SharedAuthStore';

export async function readPendingShare() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await SharedAuthStoreNative.readPendingShare();
  } catch {
    return null;
  }
}

export async function clearPendingShare() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SharedAuthStoreNative.clearPendingShare();
  } catch {
    // intentional: idempotent clear, swallow
  }
}
