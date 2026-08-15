// src/routes/admin/imports/+page.server.ts
import type { Actions } from './$types';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type JobRow = {
	id: string;
	source: string | null;
	status: JobStatus;
	job_kind: 'region' | 'tile' | string;
	parent_job_id: string | null;
	region_key: string | null;
	tile_index: number | null;
	total_tiles: number | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	stats: Record<string, number> | null;
	note: string | null;
	error_text: string | null;
};

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retry_waiting';
type LlmReviewStatus = 'pending' | 'processing' | 'reviewed' | 'failed';

type OsmCandidateStatus =
	| 'pending'
	| 'merged'
	| 'approved'
	| 'needs_review'
	| 'blocked'
	| 'rejected';

type RegionCodeRow = {
	code: string;
	country_code: string;
	region_name: string;
};

type RegionBoundsRow = {
	region_code: string;
	south: number;
	west: number;
	north: number;
	east: number;
	grid_rows: number;
	grid_cols: number;
	active: boolean;
};

type ProcessSummaryRow = {
	id: string;
	import_job_id: string | null;
	osm_type: string | null;
	osm_id: number | null;
	name: string | null;
	lat: number | null;
	lon: number | null;
	source: string | null;
	source_key: string | null;
	process_status: OsmCandidateStatus;
	process_reason: string | null;
	match_bucket: string | null;
	matched_brand_slug: string | null;
	llm_review_status: LlmReviewStatus | null;
	llm_review_error: string | null;
	pipeline_state: string;
};

type LlmReviewRow = {
	id: string;
	candidate_id: string;
	import_job_id: string | null;
	model: string | null;
	action: string | null;
	proposed_brand_slug: string | null;
	proposed_display: string | null;
	confidence: number | null;
	reason: string | null;
	evidence: string[] | null;
	sources: string[] | null;
	auto_decision: string | null;
	created_at: string;
};

type CronJobRow = {
	jobid: number;
	schedule: string;
	nodename?: string | null;
	active?: boolean | null;
	jobname?: string | null;
};

type CronRunRow = {
	jobid: number;
	status: string | null;
	start_time: string | null;
	end_time: string | null;
	return_message: string | null;
};

type ImportCronWorker = {
	jobid: number | null;
	jobname: string;
	label: string;
	schedule: string | null;
	configured: boolean;
	active: boolean;
	lastStatus: string | null;
	lastStartedAt: string | null;
	lastEndedAt: string | null;
	lastMessage: string | null;
};

type RegionRunSummary = {
	id: string;
	regionKey: string | null;
	status: JobStatus;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	totalTiles: number;
	tileStatusCounts: Partial<Record<JobStatus, number>>;
	totalElements: number;
	insertedOrUpdated: number;
	skipped: number;
	unchanged: number;
	candidateCount: number;
	candidateStatusCounts: Partial<Record<OsmCandidateStatus, number>>;
	pipelineStateCounts: Record<string, number>;
};

type CountyCoverageRow = {
	place_id: string;
	code: string;
	name: string;
	state_code: string;
	last_full_scan_at: string | null;
	last_import_job_id: string | null;
	fresh_observed_locations: number;
	collection_locations: number;
	qualifying_brands: number;
};

type CountyCoverageSummary = {
	region_code: string | null;
	freshness_months: number;
	minimum_brand_locations: number;
	freshness_cutoff: string;
	county_count: number;
	scanned_count: number;
	latest_full_scan_at: string | null;
	fresh_observed_locations: number;
	collection_locations: number;
	qualifying_brands: number;
	location_geocode: { total: number; resolved: number; missing: number };
	counties: CountyCoverageRow[];
};

const expectedImportCronWorkers = [
	{ nameFragment: 'drain-osm-import', label: 'Tile queue drain' },
	{ nameFragment: 'process-osm-candidates', label: 'Deterministic processing' },
	{ nameFragment: 'score-osm-candidates', label: 'LLM review' },
	{ nameFragment: 'apply-safe-osm-reviews', label: 'Safe LLM auto-apply' },
	{ nameFragment: 'reset-stuck-osm-llm', label: 'Stuck LLM recovery' },
	{ nameFragment: 'drain-brand-location-geocode', label: 'Location geography' }
] as const;

function increment<T extends string>(record: Record<T, number>, key: T, amount = 1) {
	record[key] = (record[key] ?? 0) + amount;
}

