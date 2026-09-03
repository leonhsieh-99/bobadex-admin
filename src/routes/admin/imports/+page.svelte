<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import GeoPlaceTypeahead from '$lib/GeoPlaceTypeahead.svelte';
	import type { SubmitFunction } from './$types';

	type PipelineStatus =
		| 'awaiting_adapters'
		| 'queued'
		| 'running'
		| 'partial'
		| 'succeeded'
		| 'failed'
		| 'cancelled';

	export let data: {
		view: 'current' | 'history';
		latestRun: {
			id: string;
			scope_label: string;
			region_key: string | null;
			country_code: string | null;
			status: PipelineStatus;
			requested_providers: string[];
			south: number;
			west: number;
			north: number;
			east: number;
			boundary_kind: string;
			last_error: string | null;
			created_at: string;
			started_at: string | null;
			completed_at: string | null;
			geo_place_id: string | null;
		} | null;
		importableRegions: Array<{
			id: string;
			name: string;
			code: string | null;
			south: number;
			west: number;
			north: number;
			east: number;
			boundary_kind: string;
		}>;
		latestProviders: Array<{
			id: string;
			provider: string;
			status: string;
			adapter_version: string;
			shard_strategy: string;
			records_seen: number;
			records_inserted: number;
			last_error: string | null;
			shardStatusCounts: Partial<Record<string, number>>;
			shardTotal: number;
			failedShards: number;
			activeShards: number;
		}>;
		latestShardStatusCounts: Partial<Record<string, number>>;
		failedShards: Array<{
			id: string;
			provider_run_id: string;
			shard_index: number;
			status: string;
			attempt_count: number;
			max_attempts: number;
			last_error: string | null;
		}>;
		resolutionStatusCounts: Partial<Record<string, number>>;
		failedResolutionJobs: Array<{
			id: string;
			candidate_id: string;
			status: string;
			attempt_count: number;
			last_error: string | null;
		}>;
		exceptions: Array<{
			id: string;
			canonical_name: string | null;
			region_key: string | null;
			process_status: string;
			process_reason: string | null;
			route_class: string | null;
			updated_at: string;
		}>;
		candidateStatusCounts: Record<string, number>;
		regionRunHistory: Array<{
			id: string;
			scope_label: string;
			region_key: string | null;
			status: PipelineStatus;
			created_at: string;
			started_at: string | null;
			completed_at: string | null;
			last_error: string | null;
			providers: Array<{
				provider: string;
				status: string;
				records_seen: number;
				records_inserted: number;
				shardTotal: number;
				failedShards: number;
			}>;
		}>;
		importCronWorkers: Array<{
			jobid: number | null;
			jobname: string;
			label: string;
			schedule: string | null;
			configured: boolean;
			active: boolean;
			lastStatus: string | null;
			lastStartedAt: string | null;
			lastMessage: string | null;
		}>;
		importCronSummary: {
			expected: number;
			configured: number;
			active: number;
			issues: number;
			lastActivity: string | null;
		};
		cronError: string | null;
	};

	const california =
		data.importableRegions.find((region) => region.code === 'US-CA') ?? data.importableRegions[0];
	let selectedRegionId = data.latestRun?.geo_place_id ?? california?.id ?? '';
	let selectedRegionLabel =
		data.importableRegions.find((region) => region.id === selectedRegionId)?.name ??
		data.latestRun?.scope_label ??
		'';
	let selectedProviders = ['fsq', 'overture', 'osm'];

	$: selectedRegion =
		data.importableRegions.find((region) => region.id === selectedRegionId) ?? null;
	$: shardTotal = Object.values(data.latestShardStatusCounts).reduce(
		(sum: number, value) => sum + (value ?? 0),
		0
	);
	$: shardDone =
		(data.latestShardStatusCounts.succeeded ?? 0) + (data.latestShardStatusCounts.failed ?? 0);
	$: shardPercent = shardTotal ? Math.round((shardDone / shardTotal) * 100) : 0;
	$: runIsActive =
		!!data.latestRun &&
		['awaiting_adapters', 'queued', 'running', 'partial'].includes(data.latestRun.status);
	$: failedCount =
		(data.latestShardStatusCounts.failed ?? 0) + (data.resolutionStatusCounts.failed ?? 0);

	const enhancePipelineAction: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { keepFocus: true, noScroll: true });
				await invalidate('app:imports');
				return;
			}
			await applyAction(result);
		};
	};

	onMount(() => {
		const refreshTimer = window.setInterval(() => {
			if (data.view === 'current' && runIsActive) void invalidate('app:imports');
		}, 20_000);
		return () => window.clearInterval(refreshTimer);
	});

	function formatNumber(value: number | null | undefined) {
		return new Intl.NumberFormat().format(value ?? 0);
	}

	function formatDate(value: string | null | undefined) {
		return value ? new Date(value).toLocaleString() : '—';
	}

	function shortId(value: string | null | undefined) {
		return value ? value.slice(0, 8) : '—';
	}

	function providerLabel(provider: string) {
		if (provider === 'fsq') return 'Foursquare';
		if (provider === 'overture') return 'Overture';
		if (provider === 'osm') return 'OpenStreetMap';
		return provider;
	}

	function providerPercent(provider: (typeof data.latestProviders)[number]) {
		const done =
			(provider.shardStatusCounts.succeeded ?? 0) + (provider.shardStatusCounts.failed ?? 0);
		return provider.shardTotal ? Math.round((done / provider.shardTotal) * 100) : 0;
	}

	function statusClass(status: string) {
		if (status === 'succeeded') return 'bg-emerald-100 text-emerald-800';
		if (status === 'failed') return 'bg-rose-100 text-rose-800';
		if (status === 'running' || status === 'processing') return 'bg-blue-100 text-blue-800';
		if (status === 'partial' || status === 'retry_waiting') return 'bg-amber-100 text-amber-800';
		if (status === 'cancelled') return 'bg-zinc-200 text-zinc-700';
		return 'bg-gray-100 text-gray-800';
	}

	function toggleProvider(provider: string) {
		selectedProviders = selectedProviders.includes(provider)
			? selectedProviders.filter((item) => item !== provider)
			: [...selectedProviders, provider];
	}
