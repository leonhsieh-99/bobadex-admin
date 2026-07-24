import { redirect, error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.userId) throw redirect(303, '/login');
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const { count, error: countError } = await locals.supabase
		.schema('ingest')
		.from('osm_candidate_pipeline_states')
		.select('*', { count: 'exact', head: true })
		.eq('pipeline_state', 'waiting_manual_review');

	if (countError) console.error('[admin layout] failed to count manual reviews', countError);

	return { manualReviewCount: count ?? 0 };
};
