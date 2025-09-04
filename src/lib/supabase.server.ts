import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

/** Anonymous client (no Authorization header) */
export function supabaseAnon(): SupabaseClient {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** Per-request client that forwards the user token via Authorization */
export function supabaseFromCookies(cookies: Cookies): SupabaseClient {
  const token = cookies.get('sb') ?? '';
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {}
  });
}
