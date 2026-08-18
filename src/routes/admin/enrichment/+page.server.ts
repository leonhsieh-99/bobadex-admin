import { fail } from '@sveltejs/kit';
import { mergeBrands } from '$lib/server/brand-merge.server';
import { isBrandMatchPolicy } from '$lib/brand-match-policy';
import { supabaseAdmin } from '$lib/supabase.server';
import type { Actions, PageServerLoad } from './$types';

type JsonRecord = Record<string, unknown>;

type ResearchAnchor = {
	id?: string;
	type: 'url' | 'market' | 'social' | 'location_observation';
	role: 'include' | 'exclude' | 'prefer';
	value: string;
	reference_id?: string | null;
	curator_verified: boolean;
	notes?: string | null;
};

type ResearchScope = {
	identity_basis: 'official' | 'multi_location_cluster' | 'local' | 'ambiguous' | null;
	identity_scope_verified: boolean;
	research_directive: string | null;
	anchors: ResearchAnchor[];
};

type DossierRow = {
	brand_slug: string;
	research_run_id: string | null;
	approval_status: string;
	customer_summary: string | null;
	public_summary_draft: string | null;
	research_topics: JsonRecord | null;
	creative_brief: JsonRecord | string | null;
	profile_facts: JsonRecord;
	last_researched_at: string | null;
	refresh_after: string | null;
	updated_at: string;
	quality_metrics: JsonRecord | null;
	review_reasons: string[] | null;
	approval_method: string | null;
	recommended_match_policy: string;
	match_policy_route: string | null;
	match_policy_evidence: JsonRecord;
};

type ResearchRunRow = {
	id: string;
	job_id: string | null;
	brand_slug: string;
	status: string;
	provider: string | null;
	model: string | null;
	researcher_version: string | null;
	input_snapshot: JsonRecord | null;
	raw_response: JsonRecord | null;
	customer_summary_draft: string | null;
	public_summary_draft: string | null;
	research_topics: JsonRecord | null;
	creative_brief_draft: JsonRecord | string | null;
	overall_confidence: number | null;
	started_at: string | null;
	completed_at: string | null;
	error_text: string | null;
	quality_metrics: JsonRecord | null;
};

type ClaimRow = {
	id: string;
	run_id: string;
	brand_slug: string;
	claim_key: string;
	claim_value: unknown;
	confidence: number | null;
	evidence_assessment: string | null;
	review_status: string | null;
	materiality: string | null;
	rationale: string | null;
};

type ClaimSourceRow = {
	run_id: string;
	claim_id: string;
	source_id: string;
	citation_role: string | null;
	evidence_excerpt: string | null;
};

type SourceRow = {
	id: string;
	run_id: string;
	source_type: string | null;
	url: string;
	title: string | null;
	publisher: string | null;
	published_at: string | null;
	excerpt: string | null;
	credibility: string | number | null;
};

type IntegrityFlagRow = {
	id: string;
	brand_slug: string;
	severity: string;
	status: string;
	title: string;
	details: unknown;
	recommended_action: string | null;
	last_seen_at: string;
};

type ProfileRow = {
	brand_slug: string;
	summary: string | null;
	public_summary: string | null;
	public_summary_source_run_id: string | null;
	public_summary_model: string | null;
	public_summary_generated_at: string | null;
	summary_confidence: number | null;
	publication_method: string | null;
	published_at: string | null;
	updated_at: string;
};

type BrandIdentityRow = {
	slug: string;
	display: string;
	website: string | null;
	wikidata: string | null;
	status: 'active' | 'retired' | 'merged';
	is_demo: boolean;
	match_policy: string;
	enrichment_mode: 'auto' | 'manual_only' | 'disabled';
	enrichment_location_anchor: string | null;
};

type BrandAliasRow = {
	id: number;
	brand_slug: string;
	normalized_name: string;
	alias_display: string | null;
	match_mode: string;
};

type PhysicalLocationRow = {
	id: string;
	lat: number;
	lon: number;
	physical_status: string;
	city: string | null;
	county: string | null;
	region: string | null;
	evidence: Array<{
		source: string;
		source_key: string;
		osm_type: string | null;
		osm_id: number | null;
		verification_status: string | null;
	}>;
};

type EnrichmentFootprintRow = {
	brand_slug: string;
	place_id: string;
	location_count: number;
	level: string;
	code: string;
	name: string;
};

type EnrichmentJobRow = {
	id: string;
	brand_slug: string;
	trigger_kind: string;
	status: string;
	attempt_count: number;
	max_attempts: number;
	available_at: string;
	claimed_at: string | null;
	lease_expires_at: string | null;
	last_error: string | null;
	trigger_context: JsonRecord;
	created_at: string;
	completed_at: string | null;
};

type CronJobRow = {
	jobid: number;
	jobname: string | null;
	schedule: string;
	active: boolean;
};

type CronRunRow = {
	jobid: number;
	status: string;
	start_time: string;
	end_time: string | null;
	return_message: string | null;
};

type CronStatusPayload = {
	server_time?: string;
	configured?: boolean;
	jobs?: CronJobRow[];
	runs?: CronRunRow[];
};

function countByStatus(rows: EnrichmentJobRow[]) {
	const counts: Record<string, number> = {};
	for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
	return counts;
}

function readMetric(metrics: JsonRecord | null, key: string) {
	const value = metrics?.[key];
	return typeof value === 'number' ? value : null;
}

function recordArray(value: unknown) {
	return Array.isArray(value)
		? value.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === 'object' && !Array.isArray(item)
			)
		: [];
}

function stringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function parseResearchScope(value: string): ResearchScope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('Research scope could not be read.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Research scope must be an object.');
	}
	const scope = parsed as JsonRecord;
	const identityBasis = scope.identity_basis;
	if (
		identityBasis !== null &&
		identityBasis !== '' &&
		!['official', 'multi_location_cluster', 'local', 'ambiguous'].includes(String(identityBasis))
	) {
		throw new Error('Choose a valid identity basis.');
	}
	const directive =
		typeof scope.research_directive === 'string' ? scope.research_directive.trim() : '';
	if (directive.length > 2000)
		throw new Error('Research directive must be 2,000 characters or fewer.');
	if (!Array.isArray(scope.anchors) || scope.anchors.length > 40) {
		throw new Error('Research scope can contain at most 40 anchors.');
	}
	const anchors = scope.anchors.map((raw, index): ResearchAnchor => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error(`Anchor ${index + 1} is invalid.`);
		}
		const anchor = raw as JsonRecord;
		const type = String(anchor.type ?? '');
		const role = String(anchor.role ?? '');
		const anchorValue = String(anchor.value ?? '').trim();
		const referenceId = String(anchor.reference_id ?? '').trim();
		const notes = String(anchor.notes ?? '').trim();
		if (!['url', 'market', 'social', 'location_observation'].includes(type)) {
			throw new Error(`Anchor ${index + 1} has an invalid type.`);
		}
		if (!['include', 'exclude', 'prefer'].includes(role)) {
			throw new Error(`Anchor ${index + 1} has an invalid role.`);
		}
		if (!anchorValue || anchorValue.length > 2048) {
			throw new Error(`Anchor ${index + 1} needs a value of 2,048 characters or fewer.`);
		}
		if (['url', 'social'].includes(type)) {
			try {
				const url = new URL(anchorValue);
				if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
			} catch {
				throw new Error(`Anchor ${index + 1} requires a valid HTTP or HTTPS URL.`);
			}
		}
		if (referenceId.length > 200 || notes.length > 500) {
			throw new Error(`Anchor ${index + 1} reference or notes are too long.`);
		}
		return {
			type: type as ResearchAnchor['type'],
			role: role as ResearchAnchor['role'],
			value: anchorValue,
			reference_id: referenceId || null,
			curator_verified: anchor.curator_verified === true,
			notes: notes || null
		};
	});
	return {
		identity_basis: identityBasis
			? (String(identityBasis) as ResearchScope['identity_basis'])
			: null,
		identity_scope_verified: scope.identity_scope_verified === true,
		research_directive: directive || null,
		anchors
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const [
		jobsResult,
		dossiersResult,
		profilesResult,
		flagsResult,
		cronStatusResult,
		recentRunsResult
	] = await Promise.all([
		locals.supabase
			.schema('ingest')
			.from('brand_enrichment_jobs')
			.select(
				'id,brand_slug,trigger_kind,status,attempt_count,max_attempts,available_at,claimed_at,lease_expires_at,last_error,trigger_context,created_at,completed_at'
			)
			.order('created_at', { ascending: false })
			.limit(250),
		locals.supabase
			.schema('mod')
			.from('brand_dossiers')
			.select(
				'brand_slug,research_run_id,approval_status,customer_summary,public_summary_draft,research_topics,creative_brief,profile_facts,last_researched_at,refresh_after,updated_at,quality_metrics,review_reasons,approval_method,recommended_match_policy,match_policy_route,match_policy_evidence'
			)
			.order('updated_at', { ascending: false }),
		locals.supabase
			.from('brand_profiles')
			.select(
				'brand_slug,summary,public_summary,public_summary_source_run_id,public_summary_model,public_summary_generated_at,summary_confidence,publication_method,published_at,updated_at'
			),
		locals.supabase
			.schema('mod')
			.from('brand_integrity_flags')
			.select('id,brand_slug,severity,status,title,details,recommended_action,last_seen_at')
			.order('last_seen_at', { ascending: false }),
		locals.supabase.rpc('admin_brand_enrichment_cron_status'),
		locals.supabase
			.schema('ingest')
			.from('brand_research_runs')
			.select(
				'id,job_id,brand_slug,status,provider,model,researcher_version,input_snapshot,raw_response,customer_summary_draft,public_summary_draft,research_topics,creative_brief_draft,overall_confidence,started_at,completed_at,error_text,quality_metrics'
			)
			.order('created_at', { ascending: false })
			.limit(125)
	]);

	const sourceResults = [
		['Enrichment jobs', jobsResult],
		['Dossiers', dossiersResult],
		['Profiles', profilesResult],
		['Integrity flags', flagsResult],
		['Research runs', recentRunsResult]
	] as const;
	const sourceErrors: string[] = sourceResults
		.filter(([, result]) => result.error)
		.map(([label]) => label);
	for (const [label, result] of sourceResults) {
		if (result.error) console.error(`[enrichment] ${label}`, result.error);
	}

	const jobs = (jobsResult.data ?? []) as EnrichmentJobRow[];
	const dossiers = (dossiersResult.data ?? []) as DossierRow[];
	const profiles = (profilesResult.data ?? []) as ProfileRow[];
	const flags = (flagsResult.data ?? []) as IntegrityFlagRow[];
	const recentRuns = (recentRunsResult.data ?? []) as ResearchRunRow[];
	const cronPayload =
		cronStatusResult.data &&
		typeof cronStatusResult.data === 'object' &&
		!Array.isArray(cronStatusResult.data)
			? (cronStatusResult.data as CronStatusPayload)
			: null;
	const enrichmentCronJobs = cronPayload?.jobs ?? [];
	const enrichmentCronRuns = cronPayload?.runs ?? [];
	const reviewDossiers = dossiers.filter((row) => row.approval_status === 'needs_review');
	const reviewRunIds = [
		...new Set(reviewDossiers.flatMap((row) => (row.research_run_id ? [row.research_run_id] : [])))
	];
	const reviewBrandSlugs = reviewDossiers.map((row) => row.brand_slug);

	let reviewRuns: ResearchRunRow[] = [];
	let claims: ClaimRow[] = [];
	let claimSources: ClaimSourceRow[] = [];
	let sources: SourceRow[] = [];
	let brandIdentities: BrandIdentityRow[] = [];
	let brandAliases: BrandAliasRow[] = [];
	let physicalLocationsByBrand: Record<string, PhysicalLocationRow[]> = {};
	let enrichmentFootprints: EnrichmentFootprintRow[] = [];

	if (reviewBrandSlugs.length) {
		const [identitiesResult, aliasesResult, physicalLocationsResult, footprintResult] =
			await Promise.all([
				locals.supabase
					.from('brands')
					.select(
						'slug,display,website,wikidata,status,is_demo,match_policy,enrichment_mode,enrichment_location_anchor'
					)
					.in('slug', reviewBrandSlugs),
				locals.supabase
					.from('brand_aliases')
					.select('id,brand_slug,normalized_name,alias_display,match_mode')
					.in('brand_slug', reviewBrandSlugs)
					.order('normalized_name'),
				locals.supabase.rpc('admin_get_brand_physical_locations_batch', {
					p_brand_slugs: reviewBrandSlugs
				}),
				locals.supabase
					.from('brand_footprint')
					.select('brand_slug,place_id,location_count,geo_places(level,code,name)')
					.eq('source', 'enrichment_markets')
					.in('brand_slug', reviewBrandSlugs)
			]);
		if (identitiesResult.error) {
			console.error('[enrichment] Brand identities', identitiesResult.error);
			sourceErrors.push('Brand identities');
		}
		if (aliasesResult.error) {
			console.error('[enrichment] Brand aliases', aliasesResult.error);
			sourceErrors.push('Brand aliases');
		}
		if (physicalLocationsResult.error) {
			console.error('[enrichment] Physical locations', physicalLocationsResult.error);
			sourceErrors.push('Physical locations');
		}
		if (footprintResult.error) {
			console.error('[enrichment] Enrichment footprints', footprintResult.error);
			sourceErrors.push('Enrichment footprints');
		}
		brandIdentities = (identitiesResult.data ?? []) as BrandIdentityRow[];
		brandAliases = (aliasesResult.data ?? []) as BrandAliasRow[];
		physicalLocationsByBrand = (physicalLocationsResult.data ?? {}) as Record<
			string,
			PhysicalLocationRow[]
		>;
		enrichmentFootprints = (
			(footprintResult.data ?? []) as Array<{
				brand_slug: string;
				place_id: string;
				location_count: number;
				geo_places:
					| { level: string; code: string; name: string }
					| { level: string; code: string; name: string }[]
					| null;
			}>
		)
			.map((row) => {
				const place = Array.isArray(row.geo_places) ? row.geo_places[0] : row.geo_places;
				if (!place) return null;
				return {
					brand_slug: row.brand_slug,
					place_id: row.place_id,
					location_count: row.location_count,
					level: String(place.level),
					code: place.code,
					name: place.name
				} satisfies EnrichmentFootprintRow;
			})
			.filter((row): row is EnrichmentFootprintRow => Boolean(row));
	}

	// Scope claims/sources to review runs only. Including recentRuns here previously
	// hit PostgREST's ~1000-row cap and silently dropped claims for many dossiers.
	if (reviewRunIds.length) {
		const [runsResult, claimsResult, claimSourcesResult, sourcesResult] = await Promise.all([
			locals.supabase
				.schema('ingest')
				.from('brand_research_runs')
				.select(
					'id,job_id,brand_slug,status,provider,model,researcher_version,input_snapshot,raw_response,customer_summary_draft,public_summary_draft,research_topics,creative_brief_draft,overall_confidence,started_at,completed_at,error_text,quality_metrics'
				)
				.in('id', reviewRunIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_claims')
				.select(
					'id,run_id,brand_slug,claim_key,claim_value,confidence,evidence_assessment,review_status,materiality,rationale'
				)
				.in('run_id', reviewRunIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_claim_sources')
				.select('run_id,claim_id,source_id,citation_role,evidence_excerpt')
				.in('run_id', reviewRunIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_sources')
				.select('id,run_id,source_type,url,title,publisher,published_at,excerpt,credibility')
				.in('run_id', reviewRunIds)
		]);

		const detailResults = [
			['Research runs', runsResult],
			['Claims', claimsResult],
			['Claim citations', claimSourcesResult],
			['Sources', sourcesResult]
		] as const;
		for (const [label, result] of detailResults) {
			if (result.error) {
				console.error(`[enrichment] ${label}`, result.error);
				sourceErrors.push(label);
			}
		}
		reviewRuns = (runsResult.data ?? []) as ResearchRunRow[];
		claims = (claimsResult.data ?? []) as ClaimRow[];
		claimSources = (claimSourcesResult.data ?? []) as ClaimSourceRow[];
		sources = (sourcesResult.data ?? []) as SourceRow[];
	}

	const runById = new Map<string, ResearchRunRow>();
	for (const run of recentRuns) runById.set(run.id, run);
	for (const run of reviewRuns) runById.set(run.id, run);
	const runs = [...runById.values()];

	const sourceById = new Map(sources.map((row) => [row.id, row]));
	const profileByBrand = new Map(profiles.map((row) => [row.brand_slug, row]));
	const dossierByBrand = new Map(dossiers.map((row) => [row.brand_slug, row]));
	const dossierByRunId = new Map(
		dossiers.flatMap((row) => (row.research_run_id ? [[row.research_run_id, row] as const] : []))
	);
	const identityByBrand = new Map(brandIdentities.map((row) => [row.slug, row]));
	const openFlags = flags.filter((row) => row.status !== 'resolved' && row.status !== 'closed');
	const jobStatusCounts = countByStatus(jobs);
	const runByJobId = new Map<string, ResearchRunRow>();
	for (const run of runs) {
		if (run.job_id && !runByJobId.has(run.job_id)) runByJobId.set(run.job_id, run);
	}
	const monitoredJobs = jobs.map((job) => {
		const run = runByJobId.get(job.id) ?? null;
		const runDossier = run ? (dossierByRunId.get(run.id) ?? null) : null;
		const reviewReasons = runDossier?.review_reasons ?? [];
		const rawResponse = run?.raw_response ?? null;
		const retrievedSources = recordArray(rawResponse?.search_results).map((source) => ({
			url: typeof source.url === 'string' ? source.url : null,
			title: typeof source.title === 'string' ? source.title : null
		}));
		const retainedSources = run ? sources.filter((source) => source.run_id === run.id) : [];
		const identityConfidence = readMetric(run?.quality_metrics ?? null, 'identity_confidence');
		const hasAdequateInput = run?.quality_metrics?.has_adequate_input === true;
		const hasBlockingFlag = run?.quality_metrics?.has_blocking_flag === true;
		const gateStatus = !run
			? 'pending'
			: run.status === 'failed'
				? 'failed'
				: reviewReasons.length > 0 ||
					  !hasAdequateInput ||
					  hasBlockingFlag ||
					  (identityConfidence ?? 0) < 0.85
					? 'review'
					: 'passed';
		return {
			...job,
			paused: job.trigger_context?.controlled_paused === true,
			controlled: job.trigger_context?.manual_request === true,
			autoPublishRequested: job.trigger_context?.auto_publish_requested === true,
			run: run
				? {
						id: run.id,
						status: run.status,
						researcherVersion: run.researcher_version,
						startedAt: run.started_at,
						completedAt: run.completed_at,
						error: run.error_text,
						executedQueries: stringArray(rawResponse?.executed_queries),
						retrievedSources,
						retainedSources,
						qualityMetrics: run.quality_metrics ?? {},
						reviewReasons,
						autoPublishEligible: runDossier ? reviewReasons.length === 0 : null,
						approvalStatus: runDossier?.approval_status ?? null,
						gate: {
							status: gateStatus,
							version:
								typeof run.quality_metrics?.gate_version === 'string'
									? run.quality_metrics.gate_version
									: null,
							identityConfidence,
							hasAdequateInput,
							hasBlockingFlag,
							locationAnchor:
								typeof job.trigger_context?.location_anchor === 'string'
									? job.trigger_context.location_anchor
									: null
						}
					}
				: null
		};
	});
	const activeJobs = monitoredJobs.filter(
		(row) => row.status === 'queued' || row.status === 'running'
	);
	const latestActiveJobByBrand = new Map<string, (typeof monitoredJobs)[number]>();
	for (const job of activeJobs) {
		if (!latestActiveJobByBrand.has(job.brand_slug)) {
			latestActiveJobByBrand.set(job.brand_slug, job);
		}
	}
	const activeReviewDossiers = reviewDossiers.filter((dossier) => {
		const identity = identityByBrand.get(dossier.brand_slug);
		return identity && identity.status !== 'merged';
	});
	const enrichedDossiers = activeReviewDossiers
		.map((dossier) => {
			const run = dossier.research_run_id ? (runById.get(dossier.research_run_id) ?? null) : null;
			const dossierClaims = claims
				.filter((claim) => claim.run_id === dossier.research_run_id)
				.map((claim) => ({
					...claim,
					citations: claimSources
						.filter((link) => link.claim_id === claim.id)
						.map((link) => ({ ...link, source: sourceById.get(link.source_id) ?? null }))
				}));
			return {
				...dossier,
				identity: {
					...(identityByBrand.get(dossier.brand_slug) ?? {
						slug: dossier.brand_slug,
						display: dossier.brand_slug,
						website: null,
						wikidata: null
					}),
					aliases: brandAliases.filter((alias) => alias.brand_slug === dossier.brand_slug)
				},
				run,
				claims: dossierClaims,
				integrityFlags: openFlags.filter((flag) => flag.brand_slug === dossier.brand_slug),
				profile: profileByBrand.get(dossier.brand_slug) ?? null,
				activeJob: latestActiveJobByBrand.get(dossier.brand_slug) ?? null,
				physicalLocations: physicalLocationsByBrand[dossier.brand_slug] ?? [],
				enrichmentFootprint: enrichmentFootprints.filter(
					(place) => place.brand_slug === dossier.brand_slug
				),
				metrics: {
					overallConfidence:
						readMetric(dossier.quality_metrics, 'overall_confidence') ??
						run?.overall_confidence ??
						null,
					identityConfidence: readMetric(dossier.quality_metrics, 'identity_confidence'),
					citationCoverage: readMetric(dossier.quality_metrics, 'citation_coverage'),
					credibleSources: readMetric(dossier.quality_metrics, 'credible_source_count'),
					independentSources: readMetric(dossier.quality_metrics, 'independent_linked_source_count')
				}
			};
		})
		.sort((a, b) => {
			const aCoco = a.brand_slug.startsWith('cocofreshteaandjuice') ? 1 : 0;
			const bCoco = b.brand_slug.startsWith('cocofreshteaandjuice') ? 1 : 0;
			if (aCoco !== bCoco) return bCoco - aCoco;
			if (a.integrityFlags.length !== b.integrityFlags.length) {
				return b.integrityFlags.length - a.integrityFlags.length;
			}
			return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
		});

	return {
		metrics: {
			queued: jobStatusCounts.queued ?? 0,
			running: jobStatusCounts.running ?? 0,
			failed: jobStatusCounts.failed ?? 0,
			needsReview: activeReviewDossiers.length
		},
		reviewDossiers: enrichedDossiers,
		activeJobs,
		sourceErrors: [...new Set(sourceErrors)],
		cron: {
			serverTime: cronPayload?.server_time ?? null,
			configured: cronPayload?.configured ?? enrichmentCronJobs.length > 0,
			jobs: enrichmentCronJobs.map(({ jobid, jobname, schedule, active }) => ({
				jobid,
				jobname,
				schedule,
				active
			})),
			runs: enrichmentCronRuns.map(({ jobid, status, start_time, end_time, return_message }) => ({
				jobid,
				status,
				start_time,
				end_time,
				return_message
			})),
			error: cronStatusResult.error?.message ?? null
		}
	};
};

function integerField(form: FormData, key: string, min: number, max: number) {
	const raw = String(form.get(key) ?? '').trim();
	const value = Number(raw);
	return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

const scalarProfileFactKeys = [
	'official_ordering_url',
	'founded_year',
	'founded_place',
	'parent_company',
	'ownership_model',
	'business_type',
	'boba_relevance',
	'price_positioning',
	'history_summary',
	'store_count_statement',
	'store_count_as_of',
	'brand_status',
	'observed_at'
] as const;

const listProfileFactKeys = [
	'native_names',
	'former_names',
	'product_categories',
	'signature_products',
	'known_for'
] as const;

const marketPresenceLevels = new Set(['country', 'admin1', 'metro', 'city']);

function parseMarketPresence(form: FormData, original: JsonRecord) {
	const raw = String(form.get('fact_market_presence') ?? '').trim();
	if (!raw) {
		if ('market_presence' in original) {
			return { places: [] as Array<Record<string, unknown>> } as const;
		}
		return { places: null } as const;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: 'Market presence must be valid JSON.' } as const;
	}
	if (!Array.isArray(parsed)) {
		return { error: 'Market presence must be a JSON array.' } as const;
	}

	const places: Array<Record<string, unknown>> = [];
	for (const [index, item] of parsed.entries()) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			return { error: `Market presence row ${index + 1} is invalid.` } as const;
		}
		const row = item as Record<string, unknown>;
		const placeId = typeof row.place_id === 'string' ? row.place_id.trim() : '';
		const level = typeof row.level === 'string' ? row.level.trim() : '';
		const name = typeof row.name === 'string' ? row.name.trim() : '';
		const countryCode =
			typeof row.country_code === 'string' && row.country_code.trim()
				? row.country_code.trim().toUpperCase()
				: null;
		const admin1Code =
			typeof row.admin1_code === 'string' && row.admin1_code.trim()
				? row.admin1_code.trim().toUpperCase()
				: null;
		const metroCode =
			typeof row.metro_code === 'string' && row.metro_code.trim() ? row.metro_code.trim() : null;
		const confidence =
			typeof row.confidence === 'number'
				? row.confidence
				: typeof row.confidence === 'string' && row.confidence.trim()
					? Number(row.confidence)
					: 1;
		if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
			return {
				error: `Market presence row ${index + 1} confidence must be a number from 0 to 1.`
			} as const;
		}

		if (!marketPresenceLevels.has(level)) {
			return {
				error: `Market presence row ${index + 1} needs level country, admin1, metro, or city.`
			} as const;
		}
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(placeId)
		) {
			return {
				error: `Market presence row ${index + 1} must use a canonical place from search.`
			} as const;
		}
		if (!name) {
			return { error: `Market presence row ${index + 1} needs a name.` } as const;
		}
		if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
			return {
				error: `Market presence row ${index + 1} country code must be ISO-2 (e.g. US).`
			} as const;
		}

		places.push({
			place_id: placeId,
			level,
			name,
			country_code: countryCode,
			admin1_code: admin1Code,
			metro_code: metroCode,
			confidence
		});
	}

	return { places } as const;
}

