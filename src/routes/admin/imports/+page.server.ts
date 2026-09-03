import { error, isRedirect, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/supabase.server';
import { countByValues } from '$lib/server/status-counts.server';
import {
	adminClient,
	countByStatus,
	expectedImportCronWorkers,
	loadPipelineRuns,
	loadProviderRuns,
	loadResolutionJobs,
	loadShards,
	parseProviders,
	reconcileProviderRuns,
	startAndActivateImport,
	type ExceptionRow,
	type PipelineRunRow,
	type ProviderRunRow,
	type ShardRow
} from '$lib/server/poi-import.server';

type ImportableRegion = {
	id: string;
	name: string;
	code: string | null;
	level: string;
	south: number;
	west: number;
	north: number;
	east: number;
	boundary_kind: string;
};

type CronJobRow = {
	jobid: number;
	schedule: string;
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

const PAUSEABLE_SHARD_STATUSES = ['planned', 'queued', 'retry_waiting'];
const RETRYABLE_SHARD_STATUSES = ['failed', 'cancelled', 'retry_waiting'];
const PAUSEABLE_RESOLUTION_STATUSES = ['queued', 'retry_waiting'];
const RETRYABLE_RESOLUTION_STATUSES = ['failed', 'cancelled', 'retry_waiting'];
const PAUSEABLE_OSM_STATUSES = ['queued', 'retry_waiting'];
const RETRYABLE_OSM_STATUSES = ['failed', 'cancelled', 'retry_waiting'];

function providerSummaries(providerRuns: ProviderRunRow[], shards: ShardRow[]) {
	return providerRuns.map((run) => {
		const runShards = shards.filter((shard) => shard.provider_run_id === run.id);
		return {
			...run,
			shardStatusCounts: countByStatus(runShards),
			shardTotal: runShards.length,
			failedShards: runShards.filter((shard) => shard.status === 'failed').length,
			activeShards: runShards.filter((shard) =>
				['queued', 'processing', 'retry_waiting', 'planned'].includes(shard.status)
			).length
		};
	});
}

export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:imports');
	const pipelineRuns = await loadPipelineRuns(25).catch((err: { message?: string }) => {
		throw error(500, `Failed to load POI pipeline runs: ${err.message ?? String(err)}`);
	});
	const latestRun = pipelineRuns[0] ?? null;
	const providerRuns = await loadProviderRuns(pipelineRuns.map((run) => run.id)).catch(
		(err: { message?: string }) => {
			throw error(500, `Failed to load provider runs: ${err.message ?? String(err)}`);
		}
	);
	const latestProviderRuns = latestRun
		? providerRuns.filter((run) => run.pipeline_run_id === latestRun.id)
		: [];
	const latestShards = await loadShards(latestProviderRuns.map((run) => run.id)).catch(
		(err: { message?: string }) => {
			throw error(500, `Failed to load import shards: ${err.message ?? String(err)}`);
		}
	);
	const resolutionJobs = await loadResolutionJobs(latestRun?.id ?? null).catch(
		(err: { message?: string }) => {
			throw error(500, `Failed to load resolution jobs: ${err.message ?? String(err)}`);
		}
	);

	const [{ data: regionRows, error: regionError }, { data: cronStatus, error: cronStatusErr }] =
		await Promise.all([
			adminClient()
				.from('geo_places')
				.select(
					'id,name,code,level,geo_place_boundaries!inner(south,west,north,east,boundary_kind)'
				)
				.eq('level', 'admin1')
				.order('name'),
			locals.supabase.rpc('admin_pipeline_cron_status')
		]);
	if (regionError) throw error(500, `Failed to load structured regions: ${regionError.message}`);

	const importableRegions: ImportableRegion[] = (regionRows ?? []).flatMap((row) => {
		const bounds = Array.isArray(row.geo_place_boundaries)
			? row.geo_place_boundaries[0]
			: row.geo_place_boundaries;
		if (!bounds) return [];
		return [
			{
				id: row.id,
				name: row.name,
				code: row.code,
				level: row.level,
				south: bounds.south,
				west: bounds.west,
				north: bounds.north,
				east: bounds.east,
				boundary_kind: bounds.boundary_kind
			}
		];
	});

	const exceptionQuery = adminClient()
		.schema('ingest')
		.from('poi_candidates')
		.select(
			'id,canonical_name,region_key,process_status,process_reason,route_class,updated_at'
		)
		.in('process_status', ['needs_exception_resolution', 'needs_manual_review'])
		.order('updated_at', { ascending: false })
		.limit(50);
	const { data: exceptionRows, error: exceptionError } = latestRun?.region_key
		? await exceptionQuery.eq('region_key', latestRun.region_key)
		: await exceptionQuery;
	if (exceptionError) throw error(500, `Failed to load exceptions: ${exceptionError.message}`);

	const { counts: candidateStatusCounts, error: candidateStatusError } = await countByValues(
		adminClient(),
		'poi_candidates',
		'process_status',
		[
			'needs_exception_resolution',
			'needs_manual_review',
			'ready_for_enrichment',
			'pending',
			'resolved',
			'resolved_existing',
			'known_negative'
		],
		'ingest'
	);
	if (candidateStatusError) {
		throw error(500, `Failed to load candidate statuses: ${candidateStatusError.message}`);
	}

	const cronPayload =
		cronStatus && typeof cronStatus === 'object' && !Array.isArray(cronStatus)
			? (cronStatus as { jobs?: CronJobRow[]; runs?: CronRunRow[] })
			: null;
	const cronJobs = cronPayload?.jobs ?? [];
	const cronRuns = cronPayload?.runs ?? [];
	const latestCronRunByJob = new Map<number, CronRunRow>();
	for (const run of cronRuns) {
		if (!latestCronRunByJob.has(run.jobid)) latestCronRunByJob.set(run.jobid, run);
	}
	const importCronWorkers = expectedImportCronWorkers.map((expected) => {
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
		const latestRun = latestCronRunByJob.get(job.jobid);
		return {
			jobid: job.jobid,
			jobname: job.jobname ?? `cron job ${job.jobid}`,
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

	const failedShards = latestShards.filter((shard) => shard.status === 'failed');
	const historyProviderRuns = providerRuns.filter((run) => run.pipeline_run_id !== latestRun?.id);
	const history = pipelineRuns.slice(1, 13).map((run) => ({
		...run,
		providers: providerSummaries(
			historyProviderRuns.filter((provider) => provider.pipeline_run_id === run.id),
			[]
		)
	}));

	return {
		view: url.searchParams.get('view') === 'history' ? ('history' as const) : ('current' as const),
		latestRun,
		importableRegions,
		latestProviders: providerSummaries(latestProviderRuns, latestShards),
		latestShardStatusCounts: countByStatus(latestShards),
		failedShards: failedShards.slice(0, 25),
		resolutionStatusCounts: countByStatus(resolutionJobs),
		failedResolutionJobs: resolutionJobs
			.filter((job) => job.status === 'failed')
			.slice(0, 15),
		exceptions: (exceptionRows ?? []) as ExceptionRow[],
		candidateStatusCounts,
		regionRunHistory: history,
		importCronWorkers,
		importCronSummary: {
			expected: expectedImportCronWorkers.length,
			configured: importCronWorkers.filter((worker) => worker.configured).length,
			active: importCronWorkers.filter((worker) => worker.configured && worker.active).length,
			issues: importCronWorkers.filter(
				(worker) =>
					!worker.configured ||
					!worker.active ||
					(worker.lastStatus !== null && worker.lastStatus !== 'succeeded')
			).length,
			lastActivity:
				importCronWorkers
					.flatMap((worker) => (worker.lastStartedAt ? [worker.lastStartedAt] : []))
					.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
		},
		cronError: cronStatusErr?.message ?? null
	};
};

async function requirePipeline(pipelineRunId: string) {
	const { data, error: queryError } = await adminClient()
		.schema('ingest')
		.from('poi_pipeline_runs')
		.select('id,status')
		.eq('id', pipelineRunId)
		.maybeSingle();
	if (queryError || !data) throw new Error(queryError?.message ?? 'pipeline_run_not_found');
	return data as Pick<PipelineRunRow, 'id' | 'status'>;
}

export const actions: Actions = {
	startRegionImport: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const geoPlaceId = String(form.get('geo_place_id') ?? '').trim();
		if (!geoPlaceId) throw redirect(303, '/admin/imports?toast=start_failed&msg=missing_region');
		try {
			const pipelineRunId = await startAndActivateImport(locals.supabase, {
				geoPlaceId,
				providers: parseProviders(form)
			});
			throw redirect(
				303,
				`/admin/imports?toast=import_started&id=${encodeURIComponent(pipelineRunId)}`
			);
		} catch (err) {
			if (isRedirect(err)) throw err;
			const message =
				err instanceof Error
					? err.message
					: typeof err === 'object' && err && 'message' in err
						? String((err as { message: string }).message)
						: 'import_start_failed';
			throw redirect(303, `/admin/imports?toast=start_failed&msg=${encodeURIComponent(message)}`);
		}
	},

	pauseImport: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const pipelineRunId = String(form.get('pipeline_run_id') ?? '').trim();
		if (!pipelineRunId) throw redirect(303, '/admin/imports?toast=pause_failed&msg=missing_run');
		try {
			await requirePipeline(pipelineRunId);
			const providerRuns = await loadProviderRuns([pipelineRunId]);
			const providerRunIds = providerRuns.map((run) => run.id);
			if (providerRunIds.length) {
				const { error: shardError } = await adminClient()
					.schema('ingest')
					.from('poi_import_shards')
					.update({ status: 'cancelled', updated_at: new Date().toISOString() })
					.in('provider_run_id', providerRunIds)
					.in('status', PAUSEABLE_SHARD_STATUSES);
				if (shardError) throw shardError;
			}
			const { error: resolutionError } = await adminClient()
				.schema('ingest')
				.from('poi_resolution_jobs')
				.update({ status: 'cancelled', updated_at: new Date().toISOString() })
				.eq('pipeline_run_id', pipelineRunId)
				.in('status', PAUSEABLE_RESOLUTION_STATUSES);
			if (resolutionError) throw resolutionError;
			const { error: osmError } = await adminClient()
				.schema('ingest')
				.from('osm_import_jobs')
				.update({
					status: 'cancelled',
					finished_at: new Date().toISOString()
				})
				.eq('pipeline_run_id', pipelineRunId)
				.in('status', PAUSEABLE_OSM_STATUSES);
			if (osmError) throw osmError;
			await reconcileProviderRuns(providerRunIds);
			throw redirect(303, '/admin/imports?toast=import_paused');
		} catch (err) {
			if (isRedirect(err)) throw err;
			const message =
				err instanceof Error
					? err.message
					: typeof err === 'object' && err && 'message' in err
						? String((err as { message: string }).message)
						: 'pause_failed';
			throw redirect(303, `/admin/imports?toast=pause_failed&msg=${encodeURIComponent(message)}`);
		}
	},

	retryFailed: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const pipelineRunId = String(form.get('pipeline_run_id') ?? '').trim();
		if (!pipelineRunId) throw redirect(303, '/admin/imports?toast=retry_failed&msg=missing_run');
		try {
			await requirePipeline(pipelineRunId);
			const providerRuns = await loadProviderRuns([pipelineRunId]);
			const providerRunIds = providerRuns.map((run) => run.id);
			const shards = await loadShards(providerRunIds);
			const retryShards = shards.filter((shard) =>
				RETRYABLE_SHARD_STATUSES.includes(shard.status)
			);
			for (const shard of retryShards) {
				const { error: shardError } = await adminClient()
					.schema('ingest')
					.from('poi_import_shards')
					.update({
						status: 'queued',
						available_at: new Date().toISOString(),
						completed_at: null,
						lease_token: null,
						lease_expires_at: null,
						last_error: null,
						max_attempts: Math.max(shard.max_attempts, shard.attempt_count + 2),
						updated_at: new Date().toISOString()
					})
					.eq('id', shard.id);
				if (shardError) throw shardError;
			}
			const { error: resolutionError } = await adminClient()
				.schema('ingest')
				.from('poi_resolution_jobs')
				.update({
					status: 'queued',
					available_at: new Date().toISOString(),
					completed_at: null,
					lease_token: null,
					lease_expires_at: null,
					last_error: null,
					updated_at: new Date().toISOString()
				})
				.eq('pipeline_run_id', pipelineRunId)
				.in('status', RETRYABLE_RESOLUTION_STATUSES);
			if (resolutionError) throw resolutionError;
			const { error: osmError } = await adminClient()
				.schema('ingest')
				.from('osm_import_jobs')
				.update({
					status: 'queued',
					error_text: null,
					started_at: null,
					finished_at: null
				})
				.eq('pipeline_run_id', pipelineRunId)
				.in('status', RETRYABLE_OSM_STATUSES);
			if (osmError) throw osmError;
			await reconcileProviderRuns(providerRunIds);
			throw redirect(303, `/admin/imports?toast=retry_started&count=${retryShards.length}`);
		} catch (err) {
			if (isRedirect(err)) throw err;
			const message =
				err instanceof Error
					? err.message
					: typeof err === 'object' && err && 'message' in err
						? String((err as { message: string }).message)
						: 'retry_failed';
			throw redirect(303, `/admin/imports?toast=retry_failed&msg=${encodeURIComponent(message)}`);
		}
	},

	drainOsmQueue: async ({ request, locals }) => {
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

	processReady: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');
		const form = await request.formData();
		const limit = Number(form.get('limit') ?? 25);
		const { data, error: rpcErr } = await supabaseAdmin().rpc('process_ready_poi_candidates_batch', {
			p_limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 25
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
	}
};
