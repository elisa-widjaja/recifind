// apps/shared/contracts.ts
// SINGLE SOURCE OF TRUTH — imported by apps/worker and apps/recipe-ui.
// Change policy: any edit here is a breaking change; announce in PR and
// re-run consumer story tests.

// ─── C1: Share API ─────────────────────────────────────────────────

export type ShareRecipeRequest = {
  recipient_user_ids: string[];
};

export type ShareRecipeResponse = {
  shared_with: number;
  skipped: number;
};

export type ShareRecipeError =
  | { code: 'NOT_FRIENDS'; non_friend_user_ids: string[] }
  | { code: 'RATE_LIMITED'; retry_after_seconds: number }
  | { code: 'FORBIDDEN' };

export const SHARE_RECIPE_MAX_RECIPIENTS = 50;
export const SHARE_RECIPE_MIN_RECIPIENTS = 1;
export const SHARE_RECIPE_RATE_LIMIT_PER_HOUR = 20;

// ─── C2: Device registration ───────────────────────────────────────

export type RegisterDeviceRequest = {
  apns_token: string;  // hex string, 64 chars
};

export type RegisterDeviceResponse = { ok: true };

export type UnregisterDeviceRequest = {
  apns_token: string;
};

export const APNS_TOKEN_REGEX = /^[a-fA-F0-9]{64}$/;
export const DEVICES_REGISTER_RATE_LIMIT_PER_HOUR = 20;

// ─── C3: Deep link schema ──────────────────────────────────────────

export const ALLOWED_HOSTS = new Set<string>(['recifriend.com', 'www.recifriend.com']);
export const CUSTOM_SCHEME_PROTOCOL = 'recifriend:';
export const UNIVERSAL_LINK_ORIGIN = 'https://recifriend.com';

export const ALLOWED_DEEP_LINK_PATHS = new Set<string>([
  '/auth/callback',
  '/add-recipe',
  '/friend-requests',
]);

export const RECIPE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export type DeepLink =
  | { kind: 'auth_callback'; code: string }
  | { kind: 'add_recipe'; url: string }
  | { kind: 'friend_requests' }
  | { kind: 'recipe_detail'; recipe_id: string };

// ─── C4: APNs payload ──────────────────────────────────────────────

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: 'default';
  };
  deep_link: string;  // must be http(s)://recifriend.com/... or recifriend://
};

// ─── C5: iOS identifiers ───────────────────────────────────────────

export const IOS = {
  APP_NAME: 'ReciFriend',
  BUNDLE_ID: 'com.recifriend.app',
  SHARE_EXT_BUNDLE_ID: 'com.recifriend.app.share',
  URL_SCHEME: 'recifriend',
  ASSOCIATED_DOMAIN: 'applinks:recifriend.com',
} as const;

export type IOSIdentifiers = typeof IOS;