</script>

<svelte:head><title>Imports | Bobadex Admin</title></svelte:head>

<main class="mx-auto max-w-6xl space-y-8 px-4 py-6">
	<header class="border-b border-gray-200 pb-5">
		<p class="text-xs font-semibold tracking-wide text-teal-700 uppercase">
			FSQ → Overture → OSM
		</p>
		<h1 class="mt-1 text-2xl font-semibold text-gray-950">Import control center</h1>
		<p class="mt-2 max-w-3xl text-sm text-gray-600">
			Start a structured-region import, watch each provider drain, then review exceptions and
			retry failed shards without touching the old OSM-only queue.
		</p>
	</header>

	<nav class="flex gap-1 border-b border-gray-200" aria-label="Import views">
		<a
			class={`border-b-2 px-3 py-2 text-sm ${data.view === 'current' ? 'border-gray-950 font-semibold text-gray-950' : 'border-transparent text-gray-600 hover:text-gray-950'}`}
			href="/admin/imports"
		>
			<span class="inline-flex items-center gap-2">
				{#if runIsActive}
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"></span>
				{/if}
				Current run
			</span>
		</a>
		<a
			class={`border-b-2 px-3 py-2 text-sm ${data.view === 'history' ? 'border-gray-950 font-semibold text-gray-950' : 'border-transparent text-gray-600 hover:text-gray-950'}`}
			href="/admin/imports?view=history"
		>
			History
		</a>
	</nav>

	{#if data.view === 'current'}
		<section class="grid grid-cols-2 gap-3 lg:grid-cols-6">
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Queued shards</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(
						(data.latestShardStatusCounts.queued ?? 0) +
							(data.latestShardStatusCounts.planned ?? 0)
					)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Processing</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(
						(data.latestShardStatusCounts.processing ?? 0) +
							(data.latestShardStatusCounts.retry_waiting ?? 0)
					)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Succeeded</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.latestShardStatusCounts.succeeded)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Failed jobs</div>
				<div class="mt-1 text-2xl font-semibold">{formatNumber(failedCount)}</div>
			</div>
			<a class="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50" href="/admin/reviews">
				<div class="text-xs text-gray-500">Exceptions</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(
						(data.candidateStatusCounts.needs_exception_resolution ?? 0) +
							(data.candidateStatusCounts.needs_manual_review ?? 0)
					)}
				</div>
			</a>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Resolution queue</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(
						(data.resolutionStatusCounts.queued ?? 0) +
							(data.resolutionStatusCounts.processing ?? 0) +
							(data.resolutionStatusCounts.retry_waiting ?? 0)
					)}
				</div>
			</div>
		</section>

		<section class="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">1. Structured region</h2>
				<p class="mt-1 text-sm text-gray-500">
					Only places with a stored polygon can start an import. US states are ready today.
				</p>

				<div class="mt-4 grid gap-3 sm:grid-cols-2">
					<label class="block sm:col-span-2">
						<span class="text-xs font-medium text-gray-600">Search</span>
						<div class="mt-1">
							<GeoPlaceTypeahead
								level="admin1"
								importable={true}
								value={selectedRegionLabel}
								selectedId={selectedRegionId || null}
								onselect={(place) => {
									selectedRegionId = place.place_id;
									selectedRegionLabel = place.display_name;
								}}
								onclear={() => {
									selectedRegionId = '';
									selectedRegionLabel = '';
								}}
							/>
						</div>
					</label>
					<label class="block sm:col-span-2">
						<span class="text-xs font-medium text-gray-600">Or choose from the catalog</span>
						<select
							class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
							bind:value={selectedRegionId}
							onchange={() => {
								selectedRegionLabel = selectedRegion?.name ?? '';
							}}
						>
							{#each data.importableRegions as region}
								<option value={region.id}>{region.name} ({region.code})</option>
							{/each}
						</select>
					</label>
				</div>

				{#if selectedRegion}
					<p class="mt-3 text-xs text-gray-600">
						{selectedRegion.boundary_kind} boundary · {selectedRegion.south.toFixed(2)}, {selectedRegion.west.toFixed(
							2
						)}
						to {selectedRegion.north.toFixed(2)}, {selectedRegion.east.toFixed(2)}
					</p>
				{/if}

				<div class="mt-4 flex flex-wrap gap-3 text-sm">
					{#each ['fsq', 'overture', 'osm'] as provider}
						<label class="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2">
							<input
								type="checkbox"
								checked={selectedProviders.includes(provider)}
								onchange={() => toggleProvider(provider)}
							/>
							{providerLabel(provider)}
						</label>
					{/each}
				</div>

				<form method="POST" action="?/startRegionImport" class="mt-4" use:enhance={enhancePipelineAction}>
					<input type="hidden" name="geo_place_id" value={selectedRegionId} />
					{#each selectedProviders as provider}
						<input type="hidden" name="providers" value={provider} />
					{/each}
					<button
						class="rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
						disabled={!selectedRegionId || selectedProviders.length === 0 || runIsActive}
					>
						Start import
					</button>
					{#if runIsActive}
						<p class="mt-2 text-xs text-amber-700">Wait for the current run to finish or pause it first.</p>
					{/if}
				</form>
			</div>

			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">Latest region run</h2>
				{#if data.latestRun}
					<div class="mt-3 space-y-3">
						<div class="flex items-center justify-between gap-3">
							<div>
								<div class="text-sm font-medium">{data.latestRun.scope_label}</div>
								<div class="text-xs text-gray-500">
									{data.latestRun.region_key ?? data.latestRun.country_code ?? 'custom'} · {shortId(
										data.latestRun.id
									)}
								</div>
							</div>
							<span class={`rounded-full px-2.5 py-1 text-xs ${statusClass(data.latestRun.status)}`}>
								{data.latestRun.status.replaceAll('_', ' ')}
							</span>
						</div>
						<div class="h-2 overflow-hidden rounded-full bg-gray-100">
							<div class="h-full bg-emerald-500" style={`width: ${shardPercent}%`}></div>
						</div>
						<p class="text-xs text-gray-500">
							Created {formatDate(data.latestRun.created_at)} · {formatNumber(shardDone)} / {formatNumber(
								shardTotal
							)} shards complete
						</p>
						{#if data.latestRun.last_error}
							<p class="text-xs text-rose-700">{data.latestRun.last_error}</p>
						{/if}
						<div class="flex flex-col gap-2 sm:flex-row">
							<form method="POST" action="?/pauseImport" class="flex-1" use:enhance={enhancePipelineAction}>
								<input type="hidden" name="pipeline_run_id" value={data.latestRun.id} />
								<button
									class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
									disabled={!runIsActive}
								>
									Pause unstarted work
								</button>
							</form>
							<form method="POST" action="?/retryFailed" class="flex-1" use:enhance={enhancePipelineAction}>
								<input type="hidden" name="pipeline_run_id" value={data.latestRun.id} />
								<button
									class="w-full rounded-md border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
									disabled={failedCount === 0 && (data.latestShardStatusCounts.cancelled ?? 0) === 0}
								>
									Retry failed jobs
								</button>
							</form>
						</div>
					</div>
				{:else}
					<p class="mt-3 text-sm text-gray-500">No region import has been started yet.</p>
				{/if}
			</div>
		</section>

		<section class="rounded-xl border border-gray-200 bg-white p-5">
			<h2 class="text-lg font-semibold text-gray-950">2. Provider drain</h2>
			<p class="mt-1 text-sm text-gray-500">
				Foursquare must finish before Overture shards are claimed. OSM drains through the existing
				tile worker.
			</p>
			<div class="mt-4 grid gap-4 md:grid-cols-3">
				{#each data.latestProviders as provider}
					<article class="rounded-lg border border-gray-200 p-4">
						<div class="flex items-center justify-between gap-2">
							<h3 class="text-sm font-semibold">{providerLabel(provider.provider)}</h3>
							<span class={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(provider.status)}`}>
								{provider.status.replaceAll('_', ' ')}
							</span>
						</div>
						<div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
							<div class="h-full bg-blue-600" style={`width: ${providerPercent(provider)}%`}></div>
						</div>
						<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
							<div>Shards {provider.shardTotal}</div>
							<div class="text-right">Failed {provider.failedShards}</div>
							<div>Seen {formatNumber(provider.records_seen)}</div>
							<div class="text-right">Written {formatNumber(provider.records_inserted)}</div>
						</div>
						<p class="mt-2 truncate text-[11px] text-gray-500" title={provider.shard_strategy}>
							{provider.adapter_version}
						</p>
						{#if provider.last_error}
							<p class="mt-2 line-clamp-2 text-xs text-rose-700">{provider.last_error}</p>
						{/if}
					</article>
				{/each}
				{#if data.latestProviders.length === 0}
					<p class="text-sm text-gray-500">Provider runs appear after an import is started.</p>
				{/if}
			</div>

			<div class="mt-5 flex flex-wrap gap-3">
				<form method="POST" action="?/drainOsmQueue" class="flex items-end gap-2" use:enhance={enhancePipelineAction}>
					<label>
						<span class="text-xs font-medium text-gray-600">OSM drain batch</span>
						<input
							name="limit"
							type="number"
							min="1"
							max="2"
							value="2"
							class="mt-1 w-20 rounded-md border-gray-300 px-2 py-1.5 text-sm"
						/>
					</label>
					<button class="rounded-md bg-gray-950 px-3 py-1.5 text-sm font-semibold text-white">
						Drain OSM tiles
					</button>
				</form>
				<form method="POST" action="?/processReady" class="flex items-end gap-2" use:enhance={enhancePipelineAction}>
					<label>
						<span class="text-xs font-medium text-gray-600">Ready candidates</span>
						<input
							name="limit"
							type="number"
							min="1"
							max="100"
							value="25"
							class="mt-1 w-24 rounded-md border-gray-300 px-2 py-1.5 text-sm"
						/>
					</label>
					<button class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold">
						Process ready
					</button>
				</form>
			</div>
		</section>

		<section class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">3. Downstream resolution</h2>
				<div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
					<div class="rounded-md bg-gray-50 p-2">
						queued<br /><b>{data.resolutionStatusCounts.queued ?? 0}</b>
					</div>
					<div class="rounded-md bg-blue-50 p-2">
						processing<br /><b>{data.resolutionStatusCounts.processing ?? 0}</b>
					</div>
					<div class="rounded-md bg-rose-50 p-2">
						failed<br /><b>{data.resolutionStatusCounts.failed ?? 0}</b>
					</div>
				</div>
				<div class="mt-4 space-y-2">
					{#each data.failedResolutionJobs as job}
						<div class="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
							<div class="font-mono">{shortId(job.candidate_id)}</div>
							<div class="mt-1 line-clamp-2">{job.last_error ?? 'Failed without a message'}</div>
						</div>
					{/each}
					{#if data.failedResolutionJobs.length === 0}
						<p class="text-sm text-gray-500">No failed resolution jobs on this run.</p>
					{/if}
				</div>
			</div>

			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h2 class="text-lg font-semibold text-gray-950">4. Exceptions</h2>
						<p class="mt-1 text-sm text-gray-500">
							Candidates that need a human decision after provider drain.
						</p>
					</div>
					<a class="text-sm font-semibold text-gray-800 hover:underline" href="/admin/reviews">
						Open queue
					</a>
				</div>
				<div class="mt-4 divide-y rounded-lg border border-gray-200">
					{#each data.exceptions.slice(0, 8) as exception}
						<a
							class="block p-3 hover:bg-gray-50"
							href={`/admin/reviews?tab=manual&q=${encodeURIComponent(exception.canonical_name ?? '')}`}
						>
							<div class="flex items-center justify-between gap-2">
								<div class="truncate text-sm font-medium">
									{exception.canonical_name ?? 'Unnamed candidate'}
								</div>
								<span class={`rounded px-2 py-0.5 text-[11px] ${statusClass(exception.process_status)}`}>
									{exception.process_status.replaceAll('_', ' ')}
								</span>
							</div>
							<p class="mt-1 truncate text-xs text-gray-500">
								{exception.region_key ?? 'Unknown region'} · {exception.process_reason ??
									exception.route_class ??
									'No reason'}
							</p>
						</a>
					{/each}
					{#if data.exceptions.length === 0}
						<div class="p-4 text-sm text-gray-500">No exceptions for this region.</div>
					{/if}
				</div>
			</div>
		</section>

		{#if data.failedShards.length}
			<section class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">Failed shards</h2>
				<div class="mt-3 overflow-auto">
					<table class="min-w-full text-left text-sm">
						<thead class="text-xs text-gray-500">
							<tr>
								<th class="px-3 py-2 font-medium">Shard</th>
								<th class="px-3 py-2 font-medium">Attempts</th>
								<th class="px-3 py-2 font-medium">Error</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100">
							{#each data.failedShards as shard}
								<tr>
									<td class="px-3 py-2 font-mono text-xs">{shard.shard_index}</td>
									<td class="px-3 py-2">{shard.attempt_count}/{shard.max_attempts}</td>
									<td class="max-w-xl px-3 py-2 text-xs text-rose-700">
										{shard.last_error ?? '—'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		<section class="rounded-xl border border-gray-200 bg-white p-5">
			<h2 class="text-lg font-semibold text-gray-950">Automation</h2>
			{#if data.cronError}
				<p class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
					Cron status is unavailable: {data.cronError}
				</p>
			{:else}
				<div class="mt-4 grid grid-cols-3 divide-x divide-gray-200 border-y border-gray-200 py-3 text-sm">
					<div class="px-3 first:pl-0">
						<div class="text-xs text-gray-500">Overall</div>
						<div class="mt-1 font-semibold">
							{data.importCronSummary.issues ? 'Needs attention' : 'Healthy'}
						</div>
					</div>
					<div class="px-3">
						<div class="text-xs text-gray-500">Active workers</div>
						<div class="mt-1 font-semibold">
							{data.importCronSummary.active} / {data.importCronSummary.expected}
						</div>
					</div>
					<div class="px-3 pr-0">
						<div class="text-xs text-gray-500">Last activity</div>
						<div class="mt-1 truncate font-semibold">{formatDate(data.importCronSummary.lastActivity)}</div>
					</div>
				</div>
				<div class="mt-4 space-y-3">
					{#each data.importCronWorkers as worker}
						<div class="rounded-md border border-gray-200 px-3 py-3">
							<div class="flex items-start justify-between gap-3">
								<div>
									<div class="text-sm font-semibold">{worker.label}</div>
									<div class="mt-1 text-xs text-gray-500">{worker.jobname}</div>
								</div>
								<span class={`rounded-full px-2 py-0.5 text-xs ${statusClass(worker.lastStatus ?? 'pending')}`}>
									{worker.configured
										? worker.active
											? (worker.lastStatus ?? 'awaiting first run')
											: 'inactive'
										: 'missing'}
								</span>
							</div>
							{#if worker.lastMessage && worker.lastStatus !== 'succeeded'}
								<p class="mt-2 line-clamp-2 text-xs text-rose-700">{worker.lastMessage}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<section>
			<h2 class="text-lg font-semibold text-gray-950">Region import history</h2>
			<div class="mt-4 space-y-4">
				{#each data.regionRunHistory as run}
					<article class="overflow-hidden rounded-lg border border-gray-200 bg-white">
						<header class="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
							<div>
								<h3 class="font-semibold">{run.scope_label}</h3>
								<div class="mt-1 font-mono text-xs text-gray-500">{shortId(run.id)}</div>
							</div>
							<span class={`rounded-full px-2 py-0.5 text-xs ${statusClass(run.status)}`}>
								{run.status}
							</span>
						</header>
						<div class="grid gap-4 p-4 md:grid-cols-3">
							{#each run.providers as provider}
								<div class="text-sm">
									<div class="font-medium">{providerLabel(provider.provider)}</div>
									<div class="mt-1 text-xs text-gray-600">
										{provider.status} · {provider.records_seen} seen · {provider.failedShards} failed
									</div>
								</div>
							{/each}
							{#if run.providers.length === 0}
								<p class="text-sm text-gray-500">No provider summaries stored for this run.</p>
							{/if}
						</div>
					</article>
				{/each}
				{#if data.regionRunHistory.length === 0}
					<div class="rounded-lg border border-gray-200 bg-white px-6 py-14 text-center text-sm text-gray-500">
						The first completed campaign will appear here.
					</div>
				{/if}
			</div>
		</section>
	{/if}
</main>
