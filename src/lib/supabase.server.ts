// lib/supabase.server.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

/** Anonymous client */
export function supabaseAnon(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** Per-request client that forwards the user's JWT */
export function supabaseFromCookies(cookies: Cookies): SupabaseClient {
  const access = cookies.get('sb-access-token') ?? '';
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: access ? { headers: { Authorization: `Bearer ${access}` } } : {}
  });
}

export function supabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}