import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const levels = new Set(['country', 'admin1', 'metro', 'city']);

export const GET: RequestHandler = async ({ url, locals }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	const level = url.searchParams.get('level')?.trim() ?? '';
	if (query.length < 2 || !levels.has(level)) return json({ places: [] });

	const { data, error } = await locals.supabase.rpc('admin_search_geo_places', {
		p_query: query,
		p_levels: [level],
		p_limit: 12
	});
	if (error) return json({ error: error.message }, { status: 400 });
	return json({ places: data ?? [] });
};
