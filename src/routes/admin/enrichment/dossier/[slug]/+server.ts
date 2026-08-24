import { error, json } from '@sveltejs/kit';
import { loadBrandEnrichmentDossier } from '$lib/server/enrichment-dossier.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	try {
		const result = await loadBrandEnrichmentDossier(locals.supabase, params.slug);
		if (!result.brand) throw error(404, 'Brand not found.');
		return json(result);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		console.error('[enrichment dossier]', cause);
		throw error(500, cause instanceof Error ? cause.message : 'Could not load the enrichment dossier.');
	}
};
