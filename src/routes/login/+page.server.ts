// src/routes/login/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { clearAuthCookies, setAuthCookies } from '$lib/auth.server';

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

    if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_ANON_KEY) {
      return fail(500, { message: 'Server not configured' });
    }

    // Use a throwaway anon client for sign-in
    const sb = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data?.session) {
      clearAuthCookies(cookies);
      return fail(400, { message: error?.message ?? 'Invalid credentials', email: email.trim() });
    } 

    setAuthCookies(cookies, data.session);

    // Don’t do the admin check here—let the /admin guard handle it
    throw redirect(303, '/admin');
  }
};