function parseProfileFacts(form: FormData) {
	let original: JsonRecord = {};
	try {
		const parsed = JSON.parse(String(form.get('original_profile_facts') ?? '{}'));
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			original = parsed as JsonRecord;
		}
	} catch {
		return { error: 'The original profile facts could not be read.' } as const;
	}

	const facts: JsonRecord = { ...original };
	for (const key of scalarProfileFactKeys) {
		const value = String(form.get(`fact_${key}`) ?? '').trim();
		if (value) {
			facts[key] = key === 'founded_year' ? Number(value) : value;
		} else if (key in original) {
			facts[key] = null;
		} else {
			delete facts[key];
		}
	}

	for (const key of listProfileFactKeys) {
		const values = String(form.get(`fact_${key}`) ?? '')
			.split('\n')
			.map((value) => value.trim())
			.filter((value, index, rows) => value && rows.indexOf(value) === index);
		if (values.length || key in original) {
			facts[key] = values;
		} else {
			delete facts[key];
		}
	}

	const socialRows = String(form.get('fact_official_socials') ?? '')
		.split('\n')
		.map((value) => value.trim())
		.filter(Boolean);
	const socials: Array<{ platform: string; url: string }> = [];
	for (const row of socialRows) {
		const separator = row.indexOf('|');
		const platform = separator >= 0 ? row.slice(0, separator).trim() : '';
		const url = separator >= 0 ? row.slice(separator + 1).trim() : '';
		if (!platform || !/^https?:\/\/\S+$/i.test(url)) {
			return {
				error: `Invalid social entry "${row}". Use Platform | https://example.com/profile.`
			} as const;
		}
		socials.push({ platform, url });
	}
	if (socials.length || 'official_socials' in original) {
		facts.official_socials = socials;
	} else {
		delete facts.official_socials;
	}

	const marketPresence = parseMarketPresence(form, original);
	if ('error' in marketPresence) {
		return { error: marketPresence.error } as const;
	}
	if (marketPresence.places) {
		facts.market_presence = marketPresence.places;
	} else {
		delete facts.market_presence;
	}
	// Short market labels are derived by the database from canonical market presence.
	delete facts.markets;

	if (
		typeof facts.founded_year === 'number' &&
		(!Number.isInteger(facts.founded_year) ||
			facts.founded_year < 1800 ||
			facts.founded_year > new Date().getFullYear())
	) {
		return { error: 'Founded year must be a reasonable four-digit year.' } as const;
	}

	return { facts } as const;
}

