/* eslint-disable @typescript-eslint/no-explicit-any */
import { error, redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import { blockedCreateReasons, isCancelledLatestReview } from '$lib/poi-review-actions';
import type { Actions, PageServerLoad } from './$types';

const tabs = [
	{
		id: 'manual',
		label: 'Manual review',
		statuses: ['needs_exception_resolution', 'needs_manual_review']
	},
	{ id: 'ready', label: 'Ready for enrichment', statuses: ['ready_for_enrichment'] },
	{ id: 'pending', label: 'Pending routing', statuses: ['pending'] },
	{ id: 'history', label: 'History', statuses: [] }
] as const;
const actionable = [
	'pending',
	'needs_exception_resolution',
	'needs_manual_review',
	'ready_for_enrichment'
];
const CANDIDATE_COLUMNS =
	'id,canonical_name,normalized_name,lat,lon,address_input,region_key,route_class,process_status,process_reason,matched_brand_slug,matched_brand_location_id,identity_confidence,eligibility_confidence,freshness_confidence,brand_creation_gate_status,risk_flags,created_at,updated_at';

function destination(form: FormData, values: Record<string, string | null | undefined>) {
	const params = new URLSearchParams();
	const requested = String(form.get('filter_tab') ?? 'manual');
	params.set('tab', tabs.some((tab) => tab.id === requested) ? requested : 'manual');
	const q = String(form.get('filter_q') ?? '').trim();
	if (q) params.set('q', q);
	for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
	return '/admin/reviews?' + params.toString();
}

async function loadCandidate(id: string) {
	const { data, error: queryError } = await supabaseAdmin()
		.schema('ingest')
		.from('poi_candidates')
		.select(
			'id,process_status,route_class,process_reason,matched_brand_slug,brand_creation_gate_status,risk_flags'
		)
		.eq('id', id)
		.maybeSingle();
	if (queryError || !data) {
		throw error(409, queryError?.message ?? 'poi_candidate_not_actionable:missing');
	}
	if (!actionable.includes(data.process_status)) {
		throw error(409, 'poi_candidate_not_actionable:' + data.process_status);
	}
	return data;
}

async function latestReview(id: string) {
	const { data } = await supabaseAdmin()
		.schema('ingest')
		.from('poi_candidate_reviews')
		.select('review_kind,status,decision')
		.eq('candidate_id', id)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	return data;
}

async function applyTargetedResolution(
	locals: any,
	id: string,
	routeClass: string,
	decision: string
) {
	const { error: rpcError } = await locals.supabase.rpc('apply_poi_targeted_resolution', {
		p_candidate_id: id,
		p_expected_route_class: routeClass,
		p_plan: { candidate_id: id, decision }
	});
	return rpcError;
}

export const load: PageServerLoad = async ({ url }) => {
	const admin = supabaseAdmin();
	const selected = tabs.find((tab) => tab.id === url.searchParams.get('tab')) ?? tabs[0];
	const q = url.searchParams.get('q')?.trim() ?? '';
	const historyMode = selected.id === 'history';

	const statusResult = await admin
		.schema('ingest')
		.from('poi_candidates')
		.select('process_status')
		.limit(10000);
	if (statusResult.error)
		throw error(500, 'Failed to load POI queue: ' + statusResult.error.message);

	const [historyCountResult, cancelledCountResult, brandResult, aliasResult] = await Promise.all([
		admin
			.schema('ingest')
			.from('poi_candidate_reviews')
			.select('*', { count: 'exact', head: true })
			.in('status', ['completed', 'cancelled']),
		admin
			.schema('ingest')
			.from('poi_candidate_reviews')
			.select('*', { count: 'exact', head: true })
			.eq('status', 'cancelled'),
		admin.from('brands').select('slug,display').limit(10000),
		admin.from('brand_aliases').select('brand_slug,alias_display,normalized_name').limit(10000)
	]);
	const lookupError = brandResult.error ?? aliasResult.error;
	if (lookupError) throw error(500, 'Failed to load POI queue: ' + lookupError.message);

	let candidates: any[] = [];
	let history: any[] = [];
	if (historyMode) {
		const [reviewResult, terminalResult] = await Promise.all([
			admin
				.schema('ingest')
				.from('poi_candidate_reviews')
				.select(
					'id,candidate_id,review_kind,status,decision,question,confidence,model,reviewer_version,evidence,created_at,completed_at,error_text'
				)
				.in('status', ['completed', 'cancelled'])
				.order('created_at', { ascending: false })
				.limit(150),
			admin
				.schema('ingest')
				.from('poi_candidates')
				.select(
					'id,canonical_name,region_key,route_class,process_status,process_reason,matched_brand_slug,updated_at,created_at'
				)
				.in('process_status', ['resolved', 'resolved_existing', 'known_negative', 'rejected'])
				.order('updated_at', { ascending: false })
				.limit(150)
		]);
		if (reviewResult.error || terminalResult.error)
			throw error(
				500,
				'Failed to load review history: ' + (reviewResult.error ?? terminalResult.error)?.message
			);
		const reviews = reviewResult.data ?? [];
		const terminal = terminalResult.data ?? [];
		const historyIds = [
			...new Set([...reviews.map((row) => row.candidate_id), ...terminal.map((row) => row.id)])
		];
		const named = new Map<string, any>(terminal.map((row) => [row.id, row]));
		if (historyIds.length) {
			const namedResult = await admin
				.schema('ingest')
				.from('poi_candidates')
				.select(
					'id,canonical_name,region_key,route_class,process_status,process_reason,matched_brand_slug,updated_at'
				)
				.in('id', historyIds);
			if (namedResult.error)
				throw error(500, 'Failed to load review history: ' + namedResult.error.message);
			for (const row of namedResult.data ?? []) named.set(row.id, row);
		}
		const reviewRows = reviews.map((review) => {
			const candidate = named.get(review.candidate_id);
			return {
				id: review.id,
				candidate_id: review.candidate_id,
				canonical_name: candidate?.canonical_name ?? 'Unnamed POI',
				region_key: candidate?.region_key ?? null,
				route_class: candidate?.route_class ?? null,
				process_status: candidate?.process_status ?? null,
				kind: review.review_kind,
				status: review.status,
				decision: review.decision ?? review.question ?? candidate?.process_reason ?? null,
				model: review.model ?? review.reviewer_version,
				confidence: review.confidence,
				error_text: review.error_text,
				evidence: review.evidence,
				activity_at: review.completed_at ?? review.created_at
			};
		});
		const reviewCandidateIds = new Set(reviews.map((review) => review.candidate_id));
		const terminalRows = terminal
			.filter((row) => !reviewCandidateIds.has(row.id))
			.map((row) => ({
				id: 'candidate:' + row.id,
				candidate_id: row.id,
				canonical_name: row.canonical_name ?? 'Unnamed POI',
				region_key: row.region_key,
				route_class: row.route_class,
				process_status: row.process_status,
				kind: 'candidate_resolution',
				status: row.process_status === 'rejected' ? 'rejected' : 'completed',
				decision: row.process_reason,
				model: 'deterministic',
				confidence: null,
				error_text: null,
				evidence: null,
				activity_at: row.updated_at ?? row.created_at
			}));
		history = [...reviewRows, ...terminalRows].sort((a, b) =>
			String(b.activity_at).localeCompare(String(a.activity_at))
		);
		if (q) {
			const needle = q.toLowerCase();
			history = history.filter((row) =>
				[row.canonical_name, row.decision, row.kind, row.status, row.region_key]
					.filter(Boolean)
					.some((value) => String(value).toLowerCase().includes(needle))
			);
		}
		history = history.slice(0, 150);
	} else {
		let query = admin
			.schema('ingest')
			.from('poi_candidates')
			.select(CANDIDATE_COLUMNS)
			.in('process_status', [...selected.statuses])
			.order('updated_at', { ascending: false })
			.limit(75);
		if (q) query = query.ilike('canonical_name', '%' + q + '%');
		const candidateResult = await query;
		if (candidateResult.error)
			throw error(500, 'Failed to load POI queue: ' + candidateResult.error.message);
		candidates = candidateResult.data ?? [];
	}

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
					'id,provider,provider_record_id,observed_name,address_input,locality,admin1,postal_code,country_code,lat,lon,categories,source_url,last_seen_at,created_at'
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
	candidates = candidates.filter(
		(candidate) => !isCancelledLatestReview(latestReviewByCandidate[candidate.id])
	);
	const statusCounts: Record<string, number> = {};
	for (const row of statusResult.data ?? [])
		statusCounts[row.process_status] = (statusCounts[row.process_status] ?? 0) + 1;

	return {
		candidates,
		history,
		observationsByCandidate,
		latestReviewByCandidate,
		brands: brandResult.data ?? [],
		aliases: aliasResult.data ?? [],
		reviewTabs: tabs,
		statusCounts,
		historyCount: historyCountResult.count ?? history.length,
		cancelledReviewCount: cancelledCountResult.count ?? 0,
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
		const candidate = await loadCandidate(id);
		const review = await latestReview(id);
		if (blockedCreateReasons(candidate, review).length) {
			throw redirect(
				303,
				destination(form, {
					toast: 'approve_failed',
					msg: 'create_blocked_until_identity_eligibility_freshness_and_gate_pass'
				})
			);
		}
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
		await loadCandidate(id);
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
		await loadCandidate(id);
		const { error: rpcError } = await locals.supabase.rpc('reject_poi_candidate', {
			p_candidate_id: id,
			p_note: String(form.get('note') ?? '').trim() || null
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'reject_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'rejected' }));
	},
	confirmEligible: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'confirm_failed', msg: 'missing_candidate' }));
		const candidate = await loadCandidate(id);
		const rpcError = await applyTargetedResolution(
			locals,
			id,
			candidate.route_class ?? 'exception_eligibility',
			'eligibility_confirmed'
		);
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'confirm_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'eligibility_confirmed' }));
	},
	confirmCurrent: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'confirm_failed', msg: 'missing_candidate' }));
		const candidate = await loadCandidate(id);
		const rpcError = await applyTargetedResolution(
			locals,
			id,
			candidate.route_class ?? 'exception_staleness',
			'confirm_current'
		);
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'confirm_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'freshness_confirmed' }));
	},
	rejectClosed: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'reject_failed', msg: 'missing_candidate' }));
		await loadCandidate(id);
		const note = String(form.get('note') ?? '').trim() || 'admin_verified_closed';
		const { error: rpcError } = await locals.supabase.rpc('reject_poi_candidate', {
			p_candidate_id: id,
			p_note: note
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'reject_failed', msg: rpcError.message }));
		throw redirect(303, destination(form, { toast: 'rejected_closed' }));
	},
	returnToReview: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('candidate_id') ?? '').trim();
		if (!id)
			throw redirect(303, destination(form, { toast: 'return_failed', msg: 'missing_candidate' }));
		await loadCandidate(id);
		const { error: updateError } = await supabaseAdmin()
			.schema('ingest')
			.from('poi_candidates')
			.update({
				process_status: 'needs_manual_review',
				process_reason: 'admin_returned_to_review',
				updated_at: new Date().toISOString()
			})
			.eq('id', id);
		if (updateError)
			throw redirect(303, destination(form, { toast: 'return_failed', msg: updateError.message }));
		throw redirect(303, destination(form, { toast: 'returned_to_review' }));
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
