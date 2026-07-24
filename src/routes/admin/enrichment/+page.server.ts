import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

type JsonRecord = Record<string, unknown>;

type DossierRow = {
	brand_slug: string;
	research_run_id: string | null;
	approval_status: string;
	customer_summary: string | null;
	creative_brief: JsonRecord | string | null;
	last_researched_at: string | null;
	refresh_after: string | null;
	updated_at: string;
	quality_metrics: JsonRecord | null;
	review_reasons: string[] | null;
	approval_method: string | null;
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
	details: string | null;
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
	const [jobsResult, dossiersResult, profilesResult, flagsResult] = await Promise.all([
		locals.supabase
			.schema('ingest')
			.from('brand_enrichment_jobs')
			.select('id,brand_slug,trigger_kind,status,attempt_count,last_error,created_at,completed_at')
			.order('created_at', { ascending: false })
			.limit(250),
		locals.supabase
			.schema('mod')
			.from('brand_dossiers')
			.select(
				'brand_slug,research_run_id,approval_status,customer_summary,creative_brief,last_researched_at,refresh_after,updated_at,quality_metrics,review_reasons,approval_method'
			)
			.order('updated_at', { ascending: false }),
		locals.supabase
			.from('brand_profiles')
			.select('brand_slug,summary,summary_confidence,publication_method,published_at,updated_at'),
		locals.supabase
			.schema('mod')
			.from('brand_integrity_flags')
			.select('id,brand_slug,severity,status,title,details,recommended_action,last_seen_at')
			.order('last_seen_at', { ascending: false })
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
	const reviewDossiers = dossiers.filter((row) => row.approval_status === 'needs_review');
	const runIds = reviewDossiers.flatMap((row) =>
		row.research_run_id ? [row.research_run_id] : []
	);

	let runs: ResearchRunRow[] = [];
	let claims: ClaimRow[] = [];
	let claimSources: ClaimSourceRow[] = [];
	let sources: SourceRow[] = [];

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
	const openFlags = flags.filter((row) => row.status !== 'resolved' && row.status !== 'closed');
	const jobStatusCounts = countByStatus(jobs);
	const now = Date.now();

	const enrichedDossiers = reviewDossiers
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
				run,
				claims: dossierClaims,
				integrityFlags: openFlags.filter((flag) => flag.brand_slug === dossier.brand_slug),
				profile: profileByBrand.get(dossier.brand_slug) ?? null,
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
			publishedProfiles: profiles.length,
			dossiersNeedingReview: reviewDossiers.length,
			dueRefreshes: dossiers.filter(
				(row) => row.refresh_after && new Date(row.refresh_after).getTime() <= now
			).length,
			openIntegrityFlags: openFlags.length
		},
		dossiers: enrichedDossiers,
		recentJobs: jobs.slice(0, 20),
		sourceErrors: [...new Set(sourceErrors)]
	};
};

function brandSlugs(form: FormData) {
	return String(form.get('brand_slugs') ?? '')
		.split(/[\n,]/)
		.map((value) => value.trim())
		.filter((value, index, values) => value && values.indexOf(value) === index);
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
		data && typeof data === 'object' && 'error' in data ? String(data.error) : null;
	if (error || responseError) {
		const message =
			responseError ?? error?.message ?? 'The enrichment worker rejected the request.';
		console.error(`[enrichment] ${action}`, error ?? data);
		return fail(400, { ok: false, action, message });
	}

	return { ok: true, action, message: successMessage };
}

export const actions: Actions = {
	backfill: async ({ request, locals }) => {
		const slugs = brandSlugs(await request.formData());
		if (!slugs.length) {
			return fail(400, { ok: false, action: 'backfill', message: 'Select at least one brand.' });
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
		return invokeEnrichment(
			locals,
			{ brand_slugs: slugs, trigger_kind: 'audit', limit: 5 },
			'audit',
			`Started audit for ${slugs.length} brand${slugs.length === 1 ? '' : 's'}.`
		);
	},
	drain: async ({ locals }) =>
		invokeEnrichment(locals, { limit: 5 }, 'drain', 'Queued enrichment work is draining.'),
	approve: async ({ request, locals }) => {
		const form = await request.formData();
		const slug = String(form.get('brand_slug') ?? '');
		return invokeEnrichment(
			locals,
			{
				action: 'approve_brand_review',
				brand_slug: slug,
				note: String(form.get('note') ?? '').trim()
			},
			'approve',
			`Approved ${slug}.`
		);
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
