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
  if (receive === 'granted') {
    await _register(api);
    return;
  }
  if (receive === 'denied') return; // user already said no

  // prompt-able
  const prompted = await hasPromptedForPermission();
  if (prompted) return;
  const { receive: afterPrompt } = await PushNotifications.requestPermissions();
  await Preferences.set({ key: 'push_prompted', value: 'true' });
  if (afterPrompt === 'granted') await _register(api);
}

async function _register(api) {
  await PushNotifications.register();
  await PushNotifications.addListener('registration', async ({ value }) => {
    currentToken = value;
    await api.register({ apns_token: value });
  });
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
