// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

export const handle: Handle = async ({ event, resolve }) => {
  const access = event.cookies.get('sb-access-token') ?? '';
  const sb = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    global: access ? { headers: { Authorization: `Bearer ${access}` } } : {}
  });

  event.locals.sb = sb;
  event.locals.userId = null;
  event.locals.isAdmin = false;

  const { data: userData } = await sb.auth.getUser();
  const uid = userData?.user?.id ?? null;
  event.locals.userId = uid;

  if (uid) {
    const { data: row } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle();
    event.locals.isAdmin = !!row;
  }

  return resolve(event);
};
