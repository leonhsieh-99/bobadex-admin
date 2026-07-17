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
	process_status: OsmCandidateStatus;
	process_reason: string | null;
	match_bucket: string | null;
	llm_review_status: LlmReviewStatus | null;
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
	evidence: string[] | null;
	sources: string[] | null;
	auto_decision: string | null;
	created_at: string;
};

type CronJobRow = {
	jobid: number;
	schedule: string;
	command: string;
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

function increment<T extends string>(record: Record<T, number>, key: T, amount = 1) {
	record[key] = (record[key] ?? 0) + amount;
}

function countBy<T extends string>(items: Array<{ status: T }>) {
	const counts = {} as Record<T, number>;
	for (const item of items) increment(counts, item.status);
	return counts;
}

export const load: PageServerLoad = async ({ locals }) => {
	// Jobs
	const { data: jobs, error: jobsErr } = await locals.supabase
		.schema('ingest')
		.from('osm_import_jobs')
		.select(
			'id,source,status,job_kind,parent_job_id,region_key,tile_index,total_tiles,created_at,started_at,finished_at,stats,note,error_text'
		)
		.order('created_at', { ascending: false })
		.limit(500);
	if (jobsErr) {
		console.error(jobsErr);
		throw error(500, `Failed to load OSM import jobs: ${jobsErr.message}`);
	}

	const jobRows = (jobs ?? []) as JobRow[];
	const regionJobs = jobRows.filter((job) => job.job_kind === 'region');
	const latestRegionJob = regionJobs[0] ?? null;
	const latestTileJobs = latestRegionJob
		? jobRows.filter((job) => job.parent_job_id === latestRegionJob.id)
		: [];

	const [
		{ data: regionCodes },
		{ data: regionBounds },
		{ data: processSummaryRows, error: processSummaryErr },
		{ data: llmReviews, error: llmReviewsErr },
		{ data: cronJobs, error: cronJobsErr },
		{ data: cronRuns, error: cronRunsErr }
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
			.select('process_status,process_reason,match_bucket,llm_review_status')
			.limit(10000),
		locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select(
				'id:llm_review_id,candidate_id:id,model:llm_model,action:llm_action,proposed_brand_slug:llm_proposed_brand_slug,proposed_display:llm_proposed_display,confidence:llm_confidence,reason:llm_reason,evidence:llm_evidence,sources:llm_sources,auto_decision,created_at:llm_review_created_at'
			)
			.not('llm_review_id', 'is', null)
			.order('llm_review_created_at', { ascending: false })
			.limit(250),
		locals.supabase
			.schema('cron')
			.from('job')
			.select('jobid,schedule,command,nodename,active,jobname')
			.order('jobid', { ascending: true }),
		locals.supabase
			.schema('cron')
			.from('job_run_details')
			.select('jobid,status,start_time,end_time,return_message')
			.order('start_time', { ascending: false })
			.limit(20)
	]);

	if (processSummaryErr) {
		console.error(processSummaryErr);
		throw error(500, `Failed to load candidate status summary: ${processSummaryErr.message}`);
	}
	if (llmReviewsErr) {
		console.error(llmReviewsErr);
		throw error(500, `Failed to load LLM review summary: ${llmReviewsErr.message}`);
	}

	const processRows = (processSummaryRows ?? []) as ProcessSummaryRow[];
	const candidateStatusCounts = {} as Record<OsmCandidateStatus, number>;
	const llmReviewStatusCounts = {} as Record<LlmReviewStatus, number>;
	const matchBucketCounts = {} as Record<string, number>;
	const processReasonCounts = new Map<
		string,
		{ status: OsmCandidateStatus; reason: string; count: number }
	>();
	for (const row of processRows) {
		increment(candidateStatusCounts, row.process_status);
		if (row.llm_review_status) increment(llmReviewStatusCounts, row.llm_review_status);
		if (row.match_bucket)
			matchBucketCounts[row.match_bucket] = (matchBucketCounts[row.match_bucket] ?? 0) + 1;
		const reason = row.process_reason ?? 'none';
		const key = `${row.process_status}:${reason}`;
		const current = processReasonCounts.get(key);
		if (current) current.count += 1;
		else processReasonCounts.set(key, { status: row.process_status, reason, count: 1 });
	}

	const reviewRows = (llmReviews ?? []) as LlmReviewRow[];
	const llmActionCounts: Record<string, number> = {};
	const llmAutoDecisionCounts: Record<string, number> = {};
	for (const review of reviewRows) {
		if (review.action) llmActionCounts[review.action] = (llmActionCounts[review.action] ?? 0) + 1;
		if (review.auto_decision) {
			llmAutoDecisionCounts[review.auto_decision] =
				(llmAutoDecisionCounts[review.auto_decision] ?? 0) + 1;
		}
	}

	const cronError = cronJobsErr?.message ?? cronRunsErr?.message ?? null;

	return {
		jobs: jobRows,
		latestRegionJob,
		latestTileJobs,
		jobStatusCounts: countBy(jobRows),
		latestTileStatusCounts: countBy(latestTileJobs),
		regionCodes: (regionCodes ?? []) as RegionCodeRow[],
		regionBounds: (regionBounds ?? []) as RegionBoundsRow[],
		candidateStatusCounts,
		llmReviewStatusCounts,
		matchBucketCounts,
		processReasonCounts: Array.from(processReasonCounts.values()).sort((a, b) => b.count - a.count),
		llmReviews: reviewRows.slice(0, 12),
		llmActionCounts,
		llmAutoDecisionCounts,
		cronJobs: (cronJobs ?? []) as CronJobRow[],
		cronRuns: (cronRuns ?? []) as CronRunRow[],
		cronError
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
		const limit = Number(form.get('limit') ?? 5);
		const { error: invokeErr } = await locals.supabase.functions.invoke('drain-osm-import-queue', {
			body: { limit: Number.isFinite(limit) ? limit : 5 }
		});

		if (invokeErr) {
			throw redirect(
				303,
				`/admin/imports?toast=drain_failed&msg=${encodeURIComponent(invokeErr.message)}`
			);
		}

		throw redirect(303, '/admin/imports?toast=queue_drained');
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

		const { data, error: rpcErr } = await locals.supabase.rpc(
			'admin_apply_auto_osm_llm_reviews',
			{
				p_limit: safeLimit
			}
		);

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
