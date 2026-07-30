import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const [detailsResult, sourceResult] = await Promise.all([
		locals.supabase.rpc('admin_get_brand_catalog_details', {
			p_brand_slug: params.slug
		}),
		locals.supabase
			.from('brands')
			.select('status,merged_into_slug,merged_at,match_policy')
			.eq('slug', params.slug)
			.maybeSingle()
	]);
	const { data, error: rpcError } = detailsResult;
	if (rpcError) {
		console.error('[brand catalog details]', rpcError);
		throw error(rpcError.code === 'P0002' ? 404 : 500, rpcError.message);
	}
	if (sourceResult.error) {
		console.error('[brand catalog redirect]', sourceResult.error);
		throw error(500, sourceResult.error.message);
	}

	let redirect = null;
	const source = sourceResult.data;
	if (source?.status === 'merged' && source.merged_into_slug) {
		const { data: target, error: targetError } = await locals.supabase
			.from('brands')
			.select('slug,display')
			.eq('slug', source.merged_into_slug)
			.single();
		if (targetError) {
			console.error('[brand catalog redirect target]', targetError);
			throw error(500, targetError.message);
		}
		redirect = {
			target_slug: target.slug,
			target_display: target.display,
			merged_at: source.merged_at
		};
	}

	return json({
		...(data ?? {}),
		match_policy: source?.match_policy ?? 'corroboration_required',
		redirect
	});
};
