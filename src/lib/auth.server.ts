import type { Session } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';

export const ACCESS_COOKIE = 'sb-access-token';
export const REFRESH_COOKIE = 'sb-refresh-token';

/** Idle access-cookie lifetime. The JWT inside is still short-lived and refreshed on request. */
export const ACCESS_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
/** Refresh-cookie lifetime. */
export const REFRESH_COOKIE_MAX_AGE = 60 * 24 * 60 * 60;

const secure = process.env.NODE_ENV === 'production';

export function setAuthCookies(cookies: Cookies, session: Session) {
	cookies.set(ACCESS_COOKIE, session.access_token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: ACCESS_COOKIE_MAX_AGE
	});
	cookies.set(REFRESH_COOKIE, session.refresh_token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: REFRESH_COOKIE_MAX_AGE
	});
}

export function clearAuthCookies(cookies: Cookies) {
	cookies.delete(ACCESS_COOKIE, { path: '/', secure });
	cookies.delete(REFRESH_COOKIE, { path: '/', secure });
	cookies.delete('adm', { path: '/', secure });
}
