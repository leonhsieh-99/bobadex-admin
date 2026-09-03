/* eslint-disable @typescript-eslint/no-explicit-any */
import { error, redirect } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import { blockedCreateReasons, isCancelledLatestReview } from '$lib/poi-review-actions';
import {
	dossierMatchesQuery,
	isStorefrontResolution,
	type StorefrontDossier
} from '$lib/poi-storefront-dossiers';
import { formatPostalAddress } from '$lib/maps';
import { loadStorefrontReviewDossiers } from '$lib/server/poi-storefront.server';
import { countByValues } from '$lib/server/status-counts.server';
import type { Actions, PageServerLoad } from './$types';

const STOREFRONT_PAGE_SIZE = 25;
const tabs = [
	{
		id: 'manual',
		label: 'Storefronts',
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
const HISTORY_CANDIDATE_COLUMNS =
	'id,canonical_name,region_key,route_class,process_status,process_reason,matched_brand_slug,address_input,lat,lon,updated_at,created_at';

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

function displayAddressForCandidate(
	candidate: { address_input?: string | null } | undefined,
	places: Array<{
		address_input?: string | null;
		locality?: string | null;
		admin1?: string | null;
		postal_code?: string | null;
	}>
) {
	const place = places.find(
		(observation) => observation.locality || observation.admin1 || observation.postal_code
	);
	return formatPostalAddress({
		street: candidate?.address_input ?? place?.address_input ?? places[0]?.address_input,
		locality: place?.locality,
		admin1: place?.admin1,
		postalCode: place?.postal_code
	});
}

async function observationPlacesByCandidate(admin: ReturnType<typeof supabaseAdmin>, ids: string[]) {
	const byCandidate: Record<
		string,
		Array<{
			address_input?: string | null;
			locality?: string | null;
			admin1?: string | null;
			postal_code?: string | null;
		}>
	> = {};
	if (!ids.length) return byCandidate;
	const { data: links, error: linkError } = await admin
		.schema('ingest')
		.from('poi_candidate_observations')
		.select('candidate_id,observation_id')
		.in('candidate_id', ids)
		.is('unlinked_at', null);
	if (linkError) throw error(500, 'Failed to load review history: ' + linkError.message);
	const observationIds = [...new Set((links ?? []).map((link) => link.observation_id).filter(Boolean))];
	if (!observationIds.length) return byCandidate;
	const { data: places, error: placeError } = await admin
		.schema('ingest')
		.from('poi_observations')
		.select('id,address_input,locality,admin1,postal_code')
		.in('id', observationIds);
	if (placeError) throw error(500, 'Failed to load review history: ' + placeError.message);
	const placeById = new Map((places ?? []).map((place) => [place.id, place]));
	for (const link of links ?? []) {
		const place = placeById.get(link.observation_id);
		if (!place) continue;
		(byCandidate[link.candidate_id] ??= []).push(place);
	}
	return byCandidate;
}

export const load: PageServerLoad = async ({ url, depends, locals }) => {
	depends('app:reviews');
	const admin = supabaseAdmin();
	const selected = tabs.find((tab) => tab.id === url.searchParams.get('tab')) ?? tabs[0];
	const q = url.searchParams.get('q')?.trim() ?? '';
	const historyMode = selected.id === 'history';
	const storefrontMode = selected.id === 'manual';
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
	const offset = (page - 1) * STOREFRONT_PAGE_SIZE;
	const tabStatuses = [
		'needs_exception_resolution',
		'needs_manual_review',
		'ready_for_enrichment',
		'pending'
	] as const;

	const [statusCountResult, historyCountResult, cancelledCountResult] = await Promise.all([
		countByValues(admin, 'poi_candidates', 'process_status', tabStatuses, 'ingest'),
		admin
			.schema('ingest')
			.from('poi_candidate_reviews')
			.select('*', { count: 'exact', head: true })
			.in('status', ['completed', 'cancelled']),
		admin
			.schema('ingest')
			.from('poi_candidate_reviews')
			.select('*', { count: 'exact', head: true })
			.eq('status', 'cancelled')
	]);
	if (statusCountResult.error)
		throw error(500, 'Failed to load POI queue: ' + statusCountResult.error.message);

	let candidates: any[] = [];
	let history: any[] = [];
	let dossiers: StorefrontDossier[] = [];
	let dossierCount = 0;
	let dossierHasMore = false;
	if (storefrontMode) {
		const loaded = await loadStorefrontReviewDossiers(
			locals.supabase,
			q ? 100 : STOREFRONT_PAGE_SIZE + 1,
			q ? 0 : offset
		);
		if (loaded.error) throw error(500, 'Failed to load storefront dossiers: ' + loaded.error);
		dossiers = loaded.dossiers;
		if (q) {
			dossiers = dossiers.filter((dossier) => dossierMatchesQuery(dossier, q));
			dossierCount = dossiers.length;
		} else {
			dossierHasMore = dossiers.length > STOREFRONT_PAGE_SIZE;
			dossiers = dossiers.slice(0, STOREFRONT_PAGE_SIZE);
			dossierCount = offset + dossiers.length + (dossierHasMore ? 1 : 0);
		}
	} else if (historyMode) {
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
				.select(HISTORY_CANDIDATE_COLUMNS)
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
				.select(HISTORY_CANDIDATE_COLUMNS)
				.in('id', historyIds);
			if (namedResult.error)
				throw error(500, 'Failed to load review history: ' + namedResult.error.message);
			for (const row of namedResult.data ?? []) named.set(row.id, row);
		}
		const placesByCandidate = await observationPlacesByCandidate(admin, historyIds);
		const reviewRows = reviews.map((review) => {
			const candidate = named.get(review.candidate_id);
			return {
				id: review.id,
				candidate_id: review.candidate_id,
				canonical_name: candidate?.canonical_name ?? 'Unnamed POI',
				display_address: displayAddressForCandidate(
					candidate,
					placesByCandidate[review.candidate_id] ?? []
				),
				region_key: candidate?.region_key ?? null,
				route_class: candidate?.route_class ?? null,
				process_status: candidate?.process_status ?? null,
				matched_brand_slug: candidate?.matched_brand_slug ?? null,
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
				display_address: displayAddressForCandidate(row, placesByCandidate[row.id] ?? []),
				region_key: row.region_key,
				route_class: row.route_class,
				process_status: row.process_status,
				matched_brand_slug: row.matched_brand_slug ?? null,
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
				[
					row.canonical_name,
					row.display_address,
					row.decision,
					row.kind,
					row.status,
					row.region_key,
					row.matched_brand_slug
				]
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

	const brandSlugs = new Set<string>();
	for (const candidate of candidates) {
		if (candidate.matched_brand_slug) brandSlugs.add(candidate.matched_brand_slug);
	}
	for (const review of reviews) {
		if (review.proposed_brand_slug) brandSlugs.add(review.proposed_brand_slug);
	}
	const needles = [
		...new Set(
			candidates.flatMap((candidate) => {
				const name = String(candidate.normalized_name ?? candidate.canonical_name ?? '')
					.toLowerCase()
					.replace(/[%_,()]/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
				return name.length >= 3 ? [name.slice(0, 80)] : [];
			})
		)
	].slice(0, 12);
	let aliases: Array<{
		brand_slug: string;
		alias_display: string | null;
		normalized_name: string;
	}> = [];
	if (needles.length) {
		const aliasResult = await admin
			.from('brand_aliases')
			.select('brand_slug,alias_display,normalized_name')
			.or(
				needles
					.flatMap((needle) => [
						`normalized_name.ilike.%${needle}%`,
						`alias_display.ilike.%${needle}%`
					])
					.join(',')
			)
			.limit(80);
		if (aliasResult.error)
			throw error(500, 'Failed to load POI queue: ' + aliasResult.error.message);
		aliases = aliasResult.data ?? [];
		for (const alias of aliases) brandSlugs.add(alias.brand_slug);
	}
	let brands: Array<{ slug: string; display: string }> = [];
	if (brandSlugs.size) {
		const brandResult = await admin
			.from('brands')
			.select('slug,display')
			.in('slug', [...brandSlugs])
			.eq('status', 'active');
		if (brandResult.error)
			throw error(500, 'Failed to load POI queue: ' + brandResult.error.message);
		brands = brandResult.data ?? [];
	}

	return {
		candidates,
		dossiers,
		dossierCount,
		dossierPage: page,
		dossierHasMore,
		history,
		observationsByCandidate,
		latestReviewByCandidate,
		brands,
		aliases,
		reviewTabs: tabs,
		statusCounts: statusCountResult.counts,
		historyCount: historyCountResult.count ?? history.length,
		cancelledReviewCount: cancelledCountResult.count ?? 0,
		reviewTab: selected.id,
		q
	};
};

export const actions: Actions = {
	resolveDossier: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const id = String(form.get('dossier_id') ?? '').trim();
		const resolution = String(form.get('resolution') ?? '').trim();
		const identityKey = String(form.get('selected_identity_key') ?? '').trim();
		if (!id || !isStorefrontResolution(resolution)) {
			throw redirect(303, destination(form, { toast: 'resolve_failed', msg: 'missing_params' }));
		}
		if (resolution === 'select_identity' && !identityKey) {
			throw redirect(
				303,
				destination(form, { toast: 'resolve_failed', msg: 'select_an_identity_tile' })
			);
		}
		const { error: rpcError } = await locals.supabase.rpc('admin_resolve_poi_storefront_dossier', {
			p_dossier_id: id,
			p_resolution: resolution,
			p_selected_identity_key: identityKey || null,
			p_note: String(form.get('note') ?? '').trim() || null
		});
		if (rpcError)
			throw redirect(303, destination(form, { toast: 'resolve_failed', msg: rpcError.message }));
		const toast =
			resolution === 'select_identity'
				? 'storefront_current'
				: resolution === 'closed_or_vacant'
					? 'storefront_closed'
					: 'storefront_unresolved';
		throw redirect(303, destination(form, { toast }));
	},
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
