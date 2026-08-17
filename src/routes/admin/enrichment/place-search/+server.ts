import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import type { RequestHandler } from './$types';

const levels = new Set(['country', 'admin1', 'metro', 'city']);

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.isAdmin) return json({ error: 'Admin access required.' }, { status: 403 });

	const query = url.searchParams.get('q')?.trim() ?? '';
	const level = url.searchParams.get('level')?.trim() ?? '';
	if (query.length < 2 || !levels.has(level)) return json({ places: [] });

	const { data, error } = await supabaseAdmin().rpc('admin_search_geo_places', {
		p_query: query,
		p_levels: [level],
		p_limit: 12
	});
	if (error) {
		console.error('[enrichment] place search', { query, level, error });
		return json({ error: error.message }, { status: 500 });
	}
	return json({ places: data ?? [] });
};