function countBy<T extends string>(items: Array<{ status: T }>) {
	const counts = {} as Record<T, number>;
	for (const item of items) increment(counts, item.status);
	return counts;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const { data: regionJobData, error: regionJobsError } = await locals.supabase
		.schema('ingest')
		.from('osm_import_jobs')
		.select(
			'id,source,status,job_kind,parent_job_id,region_key,tile_index,total_tiles,created_at,started_at,finished_at,stats,note,error_text'
		)
		.eq('job_kind', 'region')
		.order('created_at', { ascending: false })
		.limit(25);
	if (regionJobsError) {
		console.error(regionJobsError);
		throw error(500, `Failed to load OSM region imports: ${regionJobsError.message}`);
	}

	const regionJobs = (regionJobData ?? []) as JobRow[];
	const regionJobIds = regionJobs.map((job) => job.id);
	const tileJobs: JobRow[] = [];
	if (regionJobIds.length) {
		const pageSize = 1000;
		for (let offset = 0; offset < 10000; offset += pageSize) {
			const { data: tilePage, error: tileJobsError } = await locals.supabase
				.schema('ingest')
				.from('osm_import_jobs')
				.select(
					'id,source,status,job_kind,parent_job_id,region_key,tile_index,total_tiles,created_at,started_at,finished_at,stats,note,error_text'
				)
				.eq('job_kind', 'tile')
				.in('parent_job_id', regionJobIds)
				.order('created_at', { ascending: false })
				.range(offset, offset + pageSize - 1);
			if (tileJobsError) {
				console.error(tileJobsError);
				throw error(500, `Failed to load OSM tile jobs: ${tileJobsError.message}`);
			}
			const rows = (tilePage ?? []) as JobRow[];
			tileJobs.push(...rows);
			if (rows.length < pageSize) break;
		}
	}

	const jobRows = [...regionJobs, ...tileJobs].sort(
		(left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
	);
	const latestRegionJob = regionJobs[0] ?? null;
	const coverageRegionCode = latestRegionJob?.region_key ?? 'US-CA';
	const latestTileJobs = latestRegionJob
		? tileJobs.filter((job) => job.parent_job_id === latestRegionJob.id)
		: [];
	const latestTileJobIds = new Set(latestTileJobs.map((job) => job.id));

	const processRows: ProcessSummaryRow[] = [];
	const processPageSize = 1000;
	for (let offset = 0; offset < 50000; offset += processPageSize) {
		const { data: processPage, error: processSummaryErr } = await locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select(
				'id,import_job_id,osm_type,osm_id,name,lat,lon,source,source_key,process_status,process_reason,match_bucket,matched_brand_slug,llm_review_status,llm_review_error,pipeline_state'
			)
			.order('id', { ascending: true })
			.range(offset, offset + processPageSize - 1);
		if (processSummaryErr) {
			console.error(processSummaryErr);
			throw error(500, `Failed to load candidate status summary: ${processSummaryErr.message}`);
		}
		const rows = (processPage ?? []) as ProcessSummaryRow[];
		processRows.push(...rows);
		if (rows.length < processPageSize) break;
	}
	const currentProcessRows = processRows.filter(
		(row) => row.import_job_id && latestTileJobIds.has(row.import_job_id)
	);

	const [
		{ data: regionCodes },
		{ data: regionBounds },
		{ data: llmReviews, error: llmReviewsErr },
		{ data: cronStatus, error: cronStatusErr },
		{ data: countyCoverageData, error: countyCoverageErr }
	] = await Promise.all([
		locals.supabase.from('region_codes').select('code,country_code,region_name').order('code', {
			ascending: true
		}),
		locals.supabase
			.from('region_bounds')
			.select('region_code,south,west,north,east,grid_rows,grid_cols,active')
			.order('region_code', { ascending: true }),
		locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select(
				'id:llm_review_id,candidate_id:id,import_job_id,model:llm_model,action:llm_action,proposed_brand_slug:llm_proposed_brand_slug,proposed_display:llm_proposed_display,confidence:llm_confidence,reason:llm_reason,evidence:llm_evidence,sources:llm_sources,auto_decision,created_at:llm_review_created_at'
			)
			.not('llm_review_id', 'is', null)
			.order('llm_review_created_at', { ascending: false })
			.limit(250),
		locals.supabase.rpc('admin_pipeline_cron_status'),
		locals.supabase.rpc('admin_county_location_coverage', {
			p_region_code: coverageRegionCode,
			p_freshness_months: 24,
			p_min_brand_locations: 3
		})
	]);

	if (llmReviewsErr) {
		console.error(llmReviewsErr);
		throw error(500, `Failed to load LLM review summary: ${llmReviewsErr.message}`);
	}

	const candidateStatusCounts = {} as Record<OsmCandidateStatus, number>;
	const pipelineStateCounts: Record<string, number> = {};
	const llmReviewStatusCounts = {} as Record<LlmReviewStatus, number>;
	const matchBucketCounts = {} as Record<string, number>;
	const processReasonCounts = new Map<
		string,
		{ status: OsmCandidateStatus; reason: string; count: number }
	>();
	for (const row of currentProcessRows) {
		increment(candidateStatusCounts, row.process_status);
		increment(pipelineStateCounts, row.pipeline_state);
		if (
			row.pipeline_state === 'not_reviewed_yet' ||
			row.pipeline_state === 'awaiting_current_llm_review'
		) {
			increment(llmReviewStatusCounts, 'pending');
		} else if (row.pipeline_state === 'llm_processing') {
			increment(llmReviewStatusCounts, 'processing');
		} else if (row.pipeline_state === 'llm_failed') {
			increment(llmReviewStatusCounts, 'failed');
		} else if (row.llm_review_status === 'reviewed') {
			increment(llmReviewStatusCounts, 'reviewed');
		}
		if (row.match_bucket)
			matchBucketCounts[row.match_bucket] = (matchBucketCounts[row.match_bucket] ?? 0) + 1;
		const reason = row.process_reason ?? 'none';
		const key = `${row.process_status}:${reason}`;
		const current = processReasonCounts.get(key);
		if (current) current.count += 1;
		else processReasonCounts.set(key, { status: row.process_status, reason, count: 1 });
	}

	const reviewRows = ((llmReviews ?? []) as LlmReviewRow[]).filter(
		(review) => review.import_job_id && latestTileJobIds.has(review.import_job_id)
	);
	const llmActionCounts: Record<string, number> = {};
	const llmAutoDecisionCounts: Record<string, number> = {};
	for (const review of reviewRows) {
		if (review.action) llmActionCounts[review.action] = (llmActionCounts[review.action] ?? 0) + 1;
		if (review.auto_decision) {
			llmAutoDecisionCounts[review.auto_decision] =
				(llmAutoDecisionCounts[review.auto_decision] ?? 0) + 1;
		}
	}

	const cronPayload =
		cronStatus && typeof cronStatus === 'object' && !Array.isArray(cronStatus)
			? (cronStatus as { jobs?: CronJobRow[]; runs?: CronRunRow[] })
			: null;
	const cronJobs = cronPayload?.jobs ?? [];
	const cronRuns = cronPayload?.runs ?? [];
	const cronError = cronStatusErr?.message ?? null;
	if (countyCoverageErr) console.error('[imports] County coverage', countyCoverageErr);
	const countyCoverage = countyCoverageErr
		? null
		: (countyCoverageData as CountyCoverageSummary | null);
	const latestCronRunByJob = new Map<number, CronRunRow>();
	for (const run of cronRuns) {
		if (!latestCronRunByJob.has(run.jobid)) latestCronRunByJob.set(run.jobid, run);
	}
	const importCronWorkers: ImportCronWorker[] = expectedImportCronWorkers.map((expected) => {
		const job = cronJobs.find((item) =>
			(item.jobname ?? '').toLowerCase().includes(expected.nameFragment)
		);
		if (!job) {
			return {
				jobid: null,
				jobname: expected.nameFragment,
				label: expected.label,
				schedule: null,
				configured: false,
				active: false,
				lastStatus: null,
				lastStartedAt: null,
				lastEndedAt: null,
				lastMessage: null
			};
		}

		const jobname = job.jobname ?? `cron job ${job.jobid}`;
		const latestRun = latestCronRunByJob.get(job.jobid);
		return {
			jobid: job.jobid,
			jobname,
			label: expected.label,
			schedule: job.schedule,
			configured: true,
			active: job.active !== false,
			lastStatus: latestRun?.status ?? null,
			lastStartedAt: latestRun?.start_time ?? null,
			lastEndedAt: latestRun?.end_time ?? null,
			lastMessage: latestRun?.return_message ?? null
		};
	});
	const importCronLastActivity =
		importCronWorkers
			.flatMap((worker) => (worker.lastStartedAt ? [worker.lastStartedAt] : []))
			.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
	const importCronConfiguredCount = importCronWorkers.filter((worker) => worker.configured).length;
	const importCronActiveCount = importCronWorkers.filter(
		(worker) => worker.configured && worker.active
	).length;
	const importCronIssueCount = importCronWorkers.filter(
		(worker) =>
			!worker.configured ||
			!worker.active ||
			(worker.lastStatus !== null && worker.lastStatus !== 'succeeded')
	).length;

	const tileParentById = new Map(
		tileJobs.flatMap((job) => (job.parent_job_id ? [[job.id, job.parent_job_id] as const] : []))
	);
	const processRowsByRegion = new Map<string, ProcessSummaryRow[]>();
	for (const row of processRows) {
		const parentId = row.import_job_id ? tileParentById.get(row.import_job_id) : null;
		if (!parentId) continue;
		const rows = processRowsByRegion.get(parentId) ?? [];
		rows.push(row);
		processRowsByRegion.set(parentId, rows);
	}
	const regionRunHistory: RegionRunSummary[] = regionJobs.slice(1, 13).map((regionJob) => {
		const tiles = tileJobs.filter((job) => job.parent_job_id === regionJob.id);
		const candidateRows = processRowsByRegion.get(regionJob.id) ?? [];
		const runCandidateStatusCounts = {} as Record<OsmCandidateStatus, number>;
		const runPipelineStateCounts: Record<string, number> = {};
		for (const row of candidateRows) {
			increment(runCandidateStatusCounts, row.process_status);
			increment(runPipelineStateCounts, row.pipeline_state);
		}
		const sumTileStat = (key: string) =>
			tiles.reduce((total, tile) => total + Number(tile.stats?.[key] ?? 0), 0);
		return {
			id: regionJob.id,
			regionKey: regionJob.region_key,
			status: regionJob.status,
			createdAt: regionJob.created_at,
			startedAt: regionJob.started_at,
			finishedAt: regionJob.finished_at,
			totalTiles: regionJob.total_tiles ?? tiles.length,
			tileStatusCounts: countBy(tiles),
			totalElements: sumTileStat('total_elements'),
			insertedOrUpdated: sumTileStat('inserted_or_updated'),
			skipped: sumTileStat('skipped'),
			unchanged: sumTileStat('unchanged'),
			candidateCount: candidateRows.length,
			candidateStatusCounts: runCandidateStatusCounts,
			pipelineStateCounts: runPipelineStateCounts
		};
	});

	return {
		view: url.searchParams.get('view') === 'history' ? ('history' as const) : ('current' as const),
		jobs: jobRows,
		latestRegionJob,
		latestTileJobs,
		jobStatusCounts: countBy(jobRows),
		latestTileStatusCounts: countBy(latestTileJobs),
		regionCodes: (regionCodes ?? []) as RegionCodeRow[],
		regionBounds: (regionBounds ?? []) as RegionBoundsRow[],
		candidateStatusCounts,
		currentRunCandidates: currentProcessRows,
		pipelineStateCounts,
		llmReviewStatusCounts,
		matchBucketCounts,
		processReasonCounts: Array.from(processReasonCounts.values()).sort((a, b) => b.count - a.count),
		llmReviews: reviewRows.slice(0, 12),
		llmActionCounts,
		llmAutoDecisionCounts,
		cronJobs,
		cronRuns,
		cronError,
		countyCoverage,
		countyCoverageError: countyCoverageErr?.message ?? null,
		regionRunHistory,
		importCronWorkers,
		importCronSummary: {
			expected: expectedImportCronWorkers.length,
			configured: importCronConfiguredCount,
			active: importCronActiveCount,
			issues: importCronIssueCount,
			lastActivity: importCronLastActivity
		}
	};
};

export const actions: Actions = {
	updateGrid: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const regionCode = String(form.get('region_code') ?? '');
		const gridRows = Number(form.get('grid_rows'));
		const gridCols = Number(form.get('grid_cols'));

		if (!regionCode || !Number.isInteger(gridRows) || !Number.isInteger(gridCols)) {
			throw redirect(303, '/admin/imports?toast=grid_failed&msg=invalid_grid');
		}

		const { error: updateErr } = await locals.supabase
			.from('region_bounds')
			.update({ grid_rows: gridRows, grid_cols: gridCols })
			.eq('region_code', regionCode);

		if (updateErr) {
			throw redirect(
				303,
				`/admin/imports?toast=grid_failed&msg=${encodeURIComponent(updateErr.message)}`
			);
		}

		throw redirect(
			303,
			`/admin/imports?toast=grid_updated&region=${encodeURIComponent(regionCode)}`
		);
	},

	startRegionImport: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const regionCode = String(form.get('region_code') ?? '');
		if (!regionCode) throw redirect(303, '/admin/imports?toast=start_failed&msg=missing_region');

		const { data, error: rpcErr } = await locals.supabase.rpc('start_osm_region_import', {
			p_region_code: regionCode
		});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=start_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		const parentJobId = (data as { parent_job_id?: string } | null)?.parent_job_id;
		throw redirect(
			303,
			`/admin/imports?toast=import_started${parentJobId ? `&id=${encodeURIComponent(parentJobId)}` : ''}`
		);
	},

	drainQueue: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const limit = Number(form.get('limit') ?? 2);
		const { error: invokeErr } = await locals.supabase.functions.invoke('drain-osm-import-queue', {
			body: { limit: Number.isFinite(limit) ? Math.max(1, Math.min(2, limit)) : 2 }
		});

		if (invokeErr) {
			throw redirect(
				303,
				`/admin/imports?toast=drain_failed&msg=${encodeURIComponent(invokeErr.message)}`
			);
		}

		throw redirect(303, '/admin/imports?toast=queue_drained');
	},

	retryFailedTiles: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const parentJobId = String(form.get('parent_job_id') ?? '');
		if (!parentJobId) {
			throw redirect(303, '/admin/imports?toast=retry_failed&msg=missing_region_job');
		}

		const { data, error: rpcErr } = await locals.supabase.rpc(
			'admin_retry_failed_osm_import_tiles',
			{ p_parent_job_id: parentJobId }
		);

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=retry_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		const requeued = (data as { requeued_tiles?: number } | null)?.requeued_tiles ?? 0;
		throw redirect(303, `/admin/imports?toast=retry_started&count=${requeued}`);
	},

	processDeterministic: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const limit = Number(form.get('limit') ?? 200);
		const minLocations = Number(form.get('min_locations') ?? 2);

		const { data, error: rpcErr } = await locals.supabase.rpc('process_osm_candidates_batch', {
			p_limit: Number.isFinite(limit) ? limit : 200,
			p_auto_create_min_locations: Number.isFinite(minLocations) ? minLocations : 2
		});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=process_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		const processed = (data as { processed?: number } | null)?.processed;
		throw redirect(
			303,
			`/admin/imports?toast=processed${processed !== undefined ? `&count=${processed}` : ''}`
		);
	},

	runLlmReview: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const limit = Number(form.get('limit') ?? 5);
		const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, limit)) : 5;

		const { data, error: invokeErr } = await locals.supabase.functions.invoke(
			'score-osm-candidates-batch',
			{
				body: { limit: safeLimit }
			}
		);

		if (invokeErr) {
			throw redirect(
				303,
				`/admin/imports?toast=llm_failed&msg=${encodeURIComponent(invokeErr.message)}`
			);
		}

		const claimed = (data as { claimed?: number } | null)?.claimed;
		throw redirect(
			303,
			`/admin/imports?toast=llm_started${claimed !== undefined ? `&count=${claimed}` : ''}`
		);
	},

	resetLlmReview: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const minutes = Number(form.get('minutes') ?? 30);
		const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(1440, minutes)) : 30;

		const { data, error: rpcErr } = await locals.supabase
			.schema('ingest')
			.rpc('reset_stuck_llm_review_candidates', {
				p_after: `${safeMinutes} minutes`
			});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=llm_reset_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		throw redirect(303, `/admin/imports?toast=llm_reset&count=${Number(data ?? 0)}`);
	},

	applyAutoLlmReviews: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const limit = Number(form.get('limit') ?? 25);
		const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(250, limit)) : 25;

		const { data, error: rpcErr } = await locals.supabase.rpc('admin_apply_auto_osm_llm_reviews', {
			p_limit: safeLimit
		});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=auto_apply_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		const rows = Array.isArray(data) ? data : [];
		const applied = rows.filter((row) => (row as { applied?: boolean }).applied).length;
		throw redirect(303, `/admin/imports?toast=auto_applied&count=${applied}`);
	}
};
