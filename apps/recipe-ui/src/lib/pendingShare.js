import { Capacitor, registerPlugin } from '@capacitor/core';

const SharedAuthStore = registerPlugin('SharedAuthStore');

export async function readPendingShare() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await SharedAuthStore.readPendingShare();
  } catch {
    return null;
  }
}

export async function clearPendingShare() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SharedAuthStore.clearPendingShare();
  } catch {
    // intentional: idempotent clear, swallow
  }
}
