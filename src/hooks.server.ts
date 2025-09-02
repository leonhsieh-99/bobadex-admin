import type { Handle } from '@sveltejs/kit';
import { supabaseFromCookies } from '$lib/supabase.server';

export const handle: Handle = async ({ event, resolve }) => {
  // default
  event.locals.userId = null;
  event.locals.isAdmin = false;

  // build per-request supabase client using the token cookie (if present)
  const sb = supabaseFromCookies(event.cookies);

  // 1) resolve user from token
  const { data: userData } = await sb.auth.getUser();
  const uid = userData?.user?.id ?? null;
  event.locals.userId = uid;

  // 2) check admin table (simple & authoritative on each request)
  if (uid) {
    const { data: adminRow } = await sb
      .from('admins')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle();
    event.locals.isAdmin = !!adminRow;
  }

  return resolve(event);
};
