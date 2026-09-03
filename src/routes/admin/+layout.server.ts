import { redirect, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import { parseStorefrontReviewPayload } from '$lib/poi-storefront-dossiers';
import type { LayoutServerLoad } from './$types';

const BADGE_COOKIE = 'adm-badges';
const BADGE_TTL_MS = 45_000;

type BadgeCounts = {
	manualReviewCount: number;
	enrichmentReviewCount: number;
	imageReviewCount: number;
};

function readBadgeCache(cookie: string | undefined): BadgeCounts | null {
	if (!cookie) return null;
	try {
		const parsed = JSON.parse(cookie) as BadgeCounts & { exp?: number };
		if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
		if (
			typeof parsed.manualReviewCount !== 'number' ||
			typeof parsed.enrichmentReviewCount !== 'number' ||
			typeof parsed.imageReviewCount !== 'number'
		) {
			return null;
		}
		return {
			manualReviewCount: parsed.manualReviewCount,
			enrichmentReviewCount: parsed.enrichmentReviewCount,
			imageReviewCount: parsed.imageReviewCount
		};
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async ({ locals, cookies, request, depends }) => {
	depends('app:admin-badges');
	if (!locals.userId) throw redirect(303, '/login');
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	if (request.method === 'GET') {
		const cached = readBadgeCache(cookies.get(BADGE_COOKIE));
		if (cached) return cached;
	}

	const admin = supabaseAdmin();
	const [reviewResult, enrichmentResult, imageResult] = await Promise.all([
		locals.supabase.rpc('get_poi_storefront_review_dossiers', { p_limit: 100, p_offset: 0 }),
		admin
			.schema('mod')
			.from('brand_dossiers')
			.select('*', { count: 'exact', head: true })
			.eq('approval_status', 'needs_review'),
		admin
			.schema('mod')
			.from('brand_icon_candidates')
			.select('*', { count: 'exact', head: true })
			.eq('status', 'generated')
	]);

	let storefrontCount = 0;
	if (reviewResult.error) {
		console.error('[admin layout] failed to count storefront reviews', reviewResult.error);
	} else {
		try {
			storefrontCount = parseStorefrontReviewPayload(reviewResult.data).length;
		} catch (parseError) {
			console.error('[admin layout] failed to parse storefront reviews', parseError);
		}
	}
	if (enrichmentResult.error) {
		console.error('[admin layout] failed to count enrichment reviews', enrichmentResult.error);
	}
	if (imageResult.error) {
		console.error('[admin layout] failed to count image reviews', imageResult.error);
	}

	const counts = {
		manualReviewCount: storefrontCount,
		enrichmentReviewCount: enrichmentResult.count ?? 0,
		imageReviewCount: imageResult.count ?? 0
	};
	cookies.set(BADGE_COOKIE, JSON.stringify({ ...counts, exp: Date.now() + BADGE_TTL_MS }), {
		path: '/admin',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60
	});
	return counts;
};
