import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const [detailsResult, sourceResult, osmLocationsResult, physicalLocationsResult] = await Promise.all([
		locals.supabase.rpc('admin_get_brand_catalog_details', {
			p_brand_slug: params.slug
		}),
		locals.supabase
			.from('brands')
			.select('status,merged_into_slug,merged_at,match_policy,enrichment_mode')
			.eq('slug', params.slug)
			.maybeSingle(),
		locals.supabase.rpc('admin_get_brand_osm_observations', {
			p_brand_slug: params.slug
		}),
		locals.supabase.rpc('admin_get_brand_physical_locations', {
			p_brand_slug: params.slug
		})
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
	if (osmLocationsResult.error) {
		console.error('[brand catalog OSM locations]', osmLocationsResult.error);
		throw error(500, osmLocationsResult.error.message);
	}
	if (physicalLocationsResult.error) {
		console.error('[brand catalog physical locations]', physicalLocationsResult.error);
		throw error(500, physicalLocationsResult.error.message);
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
		enrichment_mode: source?.enrichment_mode ?? 'auto',
		osm_locations: osmLocationsResult.data ?? [],
		physical_locations: physicalLocationsResult.data ?? [],
		redirect
	});
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isAdmin) throw error(403, 'Forbidden');
	const body = (await request.json()) as {
		action?: unknown;
		location_id?: unknown;
		evidence_id?: unknown;
		resolution?: unknown;
		reason?: unknown;
	};
	if (body.action === 'remove_manual_evidence') {
		const evidenceId = typeof body.evidence_id === 'string' ? body.evidence_id : '';
		const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
		if (!evidenceId || !reason) throw error(400, 'A manual evidence record and reason are required.');

		const { data, error: rpcError } = await locals.supabase.rpc(
			'admin_remove_manual_location_evidence',
			{
				p_evidence_id: evidenceId,
				p_reason: reason
			}
		);
		if (rpcError) throw error(400, rpcError.message);
		return json({ ok: true, brand_slug: params.slug, result: data });
	}

	const locationId = typeof body.location_id === 'string' ? body.location_id : '';
	const resolution = typeof body.resolution === 'string' ? body.resolution : '';
	if (!locationId || !['attach_to_suggested', 'keep_separate'].includes(resolution)) {
		throw error(400, 'Choose a valid storefront resolution.');
	}

	const { data, error: rpcError } = await locals.supabase.rpc(
		'admin_resolve_brand_location_match',
		{
			p_location_id: locationId,
			p_resolution: resolution,
			p_note: null
		}
	);
	if (rpcError) throw error(400, rpcError.message);
	return json({ ok: true, brand_slug: params.slug, result: data });
};
