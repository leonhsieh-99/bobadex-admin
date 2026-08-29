import { redirect, error } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.userId) throw redirect(303, '/login');
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const admin = supabaseAdmin();
	const [reviewResult, enrichmentResult, imageResult] = await Promise.all([
		admin
			.schema('ingest')
			.from('poi_candidates')
			.select('*', { count: 'exact', head: true })
			.in('process_status', ['needs_exception_resolution', 'needs_manual_review']),
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

	if (reviewResult.error) {
		console.error('[admin layout] failed to count manual reviews', reviewResult.error);
	}
	if (enrichmentResult.error) {
		console.error('[admin layout] failed to count enrichment reviews', enrichmentResult.error);
	}
	if (imageResult.error) {
		console.error('[admin layout] failed to count image reviews', imageResult.error);
	}

	return {
		manualReviewCount: reviewResult.count ?? 0,
		enrichmentReviewCount: enrichmentResult.count ?? 0,
		imageReviewCount: imageResult.count ?? 0
	};
};
