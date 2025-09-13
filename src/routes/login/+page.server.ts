// src/routes/login/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

const PROD = process.env.NODE_ENV === 'production';

export const load: PageServerLoad = async ({ locals }) => {
  // Optional: if the user is already allowed into /admin, bounce them there
  if (locals.isAdmin) throw redirect(302, '/admin');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return fail(500, { message: 'Server not configured' });
    }

    // Use a throwaway anon client for sign-in
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data?.session) {
      return fail(400, { message: 'Invalid credentials' });
    }

    // Set BOTH cookies so future requests have auth context
    const { access_token, refresh_token, expires_in } = data.session;

    const accessMaxAge = Math.min(expires_in ?? 3600, 8 * 3600); // up to 8h
    cookies.set('sb-access-token', access_token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      maxAge: accessMaxAge
    });

    // Give the server something to refresh with later if you add refresh logic
    cookies.set('sb-refresh-token', refresh_token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD,
      // Supabase refresh tokens are long-lived; 60 days is typical
      maxAge: 60 * 24 * 60 * 60
    });

    // Don’t do the admin check here—let the /admin guard handle it
    throw redirect(302, '/admin');
  }
};
