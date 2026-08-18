import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import type { RequestHandler } from './$types';

const levels = new Set(['country', 'admin1', 'metro', 'city']);
const allLevels = ['country', 'admin1', 'metro', 'city'];

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.isAdmin) return json({ error: 'Admin access required.' }, { status: 403 });

	const query = url.searchParams.get('q')?.trim() ?? '';
	const requestedLevels = url.searchParams
		.getAll('level')
		.map((level) => level.trim())
		.filter((level) => levels.has(level));
	if (query.length < 2) return json({ places: [] });

	const { data, error } = await supabaseAdmin().rpc('admin_search_geo_places', {
		p_query: query,
		p_levels: requestedLevels.length ? requestedLevels : allLevels,
		p_limit: 12
	});
	if (error) {
		console.error('[enrichment] place search', { query, requestedLevels, error });
		return json({ error: error.message }, { status: 500 });
	}
	return json({ places: data ?? [] });
};
