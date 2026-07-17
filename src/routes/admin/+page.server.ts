import type { PageServerLoad } from './$types';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retry_waiting';
type CandidateStatus =
	| 'pending'
	| 'merged'
	| 'approved'
	| 'needs_review'
	| 'blocked'
	| 'rejected';

type JobRow = {
	id: string;
	status: JobStatus;
	job_kind: 'region' | 'tile';
	parent_job_id: string | null;
	region_key: string | null;
	tile_index: number | null;
	total_tiles: number | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
	error_text: string | null;
};

type CandidateSummaryRow = {
	process_status: CandidateStatus;
	llm_review_status: 'pending' | 'processing' | 'reviewed' | 'failed' | null;
	pipeline_state: string;
};

type ReviewCandidateRow = {
	id: string;
	name: string | null;
	process_status: CandidateStatus;
	llm_review_status: string | null;
	match_score: number | null;
	region_key: string | null;
	pipeline_state: string;
	created_at: string;
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

function increment(record: Record<string, number>, key: string) {
	record[key] = (record[key] ?? 0) + 1;
}

export const load: PageServerLoad = async ({ locals }) => {
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

	const [
		jobsResult,
		candidateSummaryResult,
		reviewCandidatesResult,
		stagingResult,
		reportsResult,
		brandCountResult,
		newBrandCountResult
	] = await Promise.all([
		locals.supabase
			.schema('ingest')
			.from('osm_import_jobs')
			.select(
				'id,status,job_kind,parent_job_id,region_key,tile_index,total_tiles,created_at,started_at,finished_at,error_text'
			)
			.order('created_at', { ascending: false })
			.limit(5000),
		locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select('process_status,llm_review_status,pipeline_state')
			.limit(10000),
		locals.supabase
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select('id,name,process_status,llm_review_status,match_score,region_key,pipeline_state,created_at')
			.in('pipeline_state', ['waiting_manual_review', 'waiting_manual_review_after_skip'])
			.order('created_at', { ascending: false })
			.limit(6),
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
			.gte('created_at', sevenDaysAgo)
	]);

	const sourceErrors = [
		['Imports', jobsResult.error],
		['Candidates', candidateSummaryResult.error ?? reviewCandidatesResult.error],
		['Brand submissions', stagingResult.error],
		['Reports', reportsResult.error],
		['Brands', brandCountResult.error ?? newBrandCountResult.error]
	]
		.filter((entry) => entry[1])
		.map(([source]) => String(source));

	for (const result of [
		jobsResult,
		candidateSummaryResult,
		reviewCandidatesResult,
		stagingResult,
		reportsResult,
		brandCountResult,
		newBrandCountResult
	]) {
		if (result.error) console.error('[dashboard]', result.error);
	}

	const jobs = (jobsResult.data ?? []) as JobRow[];
	const candidates = (candidateSummaryResult.data ?? []) as CandidateSummaryRow[];
	const candidateStatusCounts: Record<string, number> = {};
	const llmStatusCounts: Record<string, number> = {};
	const pipelineStateCounts: Record<string, number> = {};
	const jobStatusCounts: Record<string, number> = {};

	for (const row of candidates) {
		increment(candidateStatusCounts, row.process_status);
		increment(pipelineStateCounts, row.pipeline_state);
		if (
			row.pipeline_state === 'waiting_manual_review' ||
			row.pipeline_state === 'waiting_manual_review_after_skip'
		) {
			increment(llmStatusCounts, row.llm_review_status ?? 'unassigned');
		}
	}
	for (const job of jobs) increment(jobStatusCounts, job.status);

	const regionJobs = jobs.filter((job) => job.job_kind === 'region');
	const latestRegionJob = regionJobs[0] ?? null;
	const latestTiles = latestRegionJob
		? jobs.filter((job) => job.parent_job_id === latestRegionJob.id)
		: [];
	const latestTileCounts: Record<string, number> = {};
	for (const tile of latestTiles) increment(latestTileCounts, tile.status);

	const stagingRows = (stagingResult.data ?? []) as StagingRow[];
	const reportRows = (reportsResult.data ?? []) as ReportRow[];

	return {
		metrics: {
			reviewQueue:
				(pipelineStateCounts.waiting_manual_review ?? 0) +
				(pipelineStateCounts.waiting_manual_review_after_skip ?? 0),
			needsReview: pipelineStateCounts.waiting_manual_review ?? 0,
			blocked: pipelineStateCounts.waiting_manual_review_after_skip ?? 0,
			activeJobs:
				(jobStatusCounts.queued ?? 0) +
				(jobStatusCounts.running ?? 0) +
				(jobStatusCounts.retry_waiting ?? 0),
			failedJobs: jobStatusCounts.failed ?? 0,
			pendingIntake: (stagingResult.count ?? 0) + (reportsResult.count ?? 0),
			pendingBrands: stagingResult.count ?? 0,
			pendingReports: reportsResult.count ?? 0,
			brandCount: brandCountResult.count ?? 0,
			newBrands: newBrandCountResult.count ?? 0,
			totalCandidates: candidates.length
		},
		pipeline: {
			candidateStatusCounts,
			llmStatusCounts,
			jobStatusCounts
		},
		latestImport: latestRegionJob
			? {
					...latestRegionJob,
					tileCounts: latestTileCounts,
					completedTiles:
						(latestTileCounts.succeeded ?? 0) +
						(latestTileCounts.failed ?? 0) +
						(latestTileCounts.cancelled ?? 0),
					tileTotal: latestTiles.length || latestRegionJob.total_tiles || 0
				}
			: null,
		recentImports: regionJobs.slice(0, 5),
		reviewCandidates: (reviewCandidatesResult.data ?? []) as ReviewCandidateRow[],
		stagingRows,
		reportRows,
		sourceErrors
	};
};
