import type { Session } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';

export const ACCESS_COOKIE = 'sb-access-token';
export const REFRESH_COOKIE = 'sb-refresh-token';

const secure = process.env.NODE_ENV === 'production';

export function setAuthCookies(cookies: Cookies, session: Session) {
	const accessMaxAge = Math.min(session.expires_in ?? 3600, 8 * 60 * 60);

	cookies.set(ACCESS_COOKIE, session.access_token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: accessMaxAge
	});
	cookies.set(REFRESH_COOKIE, session.refresh_token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 24 * 60 * 60
	});
}

export function clearAuthCookies(cookies: Cookies) {
	cookies.delete(ACCESS_COOKIE, { path: '/', secure });
	cookies.delete(REFRESH_COOKIE, { path: '/', secure });
	cookies.delete('adm', { path: '/', secure });
}
