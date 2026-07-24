import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

type OsmCandidateStatus =
	| 'pending'
	| 'merged'
	| 'approved'
	| 'needs_review'
	| 'blocked'
	| 'rejected';
type LlmReviewStatus = 'pending' | 'processing' | 'reviewed' | 'failed';
type PipelineState =
	| 'applied_approved'
	| 'applied_blocked'
	| 'applied_merged'
	| 'awaiting_current_llm_review'
	| 'not_reviewed_yet'
	| 'waiting_manual_review'
	| 'waiting_region_reconciliation';
type ReviewTab = 'manual' | 'region' | 'awaiting' | 'not_reviewed' | 'history';

type CandidateRow = {
	id: string;
	name: string | null;
	normalized_name: string | null;
	lat: number | null;
	lon: number | null;
	tags: Record<string, string> | null;
	matched_brand_slug: string | null;
	match_score: number | null;
	blocked_brand: boolean;
	blocked_reason: string | null;
	staging_id: string | null;
	process_status: OsmCandidateStatus;
	llm_review_status: LlmReviewStatus | null;
	llm_review_error: string | null;
	llm_review_id: string | null;
	llm_model: string | null;
	llm_reviewer_version: string | null;
	llm_action: string | null;
	auto_decision: string | null;
	llm_confidence: number | null;
	llm_proposed_brand_slug: string | null;
	llm_proposed_display: string | null;
	llm_reason: string | null;
	llm_evidence: unknown[] | null;
	llm_sources: unknown[] | null;
	llm_evidence_flags: Record<string, unknown> | null;
	llm_risk_flags: Record<string, unknown> | null;
	llm_review_created_at: string | null;
	pipeline_state: PipelineState;
	llm_is_boba_or_tea_business: boolean | null;
	llm_appears_currently_open: boolean | null;
	llm_primary_business_type: string | null;
	region_key: string | null;
	detected_region_key: string | null;
	region_consistency_status: string | null;
	created_at: string;
};

type LlmReviewRow = {
	id: string;
	candidate_id: string;
	model: string | null;
	action: string | null;
	proposed_brand_slug: string | null;
	proposed_display: string | null;
	confidence: number | null;
	reason: string | null;
	evidence: unknown[] | null;
	sources: unknown[] | null;
	evidence_flags: Record<string, unknown> | null;
	risk_flags: Record<string, unknown> | null;
	is_boba_or_tea_business: boolean | null;
	appears_currently_open: boolean | null;
	auto_decision: string | null;
	reviewer_version: string | null;
	created_at: string;
};

type AliasRow = {
	brand_slug: string;
	normalized_name: string;
	alias_display: string | null;
	match_mode: string;
};

type BrandRow = {
	slug: string;
	display: string;
	website: string | null;
	wikidata: string | null;
};

type AliasSuggestion = {
	brand_slug: string;
	brand_display: string;
	alias: string;
	score: number;
	match_mode: string;
	website: string | null;
	wikidata: string | null;
};

type ApproveResult = {
	ok?: boolean;
	brand_slug: string;
	brand_display: string;
	op?: 'created_new' | 'merged_existing';
};

const reviewTabs: Array<{ id: ReviewTab; states: PipelineState[] }> = [
	{ id: 'manual', states: ['waiting_manual_review'] },
	{ id: 'region', states: ['waiting_region_reconciliation'] },
	{ id: 'awaiting', states: ['awaiting_current_llm_review'] },
	{ id: 'not_reviewed', states: ['not_reviewed_yet'] },
	{ id: 'history', states: ['applied_approved', 'applied_blocked', 'applied_merged'] }
];

const actionableStates: PipelineState[] = [
	'waiting_manual_review',
	'waiting_region_reconciliation'
];

function increment<T extends string>(record: Record<T, number>, key: T) {
	record[key] = (record[key] ?? 0) + 1;
}

function normalizeForMatch(value: string) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function bigrams(value: string) {
	const compact = value.replace(/\s+/g, '');
	const result = new Set<string>();
	for (let index = 0; index < compact.length - 1; index += 1) {
		result.add(compact.slice(index, index + 2));
	}
	return result;
}

function aliasSimilarity(left: string, right: string) {
	if (!left || !right) return 0;
	if (left === right) return 1;

	const leftBigrams = bigrams(left);
	const rightBigrams = bigrams(right);
	let overlap = 0;
	for (const pair of leftBigrams) if (rightBigrams.has(pair)) overlap += 1;
	const dice = leftBigrams.size + rightBigrams.size
		? (2 * overlap) / (leftBigrams.size + rightBigrams.size)
		: 0;

	const leftTokens = new Set(left.split(' '));
	const rightTokens = new Set(right.split(' '));
	const tokenOverlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
	const tokenUnion = new Set([...leftTokens, ...rightTokens]).size;
	const tokenScore = tokenUnion ? tokenOverlap / tokenUnion : 0;
	const contained =
		Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left))
			? 0.86
			: 0;

	return Math.max(contained, dice * 0.7 + tokenScore * 0.3);
}

