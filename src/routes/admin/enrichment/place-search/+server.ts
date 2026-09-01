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

	const importable = url.searchParams.get('importable') === '1';
	const { data, error } = await supabaseAdmin().rpc('admin_search_geo_places', {
		p_query: query,
		p_levels: requestedLevels.length ? requestedLevels : importable ? ['admin1'] : allLevels,
		p_limit: importable ? 20 : 12
	});
	if (error) {
		console.error('[enrichment] place search', { query, requestedLevels, error });
		return json({ error: error.message }, { status: 500 });
	}

	let places = (data ?? []) as Array<{ place_id: string }>;
	if (importable && places.length) {
		const { data: bounded, error: boundaryError } = await supabaseAdmin()
			.from('geo_place_boundaries')
			.select('geo_place_id')
			.in(
				'geo_place_id',
				places.map((place: { place_id: string }) => place.place_id)
			);
		if (boundaryError) {
			console.error('[enrichment] importable place filter', boundaryError);
			return json({ error: boundaryError.message }, { status: 500 });
		}
		const allowed = new Set((bounded ?? []).map((row) => row.geo_place_id));
		places = places.filter((place: { place_id: string }) => allowed.has(place.place_id));
	}

	return json({ places });
};
