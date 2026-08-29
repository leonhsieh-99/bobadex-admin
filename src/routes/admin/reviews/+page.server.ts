/* eslint-disable @typescript-eslint/no-explicit-any */
import { error, redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import type { Actions, PageServerLoad } from './$types';

const tabs = [
	{
		id: 'manual',
		label: 'Manual review',
		statuses: ['needs_exception_resolution', 'needs_manual_review']
	},
	{ id: 'ready', label: 'Ready for enrichment', statuses: ['ready_for_enrichment'] },
	{ id: 'pending', label: 'Pending routing', statuses: ['pending'] },
	{ id: 'resolved', label: 'Resolved', statuses: ['resolved', 'resolved_existing'] },
	{ id: 'rejected', label: 'Known negatives', statuses: ['known_negative'] }
] as const;
const actionable = [
	'pending',
	'needs_exception_resolution',
	'needs_manual_review',
	'ready_for_enrichment'
];

function destination(form: FormData, values: Record<string, string | null | undefined>) {
	const params = new URLSearchParams();
	const requested = String(form.get('filter_tab') ?? 'manual');
	params.set('tab', tabs.some((tab) => tab.id === requested) ? requested : 'manual');
	const q = String(form.get('filter_q') ?? '').trim();
	if (q) params.set('q', q);
	for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
	return '/admin/reviews?' + params.toString();
}

async function assertActionable(id: string) {
	const { data, error: queryError } = await supabaseAdmin()
		.schema('ingest')
		.from('poi_candidates')
		.select('process_status')
		.eq('id', id)
		.maybeSingle();
	if (queryError || !data || !actionable.includes(data.process_status)) {
		throw error(
			409,
			queryError?.message ?? 'poi_candidate_not_actionable:' + (data?.process_status ?? 'missing')
		);
	}
}

export const load: PageServerLoad = async ({ url }) => {
	const admin = supabaseAdmin();
	const selected = tabs.find((tab) => tab.id === url.searchParams.get('tab')) ?? tabs[0];
	const q = url.searchParams.get('q')?.trim() ?? '';
	let query = admin
		.schema('ingest')
		.from('poi_candidates')
		.select(
			'id,canonical_name,normalized_name,lat,lon,address_input,region_key,route_class,process_status,process_reason,matched_brand_slug,matched_brand_location_id,identity_confidence,eligibility_confidence,freshness_confidence,risk_flags,updated_at'
		)
		.in('process_status', [...selected.statuses])
		.order('updated_at', { ascending: false })
		.limit(75);
	if (q) query = query.ilike('canonical_name', '%' + q + '%');

	const [candidateResult, statusResult, brandResult, aliasResult] = await Promise.all([
		query,
		admin.schema('ingest').from('poi_candidates').select('process_status').limit(10000),
		admin.from('brands').select('slug,display').limit(10000),
		admin.from('brand_aliases').select('brand_slug,alias_display,normalized_name').limit(10000)
	]);
	const sourceError =
		candidateResult.error ?? statusResult.error ?? brandResult.error ?? aliasResult.error;
	if (sourceError) throw error(500, 'Failed to load POI queue: ' + sourceError.message);

	const candidates = candidateResult.data ?? [];
	const ids = candidates.map((candidate) => candidate.id);
	let links: any[] = [];
	let observations: any[] = [];
	let reviews: any[] = [];
	if (ids.length) {
		const [linkResult, reviewResult] = await Promise.all([
			admin
				.schema('ingest')
				.from('poi_candidate_observations')
				.select('candidate_id,observation_id,linked_at')
				.in('candidate_id', ids)
				.is('unlinked_at', null),
			admin
				.schema('ingest')
				.from('poi_candidate_reviews')
				.select(
					'candidate_id,review_kind,status,decision,confidence,proposed_brand_slug,evidence,sources,risk_flags,model,created_at'
				)
				.in('candidate_id', ids)
				.order('created_at', { ascending: false })
		]);
		if (linkResult.error || reviewResult.error)
			throw error(
				500,
				'Failed to load POI evidence: ' + (linkResult.error ?? reviewResult.error)?.message
			);
		links = linkResult.data ?? [];
		reviews = reviewResult.data ?? [];
		const observationIds = [...new Set(links.map((link) => link.observation_id))];
		if (observationIds.length) {
			const result = await admin
				.schema('ingest')
				.from('poi_observations')
				.select(
					'id,provider,provider_record_id,observed_name,address_input,lat,lon,categories,source_url,last_seen_at'
				)
				.in('id', observationIds);
			if (result.error) throw error(500, 'Failed to load observations: ' + result.error.message);
			observations = result.data ?? [];
		}
	}

	const observationById = new Map(observations.map((row) => [row.id, row]));
	const observationsByCandidate: Record<string, any[]> = {};
	for (const link of links.sort((a, b) => String(b.linked_at).localeCompare(String(a.linked_at)))) {
		const observation = observationById.get(link.observation_id);
		if (observation) (observationsByCandidate[link.candidate_id] ??= []).push(observation);
	}
	const latestReviewByCandidate: Record<string, any> = {};
	for (const review of reviews) latestReviewByCandidate[review.candidate_id] ??= review;
	const statusCounts: Record<string, number> = {};
	for (const row of statusResult.data ?? [])
		statusCounts[row.process_status] = (statusCounts[row.process_status] ?? 0) + 1;

	return {
		candidates,
		observationsByCandidate,
		latestReviewByCandidate,
		brands: brandResult.data ?? [],
		aliases: aliasResult.data ?? [],
		reviewTabs: tabs,
		statusCounts,
		reviewTab: selected.id,
		q
	};
};

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'approve_failed', msg: 'missing_candidate' }));
		await assertActionable(id);
		const { data, error: rpcError } = await locals.supabase.rpc('approve_poi_candidate', {
			p_candidate_id: id,
			p_force_display: String(form.get('force_display') ?? '').trim() || null,
			p_note: String(form.get('note') ?? '').trim() || null
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'approve_failed', msg: rpcError.message }));
		const result = (Array.isArray(data) ? data[0] : data) as any;
		throw redirect(
			303,
			destination(form, {
				toast: result?.skipped ? 'manual_review' : 'created_new',
				brand: result?.brand_slug,
				msg: result?.reason
			})
		);
	},
	merge: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		const brand = String(form.get('brand_slug') ?? '').trim();
		if (!id || !brand)
			throw redirect(303, destination(form, { toast: 'merge_failed', msg: 'missing_params' }));
		await assertActionable(id);
		const { error: rpcError } = await locals.supabase.rpc('admin_attach_poi_candidate_to_brand', {
			p_candidate_id: id,
			p_brand_slug: brand,
			p_note: String(form.get('note') ?? '').trim() || null
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'merge_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'attached', brand }));
	},
	reject: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'reject_failed', msg: 'missing_candidate' }));
		await assertActionable(id);
		const { error: rpcError } = await locals.supabase.rpc('reject_poi_candidate', {
			p_candidate_id: id,
			p_note: String(form.get('note') ?? '').trim() || null
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'reject_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'rejected' }));
	},
	processReady: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const limit = Math.min(25, Math.max(1, Number(form.get('limit') ?? 1) || 1));
		const { data, error: rpcError } = await supabaseAdmin().rpc(
			'process_ready_poi_candidates_batch',
			{ p_limit: limit }
		);
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'worker_failed', msg: rpcError.message }));
		const result = (Array.isArray(data) ? data[0] : data) as any;
		throw redirect(
			303,
			destination(form, { toast: 'worker_complete', msg: 'processed:' + (result?.processed ?? 0) })
		);
	}
};
