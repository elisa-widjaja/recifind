import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { capacitorStorage } from './lib/capacitorPreferences';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Native (iOS): PKCE is required — OAuth returns via custom-scheme/Universal Link
// and PKCE's code_verifier prevents code interception by other apps.
// Web: implicit flow is Supabase's default and backward-compatible with any
// existing logged-in users. detectSessionInUrl handles the #access_token hash.
export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        flowType: Capacitor.isNativePlatform() ? 'pkce' : 'implicit',
        storage: Capacitor.isNativePlatform() ? capacitorStorage : undefined,
        storageKey: 'recifriend-auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: !Capacitor.isNativePlatform(),
      },
    })
  : null;
