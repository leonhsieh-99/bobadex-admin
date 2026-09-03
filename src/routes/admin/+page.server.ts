import type { PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/supabase.server';
import { countByValues, countExact } from '$lib/server/status-counts.server';
import {
	loadProviderRuns,
	loadPipelineRuns,
	loadShards,
	countByStatus
} from '$lib/server/poi-import.server';
import { loadStorefrontReviewDossiers } from '$lib/server/poi-storefront.server';

type ReviewCandidateRow = {
	id: string;
	canonical_name: string | null;
	process_status: string;
	region_key: string | null;
	updated_at: string;
};

type StagingRow = {
	id: string;
	suggested_name: string;
	status: string;
	source: string | null;
	created_at: string | null;
};

type ReportRow = {
	id: string;
	content_type: string;
	reason: string | null;
	status: string;
	created_at: string;
};

type CronStatusPayload = {
	jobs?: Array<{ jobname?: string | null; command?: string | null }>;
};

const expectedCronSignals = [
	'drain-osm-import-queue',
	'drain-poi-resolution',
	'process-brand-enrichment-jobs',
	'enqueue_due_brand_refreshes',
	'drain-brand-location-geocode'
];

export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('app:admin-home');
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const admin = supabaseAdmin();

	const poiStatuses = [
		'needs_exception_resolution',
		'needs_manual_review',
		'ready_for_enrichment',
		'pending',
		'resolved',
		'resolved_existing',
		'known_negative'
	] as const;
	const enrichmentStatuses = ['queued', 'running', 'failed'] as const;

	const [
		pipelineRuns,
		candidateStatusResult,
		candidateTotalResult,
		reviewCandidatesResult,
		stagingResult,
		reportsResult,
		brandCountResult,
		newBrandCountResult,
		enrichmentJobsResult,
		dossiersResult,
		profilesResult,
		dueRefreshesResult,
		integrityFlagsResult,
		cronStatusResult
	] = await Promise.all([
		loadPipelineRuns(25).catch((error) => ({ error })),
		countByValues(admin, 'poi_candidates', 'process_status', poiStatuses, 'ingest'),
		countExact(admin, 'poi_candidates', 'ingest'),
		loadStorefrontReviewDossiers(locals.supabase, 6, 0),
		locals.supabase
			.schema('ingest')
			.from('brand_staging')
			.select('id,suggested_name,status,source,created_at', { count: 'exact' })
			.in('status', ['pending', 'pending_delete'])
			.order('created_at', { ascending: false })
			.limit(6),
		locals.supabase
			.schema('mod')
			.from('reports')
			.select('id,content_type,reason,status,created_at', { count: 'exact' })
			.eq('status', 'pending')
			.order('created_at', { ascending: false })
			.limit(6),
		locals.supabase.from('brands').select('*', { count: 'exact', head: true }),
		locals.supabase
			.from('brands')
			.select('*', { count: 'exact', head: true })
			.gte('created_at', sevenDaysAgo),
		countByValues(admin, 'brand_enrichment_jobs', 'status', enrichmentStatuses, 'ingest'),
		admin
			.schema('mod')
			.from('brand_dossiers')
			.select('*', { count: 'exact', head: true })
			.eq('approval_status', 'needs_review'),
		locals.supabase.from('brand_profiles').select('*', { count: 'exact', head: true }),
		admin
			.schema('mod')
			.from('brand_dossiers')
			.select('*', { count: 'exact', head: true })
			.lte('refresh_after', new Date().toISOString()),
		admin
			.schema('mod')
			.from('brand_integrity_flags')
			.select('*', { count: 'exact', head: true })
			.neq('status', 'resolved')
			.neq('status', 'closed'),
		locals.supabase.rpc('admin_pipeline_cron_status')
	]);

	const pipelineError =
		pipelineRuns && typeof pipelineRuns === 'object' && 'error' in pipelineRuns
			? (pipelineRuns as { error: { message?: string } | unknown }).error
			: null;
	const pipelineErrorMessage =
		pipelineError && typeof pipelineError === 'object' && 'message' in pipelineError
			? String(pipelineError.message)
			: pipelineError
				? String(pipelineError)
				: null;
	const runs = Array.isArray(pipelineRuns) ? pipelineRuns : [];
	const latestRun = runs[0] ?? null;
	const providerRuns = latestRun ? await loadProviderRuns([latestRun.id]).catch(() => []) : [];
	const shards = latestRun
		? await loadShards(providerRuns.map((run) => run.id)).catch(() => [])
		: [];
	const shardCounts = countByStatus(shards);

	const sourceErrors = [
		['Imports', pipelineErrorMessage],
		[
			'Candidates',
			candidateStatusResult.error ?? candidateTotalResult.error ?? reviewCandidatesResult.error
		],
		['Brand submissions', stagingResult.error],
		['Reports', reportsResult.error],
		['Brands', brandCountResult.error ?? newBrandCountResult.error],
		['Enrichment jobs', enrichmentJobsResult.error],
		['Brand dossiers', dossiersResult.error],
		['Brand profiles', profilesResult.error],
		['Due refreshes', dueRefreshesResult.error],
		['Integrity flags', integrityFlagsResult.error]
	]
		.filter((entry) => entry[1])
		.map(([source]) => String(source));

	const storefrontDossiers = reviewCandidatesResult.dossiers;

	const candidateStatusCounts = candidateStatusResult.counts;
	const stagingRows = (stagingResult.data ?? []) as StagingRow[];
	const reportRows = (reportsResult.data ?? []) as ReportRow[];
	const enrichmentJobStatusCounts = enrichmentJobsResult.counts;
	const cronPayload =
		cronStatusResult.data &&
		typeof cronStatusResult.data === 'object' &&
		!Array.isArray(cronStatusResult.data)
			? (cronStatusResult.data as CronStatusPayload)
			: null;
	const cronSearchText = (cronPayload?.jobs ?? [])
		.map((job) => `${job.jobname ?? ''} ${job.command ?? ''}`.toLowerCase())
		.join('\n');
	const missingCrons = cronStatusResult.error
		? null
		: expectedCronSignals.filter((signal) => !cronSearchText.includes(signal.toLowerCase())).length;

	const activeImportStatuses = ['awaiting_adapters', 'queued', 'running', 'partial'];
	const activeJobs = runs.filter((run) => activeImportStatuses.includes(run.status)).length;
	const failedJobs =
		runs.filter((run) => run.status === 'failed').length + (shardCounts.failed ?? 0);

	return {
		metrics: {
			reviewQueue: storefrontDossiers.length,
			needsReview: storefrontDossiers.length,
			exceptions: candidateStatusCounts.needs_exception_resolution ?? 0,
			activeJobs,
			failedJobs,
			pendingIntake: (stagingResult.count ?? 0) + (reportsResult.count ?? 0),
			pendingBrands: stagingResult.count ?? 0,
			pendingReports: reportsResult.count ?? 0,
			brandCount: brandCountResult.count ?? 0,
			newBrands: newBrandCountResult.count ?? 0,
			totalCandidates: candidateTotalResult.count ?? 0,
			enrichmentQueue:
				(enrichmentJobStatusCounts.queued ?? 0) + (enrichmentJobStatusCounts.running ?? 0),
			failedEnrichmentJobs: enrichmentJobStatusCounts.failed ?? 0,
			dossiersNeedingReview: dossiersResult.count ?? 0,
			publishedProfiles: profilesResult.count ?? 0,
			dueRefreshes: dueRefreshesResult.count ?? 0,
			openIntegrityFlags: integrityFlagsResult.count ?? 0,
			missingCrons
		},
		pipeline: {
			candidateStatusCounts,
			shardCounts
		},
		latestImport: latestRun
			? {
					id: latestRun.id,
					status: latestRun.status,
					scope_label: latestRun.scope_label,
					region_key: latestRun.region_key,
					created_at: latestRun.created_at,
					started_at: latestRun.started_at,
					finished_at: latestRun.completed_at,
					error_text: latestRun.last_error,
					providers: latestRun.requested_providers,
					completedShards:
						(shardCounts.succeeded ?? 0) + (shardCounts.failed ?? 0) + (shardCounts.cancelled ?? 0),
					shardTotal: shards.length
				}
			: null,
		recentImports: runs.slice(0, 5).map((run) => ({
			id: run.id,
			status: run.status,
			scope_label: run.scope_label,
			region_key: run.region_key,
			created_at: run.created_at
		})),
		reviewCandidates: storefrontDossiers.map((dossier) => ({
			id: dossier.id,
			canonical_name:
				dossier.display_address ??
				dossier.address_input ??
				dossier.normalized_address ??
				'Unknown address',
			process_status: dossier.review_reason ?? dossier.status ?? 'needs_review',
			region_key: dossier.region_key ?? null,
			updated_at: dossier.updated_at ?? dossier.created_at ?? new Date().toISOString()
		})),
		stagingRows,
		reportRows,
		sourceErrors
	};
};
