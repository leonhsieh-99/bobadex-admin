import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '$lib/supabase.server';

export const PROVIDERS = ['fsq', 'overture', 'osm'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type PipelineStatus =
	| 'awaiting_adapters'
	| 'queued'
	| 'running'
	| 'partial'
	| 'succeeded'
	| 'failed'
	| 'cancelled';

export type ShardStatus =
	| 'planned'
	| 'queued'
	| 'processing'
	| 'retry_waiting'
	| 'succeeded'
	| 'failed'
	| 'cancelled';

export type ResolutionStatus =
	| 'queued'
	| 'processing'
	| 'retry_waiting'
	| 'succeeded'
	| 'failed'
	| 'cancelled';

export type PipelineRunRow = {
	id: string;
	scope_type: string;
	geo_place_id: string | null;
	scope_label: string;
	scope_key: string;
	country_code: string | null;
	region_key: string | null;
	south: number;
	west: number;
	north: number;
	east: number;
	boundary_kind: string;
	boundary_source: string;
	requested_providers: string[];
	status: PipelineStatus;
	checkpoint: Record<string, unknown> | null;
	started_at: string | null;
	completed_at: string | null;
	last_error: string | null;
	created_at: string;
};

export type ProviderRunRow = {
	id: string;
	pipeline_run_id: string;
	provider: Provider;
	status: string;
	adapter_version: string;
	shard_strategy: string;
	records_seen: number;
	records_inserted: number;
	started_at: string | null;
	completed_at: string | null;
	last_error: string | null;
};

export type ShardRow = {
	id: string;
	provider_run_id: string;
	shard_index: number;
	status: ShardStatus;
	attempt_count: number;
	max_attempts: number;
	records_seen: number;
	records_written: number;
	last_error: string | null;
	started_at: string | null;
	completed_at: string | null;
};

export type ResolutionJobRow = {
	id: string;
	pipeline_run_id: string | null;
	candidate_id: string;
	status: ResolutionStatus;
	attempt_count: number;
	last_error: string | null;
	updated_at: string;
};

export type ExceptionRow = {
	id: string;
	canonical_name: string | null;
	region_key: string | null;
	process_status: string;
	process_reason: string | null;
	route_class: string | null;
	updated_at: string;
};

export const expectedImportCronWorkers = [
	{ nameFragment: 'drain-osm-import', label: 'OSM tile drain' },
	{ nameFragment: 'drain-poi-resolution', label: 'Downstream resolution drain' },
	{ nameFragment: 'drain-brand-location-geocode', label: 'Location geography' }
] as const;

export function increment(record: Record<string, number>, key: string, amount = 1) {
	record[key] = (record[key] ?? 0) + amount;
}

export function countByStatus<T extends string>(items: Array<{ status: T }>) {
	const counts: Partial<Record<T, number>> = {};
	for (const item of items) increment(counts as Record<string, number>, item.status);
	return counts;
}

export async function loadPagedRows<T>(
	page: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
	options: { pageSize?: number; maxRows?: number } = {}
) {
	const pageSize = options.pageSize ?? 1000;
	const maxRows = options.maxRows ?? 20000;
	const rows: T[] = [];
	for (let offset = 0; offset < maxRows; offset += pageSize) {
		const { data, error } = await page(offset, offset + pageSize - 1);
		if (error) throw error;
		const batch = data ?? [];
		rows.push(...batch);
		if (batch.length < pageSize) break;
	}
	return rows;
}

export function adminClient() {
	return supabaseAdmin();
}

export async function loadPipelineRuns(limit = 25) {
	const { data, error } = await adminClient()
		.schema('ingest')
		.from('poi_pipeline_runs')
		.select(
			'id,scope_type,geo_place_id,scope_label,scope_key,country_code,region_key,south,west,north,east,boundary_kind,boundary_source,requested_providers,status,checkpoint,started_at,completed_at,last_error,created_at'
		)
		.order('created_at', { ascending: false })
		.limit(limit);
	if (error) throw error;
	return (data ?? []) as PipelineRunRow[];
}

export async function loadProviderRuns(pipelineIds: string[]) {
	if (!pipelineIds.length) return [] as ProviderRunRow[];
	const { data, error } = await adminClient()
		.schema('ingest')
		.from('poi_provider_runs')
		.select(
			'id,pipeline_run_id,provider,status,adapter_version,shard_strategy,records_seen,records_inserted,started_at,completed_at,last_error'
		)
		.in('pipeline_run_id', pipelineIds)
		.order('provider');
	if (error) throw error;
	return (data ?? []) as ProviderRunRow[];
}

export async function loadShards(providerRunIds: string[]) {
	if (!providerRunIds.length) return [] as ShardRow[];
	return loadPagedRows<ShardRow>(async (from, to) => {
		const { data, error } = await adminClient()
			.schema('ingest')
			.from('poi_import_shards')
			.select(
				'id,provider_run_id,shard_index,status,attempt_count,max_attempts,records_seen,records_written,last_error,started_at,completed_at'
			)
			.in('provider_run_id', providerRunIds)
			.order('shard_index')
			.range(from, to);
		return { data: data as ShardRow[] | null, error };
	});
}

export async function loadResolutionJobs(pipelineRunId: string | null) {
	if (!pipelineRunId) return [] as ResolutionJobRow[];
	return loadPagedRows<ResolutionJobRow>(async (from, to) => {
		const { data, error } = await adminClient()
			.schema('ingest')
			.from('poi_resolution_jobs')
			.select('id,pipeline_run_id,candidate_id,status,attempt_count,last_error,updated_at')
			.eq('pipeline_run_id', pipelineRunId)
			.order('updated_at', { ascending: false })
			.range(from, to);
		return { data: data as ResolutionJobRow[] | null, error };
	});
}

export async function reconcileProviderRuns(providerRunIds: string[]) {
	for (const id of providerRunIds) {
		const { error } = await adminClient().schema('ingest').rpc('reconcile_poi_provider_run', {
			p_provider_run_id: id
		});
		if (error) throw error;
	}
}

export async function startAndActivateImport(
	supabase: SupabaseClient,
	input: {
		geoPlaceId: string;
		providers: string[];
	}
) {
	const { data, error } = await supabase.rpc('start_poi_region_import', {
		p_geo_place_id: input.geoPlaceId,
		p_custom_label: null,
		p_country_code: null,
		p_custom_boundary_geojson: null,
		p_providers: input.providers,
		p_dry_run: false
	});
	if (error) throw error;

	const started = data as { pipeline_run_id?: string; provider_runs?: Array<{ id: string }> };
	const pipelineRunId = started.pipeline_run_id;
	if (!pipelineRunId) throw new Error('missing pipeline_run_id');

	const { data: providerRuns, error: providerError } = await adminClient()
		.schema('ingest')
		.from('poi_provider_runs')
		.select('id,provider')
		.eq('pipeline_run_id', pipelineRunId);
	if (providerError) throw providerError;

	for (const providerRun of providerRuns ?? []) {
		const { error: planError } = await adminClient().schema('ingest').rpc('plan_poi_provider_run', {
			p_provider_run_id: providerRun.id,
			p_activate: true
		});
		if (planError) throw planError;
	}

	return pipelineRunId;
}

export function parseProviders(form: FormData) {
	const selected = form
		.getAll('providers')
		.map((value) => String(value).toLowerCase())
		.filter((value): value is Provider => (PROVIDERS as readonly string[]).includes(value));
	return selected.length ? [...new Set(selected)] : [...PROVIDERS];
}
