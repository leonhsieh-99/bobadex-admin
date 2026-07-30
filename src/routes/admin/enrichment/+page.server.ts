import { fail } from '@sveltejs/kit';
import { mergeBrands } from '$lib/server/brand-merge.server';
import { isBrandMatchPolicy } from '$lib/brand-match-policy';
import { supabaseAdmin } from '$lib/supabase.server';
import type { Actions, PageServerLoad } from './$types';

type JsonRecord = Record<string, unknown>;

type DossierRow = {
	brand_slug: string;
	research_run_id: string | null;
	approval_status: string;
	customer_summary: string | null;
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
	brand_slug: string;
	status: string;
	provider: string | null;
	model: string | null;
	customer_summary_draft: string | null;
	creative_brief_draft: JsonRecord | string | null;
	overall_confidence: number | null;
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
};

type BrandAliasRow = {
	id: number;
	brand_slug: string;
	normalized_name: string;
	alias_display: string | null;
	match_mode: string;
};

type OsmLocationRow = {
	id: string;
	name: string | null;
	source: string | null;
	source_key: string | null;
	lat: number | null;
	lon: number | null;
	region_key: string | null;
	matched_brand_slug: string | null;
};

type EnrichmentJobRow = {
	id: string;
	brand_slug: string;
	trigger_kind: string;
	status: string;
	attempt_count: number;
	last_error: string | null;
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

export const load: PageServerLoad = async ({ locals }) => {
	const [jobsResult, dossiersResult, profilesResult, flagsResult, cronStatusResult] =
		await Promise.all([
			locals.supabase
				.schema('ingest')
				.from('brand_enrichment_jobs')
				.select(
					'id,brand_slug,trigger_kind,status,attempt_count,last_error,created_at,completed_at'
				)
				.order('created_at', { ascending: false })
				.limit(250),
			locals.supabase
				.schema('mod')
				.from('brand_dossiers')
				.select(
					'brand_slug,research_run_id,approval_status,customer_summary,creative_brief,profile_facts,last_researched_at,refresh_after,updated_at,quality_metrics,review_reasons,approval_method,recommended_match_policy,match_policy_route,match_policy_evidence'
				)
				.order('updated_at', { ascending: false }),
			locals.supabase
				.from('brand_profiles')
				.select('brand_slug,summary,summary_confidence,publication_method,published_at,updated_at'),
			locals.supabase
				.schema('mod')
				.from('brand_integrity_flags')
				.select('id,brand_slug,severity,status,title,details,recommended_action,last_seen_at')
				.order('last_seen_at', { ascending: false }),
			locals.supabase.rpc('admin_brand_enrichment_cron_status')
		]);

	const sourceResults = [
		['Enrichment jobs', jobsResult],
		['Dossiers', dossiersResult],
		['Profiles', profilesResult],
		['Integrity flags', flagsResult]
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
	const cronPayload =
		cronStatusResult.data &&
		typeof cronStatusResult.data === 'object' &&
		!Array.isArray(cronStatusResult.data)
			? (cronStatusResult.data as CronStatusPayload)
			: null;
	const enrichmentCronJobs = cronPayload?.jobs ?? [];
	const enrichmentCronRuns = cronPayload?.runs ?? [];
	const reviewDossiers = dossiers.filter((row) => row.approval_status === 'needs_review');
	const runIds = reviewDossiers.flatMap((row) =>
		row.research_run_id ? [row.research_run_id] : []
	);
	const reviewBrandSlugs = reviewDossiers.map((row) => row.brand_slug);
	const editorBrandSlugs = [
		...new Set([...reviewBrandSlugs, ...profiles.map((profile) => profile.brand_slug)])
	];

	let runs: ResearchRunRow[] = [];
	let claims: ClaimRow[] = [];
	let claimSources: ClaimSourceRow[] = [];
	let sources: SourceRow[] = [];
	let brandIdentities: BrandIdentityRow[] = [];
	let brandAliases: BrandAliasRow[] = [];
	let osmLocations: OsmLocationRow[] = [];

	if (editorBrandSlugs.length) {
		const [identitiesResult, aliasesResult] = await Promise.all([
			locals.supabase
				.from('brands')
				.select('slug,display,website,wikidata,status,is_demo,match_policy,enrichment_mode')
				.in('slug', editorBrandSlugs),
			locals.supabase
				.from('brand_aliases')
				.select('id,brand_slug,normalized_name,alias_display,match_mode')
				.in('brand_slug', editorBrandSlugs)
				.order('normalized_name')
		]);
		if (identitiesResult.error) {
			console.error('[enrichment] Brand identities', identitiesResult.error);
			sourceErrors.push('Brand identities');
		}
		if (aliasesResult.error) {
			console.error('[enrichment] Brand aliases', aliasesResult.error);
			sourceErrors.push('Brand aliases');
		}
		brandIdentities = (identitiesResult.data ?? []) as BrandIdentityRow[];
		brandAliases = (aliasesResult.data ?? []) as BrandAliasRow[];
	}

	if (reviewBrandSlugs.length) {
		const osmLocationsResult = await locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select('id,name,source,source_key,lat,lon,region_key,matched_brand_slug')
			.in('matched_brand_slug', reviewBrandSlugs)
			.order('created_at', { ascending: false })
			.limit(5000);
		if (osmLocationsResult.error) {
			console.error('[enrichment] OSM locations', osmLocationsResult.error);
			sourceErrors.push('OSM locations');
		}
		osmLocations = (osmLocationsResult.data ?? []) as OsmLocationRow[];
	}

	if (runIds.length) {
		const [runsResult, claimsResult, claimSourcesResult, sourcesResult] = await Promise.all([
			locals.supabase
				.schema('ingest')
				.from('brand_research_runs')
				.select(
					'id,brand_slug,status,provider,model,customer_summary_draft,creative_brief_draft,overall_confidence,completed_at,error_text,quality_metrics'
				)
				.in('id', runIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_claims')
				.select(
					'id,run_id,brand_slug,claim_key,claim_value,confidence,evidence_assessment,review_status,materiality,rationale'
				)
				.in('run_id', runIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_claim_sources')
				.select('run_id,claim_id,source_id,citation_role,evidence_excerpt')
				.in('run_id', runIds),
			locals.supabase
				.schema('ingest')
				.from('brand_research_sources')
				.select('id,run_id,source_type,url,title,publisher,published_at,excerpt,credibility')
				.in('run_id', runIds)
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
		runs = (runsResult.data ?? []) as ResearchRunRow[];
		claims = (claimsResult.data ?? []) as ClaimRow[];
		claimSources = (claimSourcesResult.data ?? []) as ClaimSourceRow[];
		sources = (sourcesResult.data ?? []) as SourceRow[];
	}

	const runById = new Map(runs.map((row) => [row.id, row]));
	const sourceById = new Map(sources.map((row) => [row.id, row]));
	const profileByBrand = new Map(profiles.map((row) => [row.brand_slug, row]));
	const dossierByBrand = new Map(dossiers.map((row) => [row.brand_slug, row]));
	const identityByBrand = new Map(brandIdentities.map((row) => [row.slug, row]));
	const openFlags = flags.filter((row) => row.status !== 'resolved' && row.status !== 'closed');
	const jobStatusCounts = countByStatus(jobs);
	const activeJobs = jobs.filter((row) => row.status === 'queued' || row.status === 'running');
	const latestActiveJobByBrand = new Map<string, EnrichmentJobRow>();
	for (const job of activeJobs) {
		if (!latestActiveJobByBrand.has(job.brand_slug)) {
			latestActiveJobByBrand.set(job.brand_slug, job);
		}
	}
	const now = Date.now();

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
				osmLocations: osmLocations.filter(
					(location) => location.matched_brand_slug === dossier.brand_slug
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
	const publishedProfiles = profiles
		.map((profile) => {
			const dossier = dossierByBrand.get(profile.brand_slug);
			const identity = identityByBrand.get(profile.brand_slug);
			return {
				...profile,
				editor:
					dossier && identity && identity.status !== 'merged'
						? {
								...dossier,
								identity: {
									...identity,
									aliases: brandAliases.filter((alias) => alias.brand_slug === profile.brand_slug)
								},
								activeJob: latestActiveJobByBrand.get(profile.brand_slug) ?? null
							}
						: null
			};
		})
		.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

	return {
		metrics: {
			queued: jobStatusCounts.queued ?? 0,
			running: jobStatusCounts.running ?? 0,
			failed: jobStatusCounts.failed ?? 0,
			publishedProfiles: profiles.length,
			dossiersNeedingReview: activeReviewDossiers.length,
			dueRefreshes: dossiers.filter(
				(row) => row.refresh_after && new Date(row.refresh_after).getTime() <= now
			).length,
			openIntegrityFlags: openFlags.length
		},
		dossiers: enrichedDossiers,
		activeJobs,
		publishedProfiles,
		recentJobs: jobs.slice(0, 20),
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

function brandSlugs(form: FormData) {
	return String(form.get('brand_slugs') ?? '')
		.split(/[\n,]/)
		.map((value) => value.trim())
		.filter((value, index, values) => value && values.indexOf(value) === index);
}

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
	'markets',
	'known_for'
] as const;

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
			: action === 'rerunBrand' && enqueued != null && claimed != null
				? `${enqueued === 1 ? successMessage : 'No new audit was queued; an active job may already exist.'} The worker claimed ${claimed} queued job${claimed === 1 ? '' : 's'}.`
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
	campaign: async ({ request, locals }) => {
		const form = await request.formData();
		const count = integerField(form, 'count', 1, 500);
		const limit = integerField(form, 'limit', 1, 5);
		const requestedTrigger = String(form.get('trigger_kind') ?? '');
		const triggerKind = ['backfill', 'audit', 'scheduled_refresh'].includes(requestedTrigger)
			? requestedTrigger
			: null;
		if (!count || !limit || !triggerKind) {
			return fail(400, {
				ok: false,
				action: 'campaign',
				message: 'Choose a campaign type, a count from 1–500, and a batch limit from 1–5.'
			});
		}

		const triggerLabel =
			triggerKind === 'scheduled_refresh'
				? 'scheduled refresh'
				: triggerKind === 'audit'
					? 'audit'
					: 'backfill';
		return invokeEnrichment(
			locals,
			{ count, trigger_kind: triggerKind, limit },
			'campaign',
			`Started a ${triggerLabel} campaign for up to ${count} brands; processing up to ${limit} now.`
		);
	},
	backfill: async ({ request, locals }) => {
		const slugs = brandSlugs(await request.formData());
		if (!slugs.length) {
			return fail(400, { ok: false, action: 'backfill', message: 'Select at least one brand.' });
		}
		if (slugs.length > 20) {
			return fail(400, {
				ok: false,
				action: 'backfill',
				message: 'Targeted campaigns support at most 20 brand slugs per request.'
			});
		}
		return invokeEnrichment(
			locals,
			{ brand_slugs: slugs, trigger_kind: 'backfill', limit: 5 },
			'backfill',
			`Started backfill for ${slugs.length} brand${slugs.length === 1 ? '' : 's'}.`
		);
	},
	audit: async ({ request, locals }) => {
		const slugs = brandSlugs(await request.formData());
		if (!slugs.length) {
			return fail(400, { ok: false, action: 'audit', message: 'Select at least one brand.' });
		}
		if (slugs.length > 20) {
			return fail(400, {
				ok: false,
				action: 'audit',
				message: 'Targeted campaigns support at most 20 brand slugs per request.'
			});
		}
		return invokeEnrichment(
			locals,
			{ brand_slugs: slugs, trigger_kind: 'audit', limit: 5 },
			'audit',
			`Started audit for ${slugs.length} brand${slugs.length === 1 ? '' : 's'}.`
		);
	},
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
	rerunBrand: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		if (!slug) {
			return fail(400, {
				ok: false,
				action: 'rerunBrand',
				message: 'A brand slug is required.'
			});
		}
		const { data: brand, error: brandError } = await locals.supabase
			.from('brands')
			.select('enrichment_mode')
			.eq('slug', slug)
			.maybeSingle();
		if (brandError) {
			return fail(400, {
				ok: false,
				action: 'rerunBrand',
				message: brandError.message
			});
		}
		if (!brand || brand.enrichment_mode === 'disabled') {
			return fail(409, {
				ok: false,
				action: 'rerunBrand',
				message: `Enrichment is disabled for ${slug}. Change its mode in the brand catalog first.`
			});
		}
		return invokeEnrichment(
			locals,
			{ brand_slugs: [slug], trigger_kind: 'audit', limit: 1 },
			'rerunBrand',
			`Queued a fresh enrichment audit for ${slug}.`
		);
	},
	reviewAndPublish: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '').trim();
		const publishMode = String(form.get('publish_mode') ?? 'review');
		const summary = String(form.get('summary') ?? '').trim();
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
		parsed.facts.official_website = parsedIdentity.identity.website;
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
		return invokeEnrichment(
			locals,
			{
				action: 'review_and_publish_brand_enrichment',
				brand_slug: slug,
				summary,
				profile_facts: parsed.facts,
				identity: parsedIdentity.identity,
				note: String(form.get('note') ?? '').trim()
			},
			'reviewAndPublish',
			`Published ${slug}.`
		);
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
