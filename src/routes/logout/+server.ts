import { redirect, type RequestHandler } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies } from '$lib/auth.server';

export const POST: RequestHandler = async ({ cookies }) => {
	const access = cookies.get(ACCESS_COOKIE);
	const refresh = cookies.get(REFRESH_COOKIE);

	try {
		if (access && refresh && env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_ANON_KEY) {
			const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			});
			const { data } = await supabase.auth.setSession({
				access_token: access,
				refresh_token: refresh
			});
			if (data.session) await supabase.auth.signOut();
		}
	} finally {
		clearAuthCookies(cookies);
	}

	throw redirect(303, '/login');
};
