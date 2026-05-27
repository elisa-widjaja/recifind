import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';

let currentToken = null;

/**
 * Ensures the device is registered to receive pushes.
 * - If not prompted before AND permission is 'prompt', prompts once.
 * - If granted, calls register() and listens for the APNs token.
 * - On receiving a token, POSTs to /devices/register.
 * @param {{ api: { register: (body: {apns_token: string}) => Promise<any> }, jwt: string }} args
 */
export async function ensureRegistered({ api, jwt }) {
  const { receive } = await PushNotifications.checkPermissions();
  console.log('[push] ensureRegistered: iOS permission =', receive);

  // Permission-prompting still gates on prior state — Apple's policy only lets
  // the native dialog appear once. After that, we *always* call _register so
  // the app surfaces in Settings → Notifications, regardless of permission
  // outcome. iOS won't deliver pushes until granted, but the app being in
  // Settings lets the user toggle it on later. Skipping register() here was
  // the dead-end that left a user unable to re-grant after dismissing the
  // first dialog.
  if (receive !== 'granted' && receive !== 'denied') {
    const prompted = await hasPromptedForPermission();
    console.log('[push] hasPromptedForPermission =', prompted);
    if (!prompted) {
      console.log('[push] requesting iOS permission…');
      const { receive: afterPrompt } = await PushNotifications.requestPermissions();
      console.log('[push] after prompt =', afterPrompt);
      await Preferences.set({ key: 'push_prompted', value: 'true' });
    }
  } else if (receive === 'denied') {
    console.warn('[push] iOS permission denied — pushes will not deliver until enabled in Settings → Notifications → ReciFriend');
  }

  await _register(api);
}

async function _register(api) {
  // Listeners must be added BEFORE register() — Capacitor's PushNotifications
  // docs are explicit on this. If we register first, iOS can fire the
  // 'registration' event before the listener is attached, and the APNs
  // token is lost permanently (no retry path).
  await PushNotifications.addListener('registration', async ({ value }) => {
    console.log('[push] APNs token received', value?.slice(0, 8) + '…');
    currentToken = value;
    try {
      await api.register({ apns_token: value });
      console.log('[push] /devices/register OK');
    } catch (err) {
      console.error('[push] /devices/register failed:', err?.message || err);
    }
  });
  await PushNotifications.addListener('registrationError', ({ error }) => {
    console.error('[push] APNs registration error:', error);
  });
  try {
    await PushNotifications.register();
    console.log('[push] PushNotifications.register() resolved — awaiting token…');
  } catch (err) {
    console.error('[push] PushNotifications.register() threw:', err?.message || err);
  }
}

export async function hasPromptedForPermission() {
  const { value } = await Preferences.get({ key: 'push_prompted' });
  return value === 'true';
}

export function getCurrentApnsToken() {
  return currentToken;
}

/**
 * Register a handler for notification taps. Wire to the shared deep-link dispatcher.
 * @param {(deepLinkUrl: string) => void} handler
 * @returns {Promise<{ remove: () => void }>}
 */
export function onNotificationTap(handler) {
  return PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const link = notification.data?.deep_link;
    if (link) handler(link);
  });
}
