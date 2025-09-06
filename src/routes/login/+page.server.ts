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

    // 1) Sign in with anon client
    const sb = supabaseAnon();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.user || !data?.session) {
      return fail(400, { message: 'Invalid credentials' });
    }

    // 2) Run the admin check **as the user** (RLS sees auth.uid())
    //    Option A: reuse the same client by setting the session
    await sb.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });

    const { data: adminRow, error: adminErr } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (adminErr) {
      return fail(500, { message: adminErr.message });
    }
    if (!adminRow) {
      return fail(403, { message: 'Not an admin' });
    }

    // 3) Set cookies with the **expected names**
    const accessMaxAge = Math.min(data.session.expires_in ?? 3600, 8 * 3600); // cap 8h for admin
    cookies.set('sb-access-token', data.session.access_token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: accessMaxAge
    });

    // 4) Go to admin
    throw redirect(302, '/admin');
  }
};
