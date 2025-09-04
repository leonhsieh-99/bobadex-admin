import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { supabaseAnon } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.isAdmin) throw redirect(302, '/admin');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    const sb = supabaseAnon();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.user || !data?.session) {
      return fail(400, { message: 'Invalid credentials' });
    }

    // verify admin *right after login* to avoid setting a cookie for non-admins
    const { data: adminRow } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (!adminRow) return fail(403, { message: 'Not an admin' });

    // store only the Supabase access token (httpOnly, sameSite)
    const maxAge = Math.min(data.session.expires_in ?? 3600, 8 * 3600); // cap to 8h for admin
    cookies.set('sb', data.session.access_token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // set true in production (HTTPS)
      maxAge
    });

    throw redirect(302, '/admin');
  }
};
