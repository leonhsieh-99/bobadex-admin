import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const { data, error: rpcError } = await locals.supabase.rpc(
		'admin_get_brand_enrichment_research_scope',
		{ p_brand_slug: params.slug }
	);
	if (rpcError) {
		console.error('[enrichment] getResearchScope', rpcError);
		throw error(rpcError.code === 'P0002' ? 404 : 500, rpcError.message);
	}

	return json(data ?? {});
};
