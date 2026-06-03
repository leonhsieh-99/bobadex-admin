// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

type Jwt = { sub?: string; user_id?: string; exp?: number };

function decodeJwt(token: string | undefined): Jwt | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof obj.sub === 'string' ? obj.sub : undefined,
      user_id: typeof obj.user_id === 'string' ? obj.user_id : undefined,
      exp: typeof obj.exp === 'number' ? obj.exp : undefined
    };
  } catch {
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const url = publicEnv.PUBLIC_SUPABASE_URL;
  const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY');

  // Read auth cookies we set at login
  const access = event.cookies.get('sb-access-token') ?? '';
  const refresh = event.cookies.get('sb-refresh-token') ?? '';

  // ONE server client for the whole request.
  // We forward the bearer via global.headers so PostgREST (db/rpc) sees auth.uid().
  const supabase: SupabaseClient = createClient(url, anon, {
    global: access ? { headers: { Authorization: `Bearer ${access}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  // Optional but helpful: let supabase-js know the session too (so other modules
  // besides PostgREST will also send the bearer automatically).
  if (access && refresh) {
    try {
      await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
    } catch {
      // ignore — we already pass Authorization via global.headers
    }
  }

  // Fill locals
  event.locals.supabase = supabase;
  event.locals.userId = null;
  event.locals.isAdmin = false;

  // Derive uid from JWT (no network)
  const jwt = decodeJwt(access);
  const notExpired = jwt?.exp ? jwt.exp * 1000 > Date.now() : false;
  const uid = notExpired ? (jwt?.sub ?? jwt?.user_id ?? null) : null;
  event.locals.userId = uid;

  // Admin check (RLS will see auth.uid() because of Authorization header above)
  let isAdmin = false;
  if (uid) {
    const { data, error } = await supabase
      .schema('mod')
      .from('admin_users')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle();
    
    if (error) {
      console.error('mod.admin_users query failed', error);
      throw new Error(`mod.admin_users query failed: ${error.message}`);
    }
    isAdmin = !!data;
  }
  
  event.locals.isAdmin = isAdmin;

  // (tiny cache if you like; safe to keep)
  event.cookies.set('adm', isAdmin ? '1' : '', {
    path: '/', httpOnly: true, sameSite: 'lax', maxAge: isAdmin ? 300 : 0
  });

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range'
  });
};