async function validateCanonicalMarketPlaces(locals: App.Locals, facts: JsonRecord) {
	const marketPresence = facts.market_presence;
	if (!Array.isArray(marketPresence) || marketPresence.length === 0) return null;
	const expected = new Map(
		marketPresence.map((item) => {
			const row = item as Record<string, unknown>;
			return [String(row.place_id), String(row.level)];
		})
	);
	const { data, error } = await locals.supabase
		.from('geo_places')
		.select('id,level')
		.in('id', [...expected.keys()]);
	if (error) return error.message;
	const actual = new Map((data ?? []).map((place) => [place.id, place.level]));
	for (const [placeId, level] of expected) {
		if (actual.get(placeId) !== level) {
			return `Canonical place ${placeId} is missing or does not match ${level}.`;
		}
	}
	return null;
}

function parseIdentity(form: FormData) {
	const display = String(form.get('identity_display') ?? '').trim();
	const website = String(form.get('identity_website') ?? '').trim();
	const wikidata = String(form.get('identity_wikidata') ?? '').trim();
	const matchPolicy = String(form.get('identity_match_policy') ?? '').trim();
	let aliases: string[];
	try {
		const parsed = JSON.parse(String(form.get('identity_aliases') ?? '[]'));
		if (!Array.isArray(parsed) || parsed.some((alias) => typeof alias !== 'string')) {
			throw new Error('Aliases must be a list of names.');
		}
		aliases = parsed;
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : 'Aliases could not be read.'
		} as const;
	}
	if (!display) return { error: 'A canonical display name is required.' } as const;
	if (!isBrandMatchPolicy(matchPolicy)) {
		return { error: 'Select a valid match policy.' } as const;
	}

	return {
		identity: {
			display,
			aliases,
			website: website || null,
			wikidata: wikidata || null,
			match_policy: matchPolicy
		}
	} as const;
}

