import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '$lib/supabase.server';
import {
	applyStorefrontPlaces,
	parseStorefrontReviewPayload,
	type StorefrontDossier
} from '$lib/poi-storefront-dossiers';

export async function loadStorefrontReviewDossiers(
	supabase: SupabaseClient,
	limit = 25,
	offset = 0
): Promise<{ dossiers: StorefrontDossier[]; error: string | null }> {
	const { data, error } = await supabase.rpc('get_poi_storefront_review_dossiers', {
		p_limit: limit,
		p_offset: offset
	});
	if (error) return { dossiers: [], error: error.message };
	try {
		const dossiers = await withFullAddresses(parseStorefrontReviewPayload(data));
		return { dossiers, error: null };
	} catch (parseError) {
		return {
			dossiers: [],
			error: parseError instanceof Error ? parseError.message : 'invalid payload'
		};
	}
}

async function withFullAddresses(dossiers: StorefrontDossier[]) {
	const observationIds = [
		...new Set(
			dossiers.flatMap((dossier) =>
				(dossier.identity_groups ?? []).flatMap((group) =>
					(group.observations ?? [])
						.map((observation) => observation.observation_id)
						.filter((id): id is string => Boolean(id))
				)
			)
		)
	];
	const candidateIds = [
		...new Set(
			dossiers.flatMap((dossier) =>
				(dossier.identity_groups ?? []).flatMap((group) => group.candidate_ids ?? [])
			)
		)
	];
	const admin = supabaseAdmin();
	const extraIds: string[] = [];
	if (candidateIds.length) {
		const links = await admin
			.schema('ingest')
			.from('poi_candidate_observations')
			.select('observation_id')
			.in('candidate_id', candidateIds)
			.is('unlinked_at', null);
		for (const link of links.data ?? []) {
			if (link.observation_id) extraIds.push(link.observation_id);
		}
	}
	const ids = [...new Set([...observationIds, ...extraIds])];
	if (!ids.length) return applyStorefrontPlaces(dossiers, []);
	const { data: places, error } = await admin
		.schema('ingest')
		.from('poi_observations')
		.select('id,address_input,locality,admin1,postal_code')
		.in('id', ids);
	if (error) {
		console.error('[storefront] failed to load observation addresses', error);
		return applyStorefrontPlaces(dossiers, []);
	}
	return applyStorefrontPlaces(dossiers, places ?? []);
}
