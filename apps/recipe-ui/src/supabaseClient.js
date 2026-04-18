import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { capacitorStorage } from './lib/capacitorPreferences';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        storage: Capacitor.isNativePlatform() ? capacitorStorage : undefined,
        storageKey: 'recifind-auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: !Capacitor.isNativePlatform(),
      },
    })
  : null;