async function functionErrorMessage(error: unknown) {
	if (error && typeof error === 'object' && 'context' in error) {
		const context = (error as { context?: unknown }).context;
		if (context instanceof Response) {
			try {
				const payload = (await context.clone().json()) as { error?: unknown; message?: unknown };
				if (typeof payload.error === 'string' && payload.error) return payload.error;
				if (typeof payload.message === 'string' && payload.message) return payload.message;
			} catch {
				// Fall back to the client error below when the response is not JSON.
			}
		}
	}
	return error instanceof Error && error.message
		? error.message
		: 'The enrichment worker rejected the request.';
}

async function invokeEnrichment(
	locals: App.Locals,
	body: JsonRecord,
	action: string,
	successMessage: string
) {
	if (!locals.isAdmin) return fail(403, { ok: false, action, message: 'Admin access required.' });

	const { data, error } = await locals.supabase.functions.invoke('process-brand-enrichment-jobs', {
		body
	});
	const responseError =
		data && typeof data === 'object' && 'error' in data && data.error ? String(data.error) : null;
	if (error || responseError) {
		const message = responseError ?? (await functionErrorMessage(error));
		console.error(`[enrichment] ${action}`, error ?? data);
		return fail(400, { ok: false, action, message });
	}

	const enqueued =
		data && typeof data === 'object' && 'enqueued' in data && typeof data.enqueued === 'number'
			? data.enqueued
			: null;
	const claimed =
		data && typeof data === 'object' && 'claimed' in data && typeof data.claimed === 'number'
			? data.claimed
			: null;
	const message =
		action === 'drain' && claimed != null
			? `Claimed ${claimed} queued enrichment job${claimed === 1 ? '' : 's'}.`
			: enqueued != null && claimed != null
				? `Queued ${enqueued} brand${enqueued === 1 ? '' : 's'}; processing ${claimed} now.`
				: successMessage;

	return { ok: true, action, data, message };
}

