// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '$lib/auth.server';

type Jwt = { sub?: string; user_id?: string; exp?: number; iss?: string; ref?: string };

function decodeJwt(token: string | undefined): Jwt | null {
	if (!token) return null;
	try {
		const part = token.split('.')[1];
		if (!part) return null;
		const b64 = part
			.replace(/-/g, '+')
			.replace(/_/g, '/')
			.padEnd(Math.ceil(part.length / 4) * 4, '=');
		const json = Buffer.from(b64, 'base64').toString('utf8');
		const obj = JSON.parse(json) as Record<string, unknown>;
		return {
			sub: typeof obj.sub === 'string' ? obj.sub : undefined,
			user_id: typeof obj.user_id === 'string' ? obj.user_id : undefined,
			exp: typeof obj.exp === 'number' ? obj.exp : undefined,
			iss: typeof obj.iss === 'string' ? obj.iss : undefined,
			ref: typeof obj.ref === 'string' ? obj.ref : undefined
		};
	} catch {
		return null;
	}
}

function belongsToProject(token: string, supabaseUrl: string) {
	const jwt = decodeJwt(token);
	const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
	return jwt?.ref === projectRef || jwt?.iss?.startsWith(`${supabaseUrl}/auth/v1`) === true;
}

export const handle: Handle = async ({ event, resolve }) => {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anon = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anon) throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY');

	const access = event.cookies.get(ACCESS_COOKIE) ?? '';
	const refresh = event.cookies.get(REFRESH_COOKIE) ?? '';

	let sessionAccess = '';
	let uid: string | null = null;

	if (refresh) {
		const jwt = decodeJwt(access);
		const now = Math.floor(Date.now() / 1000);
		const accessStillValid = Boolean(
			access && belongsToProject(access, url) && jwt?.exp && jwt.exp - 90 > now && jwt.sub
		);

		if (accessStillValid && jwt?.sub) {
			sessionAccess = access;
			uid = jwt.sub;
		} else {
			const authClient = createClient(url, anon, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			});
			const { data, error } = access
				? await authClient.auth.setSession({
						access_token: access,
						refresh_token: refresh
					})
				: await authClient.auth.refreshSession({ refresh_token: refresh });

			if (!error && data.session && belongsToProject(data.session.access_token, url)) {
				sessionAccess = data.session.access_token;
				uid = data.session.user.id;
				setAuthCookies(event.cookies, data.session);
			} else {
				clearAuthCookies(event.cookies);
			}
		}
	} else if (access) {
		clearAuthCookies(event.cookies);
	}

	// ONE server client for the whole request.
	// We forward the bearer via global.headers so PostgREST (db/rpc) sees auth.uid().
	const supabase: SupabaseClient = createClient(url, anon, {
		global: sessionAccess ? { headers: { Authorization: `Bearer ${sessionAccess}` } } : {},
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});

	// Fill locals
	event.locals.supabase = supabase;
	event.locals.userId = null;
	event.locals.isAdmin = false;

	event.locals.userId = uid;

	// Check membership through the security-definer RPC. The underlying mod table
	// intentionally is not selectable by authenticated clients.
	let isAdmin = false;
	if (uid) {
		const cachedAdmin = event.cookies.get('adm') === '1';
		if (cachedAdmin && event.request.method === 'GET') {
			isAdmin = true;
		} else {
			const { data, error } = await supabase.rpc('is_admin');
			if (error) {
				console.error('public.is_admin RPC failed', error);
			} else {
				isAdmin = data === true;
			}
		}
	}

	event.locals.isAdmin = isAdmin;

	// (tiny cache if you like; safe to keep)
	event.cookies.set('adm', isAdmin ? '1' : '', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: isAdmin ? 300 : 0
	});

	return resolve(event, {
		filterSerializedResponseHeaders: (name) => name === 'content-range'
	});
};