function reviewsRedirect(form: FormData, params: Record<string, string | null | undefined>) {
	const searchParams = new URLSearchParams();
	const requestedTab = form.get('filter_tab');
	const tab = reviewTabs.some((item) => item.id === requestedTab) ? String(requestedTab) : 'manual';
	searchParams.set('tab', tab);

	const q = form.get('filter_q');
	if (typeof q === 'string' && q.trim()) searchParams.set('q', q.trim());

	for (const [key, value] of Object.entries(params)) {
		if (value) searchParams.set(key, value);
	}

	return `/admin/reviews?${searchParams.toString()}`;
}

async function requireActionableCandidate(
	locals: App.Locals,
	candidateId: string,
	form: FormData,
	toast: string
) {
	const { data, error: stateError } = await locals.supabase
		.schema('ingest')
		.from('osm_candidate_pipeline_states')
		.select('pipeline_state')
		.eq('id', candidateId)
		.maybeSingle<{ pipeline_state: PipelineState }>();

	if (stateError || !data || !actionableStates.includes(data.pipeline_state)) {
		throw redirect(
			303,
			reviewsRedirect(form, {
				toast,
				msg: stateError?.message ?? `candidate_not_actionable:${data?.pipeline_state ?? 'missing'}`
			})
		);
	}
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const requestedTab = url.searchParams.get('tab');
	const reviewTab = reviewTabs.find((item) => item.id === requestedTab)?.id ?? 'manual';
	const selectedStates = reviewTabs.find((item) => item.id === reviewTab)?.states ?? [
		'waiting_manual_review'
	];
	const q = url.searchParams.get('q')?.trim() ?? '';

	let candidateQuery = locals.supabase
		.schema('ingest')
		.from('osm_candidate_pipeline_states')
		.select(
			'id,name,normalized_name,lat,lon,tags,matched_brand_slug,match_score,blocked_brand,blocked_reason,staging_id,process_status,llm_review_status,llm_review_error,llm_review_id,llm_model,llm_reviewer_version,llm_action,auto_decision,llm_confidence,llm_proposed_brand_slug,llm_proposed_display,llm_reason,llm_evidence,llm_sources,llm_evidence_flags,llm_risk_flags,llm_review_created_at,pipeline_state,llm_is_boba_or_tea_business,llm_appears_currently_open,llm_primary_business_type,detected_region_key,region_consistency_status,region_key,created_at'
		)
		.in('pipeline_state', selectedStates)
		.order('llm_confidence', { ascending: false, nullsFirst: false })
		.order('created_at', { ascending: false })
		.limit(50);

	if (q) candidateQuery = candidateQuery.ilike('name', `%${q}%`);

	const [candidateResult, summaryResult, aliasResult, brandResult] = await Promise.all([
		candidateQuery,
		locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select('pipeline_state')
			.limit(10000),
		locals.supabase
			.from('brand_aliases')
			.select('brand_slug,normalized_name,alias_display,match_mode')
			.limit(5000),
		locals.supabase.from('brands').select('slug,display,website,wikidata').limit(5000)
	]);

	if (candidateResult.error) {
		console.error(candidateResult.error);
		throw error(500, `Failed to load review candidates: ${candidateResult.error.message}`);
	}
	if (summaryResult.error) {
		console.error(summaryResult.error);
		throw error(500, `Failed to load review counts: ${summaryResult.error.message}`);
	}
	if (aliasResult.error || brandResult.error) {
		const sourceError = aliasResult.error ?? brandResult.error;
		console.error(sourceError);
		throw error(500, `Failed to load brand aliases: ${sourceError?.message}`);
	}

	const candidates = (candidateResult.data ?? []) as CandidateRow[];
	const pipelineStateCounts = {} as Record<PipelineState, number>;
	for (const row of (summaryResult.data ?? []) as Array<{ pipeline_state: PipelineState }>) {
		increment(pipelineStateCounts, row.pipeline_state);
	}

	const latestReviewByCandidate: Record<string, LlmReviewRow> = {};
	for (const candidate of candidates) {
		if (!candidate.llm_review_id) continue;
		latestReviewByCandidate[candidate.id] = {
			id: candidate.llm_review_id,
			candidate_id: candidate.id,
			model: candidate.llm_model,
			action: candidate.llm_action,
			proposed_brand_slug: candidate.llm_proposed_brand_slug,
			proposed_display: candidate.llm_proposed_display,
			confidence: candidate.llm_confidence,
			reason: candidate.llm_reason,
			evidence: candidate.llm_evidence,
			sources: candidate.llm_sources,
			evidence_flags: candidate.llm_evidence_flags,
			risk_flags: candidate.llm_risk_flags,
			is_boba_or_tea_business: candidate.llm_is_boba_or_tea_business,
			appears_currently_open: candidate.llm_appears_currently_open,
			auto_decision: candidate.auto_decision,
			reviewer_version: candidate.llm_reviewer_version,
			created_at: candidate.llm_review_created_at ?? candidate.created_at
		};
	}

	const brandsBySlug = new Map(
		((brandResult.data ?? []) as BrandRow[]).map((brand) => [brand.slug, brand])
	);
	const aliasRows = (aliasResult.data ?? []) as AliasRow[];
	const similarAliasesByCandidate: Record<string, AliasSuggestion[]> = {};
	for (const candidate of candidates) {
		const candidateName = normalizeForMatch(candidate.normalized_name ?? candidate.name ?? '');
		const bestByBrand = new Map<string, AliasSuggestion>();
		for (const alias of aliasRows) {
			const score = aliasSimilarity(candidateName, normalizeForMatch(alias.normalized_name));
			if (score < 0.38) continue;
			const brand = brandsBySlug.get(alias.brand_slug);
			const suggestion: AliasSuggestion = {
				brand_slug: alias.brand_slug,
				brand_display: brand?.display ?? alias.brand_slug,
				alias: alias.alias_display ?? alias.normalized_name,
				score,
				match_mode: alias.match_mode,
				website: brand?.website ?? null,
				wikidata: brand?.wikidata ?? null
			};
			const current = bestByBrand.get(alias.brand_slug);
			if (!current || suggestion.score > current.score) {
				bestByBrand.set(alias.brand_slug, suggestion);
			}
		}
		similarAliasesByCandidate[candidate.id] = [...bestByBrand.values()]
			.sort((left, right) => right.score - left.score)
			.slice(0, 3);
	}

	return {
		candidates,
		reviewTabs,
		pipelineStateCounts,
		latestReviewByCandidate,
		similarAliasesByCandidate,
		reviewTab,
		q
	};
};

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const candidateId = form.get('candidate_id') as string | null;
		const forceDisplay = (form.get('force_display') as string | null) || null;
		const note = (form.get('note') as string | null) || null;

		if (!candidateId) {
			throw redirect(303, reviewsRedirect(form, { toast: 'approve_failed', msg: 'missing_candidate_id' }));
		}
		await requireActionableCandidate(locals, candidateId, form, 'approve_failed');

		const { data, error: rpcError } = await locals.supabase
			.rpc('approve_osm_candidate', {
				p_candidate_id: candidateId,
				p_force_display: forceDisplay,
				p_note: note
			})
			.returns<ApproveResult>();

		if (rpcError) {
			throw redirect(303, reviewsRedirect(form, { toast: 'approve_failed', msg: rpcError.message }));
		}

		const result = data as ApproveResult | ApproveResult[] | null;
		const row = Array.isArray(result) ? result[0] : result;
		if (!row) throw redirect(303, reviewsRedirect(form, { toast: 'approve_failed', msg: 'no_result' }));

		throw redirect(303, reviewsRedirect(form, { toast: row.op ?? 'created_new', brand: row.brand_slug }));
	},

	merge: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const candidateId = String(form.get('candidate_id') ?? '');
		const brandSlug = String(form.get('brand_slug') ?? '');
		const note = (form.get('note') as string | null) ?? null;

		if (!candidateId || !brandSlug) {
			throw redirect(303, reviewsRedirect(form, { toast: 'merge_failed', msg: 'missing_params' }));
		}
		await requireActionableCandidate(locals, candidateId, form, 'merge_failed');

		const { error: rpcError } = await locals.supabase.rpc('admin_merge_candidate_to_brand', {
			p_candidate_id: candidateId,
			p_brand_slug: brandSlug,
			p_note: note
		});

		if (rpcError) {
			throw redirect(303, reviewsRedirect(form, { toast: 'merge_failed', msg: rpcError.message }));
		}

		throw redirect(303, reviewsRedirect(form, { toast: 'merged' }));
	},

	reject: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const candidateId = form.get('candidate_id') as string | null;
		const note = (form.get('note') as string | null) || null;

		if (!candidateId) {
			throw redirect(303, reviewsRedirect(form, { toast: 'reject_failed', msg: 'missing_candidate_id' }));
		}
		await requireActionableCandidate(locals, candidateId, form, 'reject_failed');

		const { error: rpcError } = await locals.supabase.rpc('reject_osm_candidate', {
			p_candidate_id: candidateId,
			p_note: note
		});

		if (rpcError) {
			throw redirect(303, reviewsRedirect(form, { toast: 'reject_failed', msg: rpcError.message }));
		}

		throw redirect(303, reviewsRedirect(form, { toast: 'rejected' }));
	}
};