async function setCronEnabled(
	locals: App.Locals,
	enabled: boolean,
	action: string,
	successMessage: string
) {
	if (!locals.isAdmin) return fail(403, { ok: false, action, message: 'Admin access required.' });

	const { error } = await locals.supabase.rpc('admin_set_brand_enrichment_cron_enabled', {
		p_enabled: enabled
	});
	if (error) {
		console.error(`[enrichment] ${action}`, error);
		return fail(400, {
			ok: false,
			action,
			message: error.message || 'The enrichment cron could not be updated.'
		});
	}

	return { ok: true, action, message: successMessage };
}

export const actions: Actions = {
	drain: async ({ request, locals }) => {
		const form = await request.formData();
		const limit = integerField(form, 'limit', 1, 5);
		if (!limit) {
			return fail(400, {
				ok: false,
				action: 'drain',
				message: 'Choose a worker batch limit from 1–5.'
			});
		}
		return invokeEnrichment(
			locals,
			{ limit },
			'drain',
			`Processing up to ${limit} queued enrichment jobs.`
		);
	},
	configureCron: async ({ locals }) =>
		setCronEnabled(
			locals,
			true,
			'configureCron',
			'Enabled the enrichment queue worker every five minutes with a batch limit of five.'
		),
	disableCron: async ({ locals }) =>
		setCronEnabled(locals, false, 'disableCron', 'Disabled the automatic enrichment queue worker.'),
	saveResearchScope: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'saveResearchScope',
				message: 'Admin access required.'
			});
		}
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		if (!slug) {
			return fail(400, {
				ok: false,
				action: 'saveResearchScope',
				message: 'A brand slug is required.'
			});
		}
		let scope: ResearchScope;
		try {
			scope = parseResearchScope(String(form.get('research_scope') ?? ''));
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'saveResearchScope',
				message: error instanceof Error ? error.message : 'Research scope is invalid.'
			});
		}
		const { data, error } = await locals.supabase.rpc('admin_set_brand_enrichment_research_scope', {
			p_brand_slug: slug,
			p_scope: scope,
			p_note: null
		});
		if (error) {
			console.error('[enrichment] saveResearchScope', error);
			return fail(400, {
				ok: false,
				action: 'saveResearchScope',
				message: error.message || 'The research scope could not be saved.'
			});
		}
		return {
			ok: true,
			action: 'saveResearchScope',
			scope: data,
			message: `Saved reusable research scope for ${slug}.`
		};
	},
	rerunEnrichment: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		const locationAnchor = String(form.get('enrichment_location_anchor') ?? '').trim();
		const expectedCanonicalName = String(form.get('expected_canonical_name') ?? '').trim();
		const expectedOrigin = String(form.get('expected_origin') ?? '').trim();
		const expectedOfficialWebsite = String(form.get('expected_official_website') ?? '').trim();
		const verifiedSourceKind = String(form.get('verified_source_kind') ?? 'unknown');
		const verifiedSourceUrl = String(form.get('verified_source_url') ?? '').trim();
		if (!slug) {
			return fail(400, {
				ok: false,
				action: 'rerunEnrichment',
				message: 'A brand slug is required.'
			});
		}
		if (locationAnchor.length > 160) {
			return fail(400, {
				ok: false,
				action: 'rerunEnrichment',
				message: 'The enrichment location anchor must be 160 characters or fewer.'
			});
		}
		if (expectedCanonicalName.length > 160 || expectedOrigin.length > 160) {
			return fail(400, {
				ok: false,
				action: 'rerunEnrichment',
				message: 'Canonical-name and origin guidance must be 160 characters or fewer.'
			});
		}
		if (
			![
				'unknown',
				'official_brand',
				'regional_operator',
				'directory_listing',
				'independent_source'
			].includes(verifiedSourceKind)
		) {
			return fail(400, {
				ok: false,
				action: 'rerunEnrichment',
				message: 'Choose a valid source relationship.'
			});
		}
		for (const [value, label] of [
			[expectedOfficialWebsite, 'expected official website'],
			[verifiedSourceUrl, 'verified source URL']
		] as const) {
			if (!value) continue;
			try {
				const parsed = new URL(value);
				if (!['http:', 'https:'].includes(parsed.protocol))
					throw new Error('Unsupported protocol.');
			} catch {
				return fail(400, {
					ok: false,
					action: 'rerunEnrichment',
					message: `Enter a valid HTTP or HTTPS ${label}.`
				});
			}
		}
		const { data, error } = await locals.supabase.rpc('admin_queue_brand_enrichment', {
			p_brand_slug: slug,
			p_location_anchor: locationAnchor || null,
			p_expected_canonical_name: expectedCanonicalName || null,
			p_expected_origin: expectedOrigin || null,
			p_expected_official_website: expectedOfficialWebsite || null,
			p_verified_source_kind: verifiedSourceKind,
			p_verified_source_url: verifiedSourceUrl || null,
			p_note: null
		});
		if (error) {
			console.error('[enrichment] rerunEnrichment', error);
			return fail(400, {
				ok: false,
				action: 'rerunEnrichment',
				message: error.message || 'The enrichment rerun could not be queued.'
			});
		}
		const payload = data && typeof data === 'object' ? (data as JsonRecord) : {};
		const jobId = typeof payload.job_id === 'string' ? payload.job_id : null;
		return {
			ok: true,
			action: 'rerunEnrichment',
			jobId,
			message: `Queued enrichment rerun ${jobId ?? ''} for ${slug}.`.replace('  ', ' ')
		};
	},
	controlledCohort: async ({ request, locals }) => {
		const form = await request.formData();
		const count = integerField(form, 'count', 1, 100);
		const mode = String(form.get('mode') ?? 'backfill');
		const autoPublish = mode === 'backfill';
		if (!count || ![1, 5, 10, 25, 100].includes(count) || !['backfill', 'audit'].includes(mode)) {
			return fail(400, {
				ok: false,
				action: 'controlledCohort',
				message: 'Choose a cohort size of 1, 5, 10, 25, or 100 and a mode of backfill or audit.'
			});
		}
		const { data, error } = await locals.supabase.rpc('admin_queue_brand_enrichment_cohort', {
			p_count: count,
			p_local_only: false,
			p_missing_website: false,
			p_anchor_filter: 'any',
			p_prior_failures: false,
			p_note: String(form.get('note') ?? '').trim() || null,
			p_auto_publish: autoPublish
		});
		if (error) {
			console.error('[enrichment] controlledCohort', error);
			return fail(400, {
				ok: false,
				action: 'controlledCohort',
				message: error.message || 'The cohort could not be queued.'
			});
		}
		const payload = data && typeof data === 'object' ? (data as JsonRecord) : {};
		const queuedCount = typeof payload.queued_count === 'number' ? payload.queued_count : 0;
		return {
			ok: true,
			action: 'controlledCohort',
			message: `Queued ${queuedCount} ${mode} job${queuedCount === 1 ? '' : 's'}.`
		};
	},
	controlledJobState: async ({ request, locals }) => {
		const form = await request.formData();
		const jobId = String(form.get('job_id') ?? '').trim();
		const requestedAction = String(form.get('job_action') ?? '').trim();
		if (!jobId || !['pause', 'resume', 'cancel'].includes(requestedAction)) {
			return fail(400, {
				ok: false,
				action: 'controlledJobState',
				message: 'Choose a valid controlled job action.'
			});
		}
		const { error } = await locals.supabase.rpc('admin_set_controlled_enrichment_job_state', {
			p_job_id: jobId,
			p_action: requestedAction
		});
		if (error) {
			console.error('[enrichment] controlledJobState', error);
			return fail(400, {
				ok: false,
				action: 'controlledJobState',
				message: error.message || 'The controlled job could not be updated.'
			});
		}
		return {
			ok: true,
			action: 'controlledJobState',
			message: `${requestedAction === 'pause' ? 'Paused' : requestedAction === 'resume' ? 'Resumed' : 'Cancelled'} controlled job ${jobId}.`
		};
	},
	reviewAndPublish: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		const publishMode = String(form.get('publish_mode') ?? 'review');
		const summary = String(form.get('summary') ?? '').trim();
		const publicSummary = String(form.get('public_summary') ?? '').trim();
		const originalPublicSummary = String(form.get('original_public_summary') ?? '').trim();
		const preservePublishedSummary =
			form.get('public_summary_is_published_fallback') === 'true' &&
			publicSummary === originalPublicSummary;
		const publicSummaryForPublish = preservePublishedSummary ? '' : publicSummary;
		const parsed = parseProfileFacts(form);
		const parsedIdentity = parseIdentity(form);
		if (!slug || !summary || 'error' in parsed || 'error' in parsedIdentity) {
			return fail(400, {
				ok: false,
				action: 'reviewAndPublish',
				message:
					'error' in parsed
						? parsed.error
						: 'error' in parsedIdentity
							? parsedIdentity.error
							: 'A brand slug and non-empty customer summary are required.'
			});
		}
		const publicSummaryLength = Array.from(publicSummaryForPublish).length;
		if (publicSummaryForPublish && (publicSummaryLength < 40 || publicSummaryLength > 300)) {
			return fail(400, {
				ok: false,
				action: 'reviewAndPublish',
				message: 'The user-facing summary must be between 40 and 300 characters.'
			});
		}
		parsed.facts.official_website = parsedIdentity.identity.website;
		const marketPlaceError = await validateCanonicalMarketPlaces(locals, parsed.facts);
		if (marketPlaceError) {
			return fail(400, {
				ok: false,
				action: 'reviewAndPublish',
				message: marketPlaceError
			});
		}
		if (publishMode === 'republish') {
			if (!locals.isAdmin || !locals.userId) {
				return fail(403, {
					ok: false,
					action: 'reviewAndPublish',
					message: 'Admin access required.'
				});
			}
			const { data, error } = await supabaseAdmin().rpc(
				'admin_edit_and_republish_brand_enrichment',
				{
					p_brand_slug: slug,
					p_summary: summary,
					p_profile_facts: parsed.facts,
					p_identity: parsedIdentity.identity,
					p_public_summary: publicSummaryForPublish || null,
					p_note: String(form.get('note') ?? '').trim() || null,
					p_reviewer_id: locals.userId
				}
			);
			if (error) {
				console.error('[enrichment] editAndRepublish', error);
				return fail(400, {
					ok: false,
					action: 'reviewAndPublish',
					message: error.message || 'The profile could not be republished.'
				});
			}
			return {
				ok: true,
				action: 'reviewAndPublish',
				data,
				message: `Updated and republished ${slug}.`
			};
		}
		if (!locals.isAdmin || !locals.userId) {
			return fail(403, {
				ok: false,
				action: 'reviewAndPublish',
				message: 'Admin access required.'
			});
		}
		const { data, error } = await supabaseAdmin().rpc('admin_review_and_publish_brand_enrichment', {
			p_brand_slug: slug,
			p_summary: summary,
			p_profile_facts: parsed.facts,
			p_identity: parsedIdentity.identity,
			p_public_summary: publicSummaryForPublish || null,
			p_note: String(form.get('note') ?? '').trim() || null,
			p_reviewer_id: locals.userId
		});
		if (error) {
			console.error('[enrichment] reviewAndPublish', error);
			return fail(400, {
				ok: false,
				action: 'reviewAndPublish',
				message: error.message || 'The profile could not be published.'
			});
		}
		return {
			ok: true,
			action: 'reviewAndPublish',
			data,
			message: `Published ${slug}.`
		};
	},
	resetEnrichment: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		const reason = String(form.get('reason') ?? '').trim();
		if (!locals.isAdmin || !locals.userId) {
			return fail(403, {
				ok: false,
				action: 'resetEnrichment',
				message: 'Admin access required.'
			});
		}
		if (!slug || !reason) {
			return fail(400, {
				ok: false,
				action: 'resetEnrichment',
				message: 'A brand slug and reset reason are required.'
			});
		}

		const { data, error } = await supabaseAdmin().rpc('admin_reset_brand_enrichment', {
			p_brand_slug: slug,
			p_reason: reason,
			p_enqueue_fresh: false,
			p_reviewer_id: locals.userId
		});
		if (error) {
			console.error('[enrichment] resetEnrichment', error);
			return fail(400, {
				ok: false,
				action: 'resetEnrichment',
				message: error.message || 'The enrichment could not be reset.'
			});
		}

		return {
			ok: true,
			action: 'resetEnrichment',
			data,
			message: `Reset and disabled enrichment for ${slug}.`
		};
	},
	mergeBrand: async ({ request, locals }) => {
		const form = await request.formData();
		const sourceSlug = String(form.get('source_slug') ?? '').trim();
		const targetSlug = String(form.get('target_slug') ?? '').trim();
		const reason = String(form.get('reason') ?? '').trim();
		if (!sourceSlug || !targetSlug || !reason) {
			return fail(400, {
				ok: false,
				action: 'mergeBrand',
				message: 'Source, target, and merge reason are required.'
			});
		}
		try {
			const data = await mergeBrands(locals, {
				sourceSlug,
				targetSlug,
				reason,
				markTargetForReview: String(form.get('mark_target_for_review') ?? '') === 'true'
			});
			return {
				ok: true,
				action: 'mergeBrand',
				data,
				message: `Merged ${sourceSlug} into ${data.target_display}.`
			};
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'mergeBrand',
				message: error instanceof Error ? error.message : 'Could not merge these brands.'
			});
		}
	},
	resolveFlag: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { ok: false, action: 'resolveFlag', message: 'Admin access required.' });
		}
		const form = await request.formData();
		const flagId = String(form.get('flag_id') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();
		const resolution = String(form.get('resolution') ?? 'dismissed');
		if (!flagId || !note || !['resolved', 'dismissed'].includes(resolution)) {
			return fail(400, {
				ok: false,
				action: 'resolveFlag',
				message: 'Flag, note, and a valid resolution are required.'
			});
		}
		const { data, error } = await locals.supabase.rpc('admin_resolve_brand_integrity_flag', {
			p_flag_id: flagId,
			p_note: note,
			p_resolution: resolution
		});
		if (error) {
			return fail(400, { ok: false, action: 'resolveFlag', message: error.message });
		}
		return {
			ok: true,
			action: 'resolveFlag',
			data,
			message: `Integrity flag ${resolution}.`
		};
	},
	markClosed: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '');
		return invokeEnrichment(
			locals,
			{
				action: 'mark_brand_closed',
				brand_slug: slug,
				note: String(form.get('note') ?? '').trim()
			},
			'markClosed',
			`Marked ${slug} closed.`
		);
	},
	deleteFalsePositive: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '');
		const confirmationSlug = String(form.get('confirmation_slug') ?? '');
		if (!slug || confirmationSlug !== slug) {
			return fail(400, {
				ok: false,
				action: 'deleteFalsePositive',
				brandSlug: slug,
				message: 'The confirmation slug must match exactly.'
			});
		}
		return invokeEnrichment(
			locals,
			{
				action: 'delete_false_positive_brand',
				brand_slug: slug,
				confirmation_slug: confirmationSlug,
				note: String(form.get('note') ?? '').trim()
			},
			'deleteFalsePositive',
			`Deleted false-positive brand ${slug}.`
		);
	}
};
