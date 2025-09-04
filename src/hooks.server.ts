// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

const supabaseAnon = () =>
  createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!);

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.userId = null;
  event.locals.isAdmin = false;

  const token = event.cookies.get('sb') ?? null;

  try {
    // 1) Resolve user from the raw token
    if (token) {
      const { data: userData, error: uErr } = await supabaseAnon().auth.getUser(token);
      if (uErr) {
        console.error('[hooks] getUser error:', uErr);
      }
      const uid = userData?.user?.id ?? null;
      event.locals.userId = uid;

      // 2) Check admins table (must be allowed by your RLS)
      if (uid) {
        const { data: adminRow, error: aErr } = await supabaseAnon()
          .from('admin_users')
          .select('user_id')
          .eq('user_id', uid)
          .maybeSingle();

        if (aErr) {
          console.error('[hooks] admins query error:', aErr);
        }

        event.locals.isAdmin = !!adminRow;
      }
    }
  } catch (e) {
    console.error('[hooks] unexpected auth error:', e);
  }

  return resolve(event);
};
