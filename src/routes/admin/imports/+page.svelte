<!-- src/routes/admin/imports/+page.svelte -->
<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { coordinatesLabel, googleMapsCoordinatesUrl } from '$lib/maps';
	import type { SubmitFunction } from './$types';

	type OsmCandidateStatus =
		| 'pending'
		| 'merged'
		| 'approved'
		| 'needs_review'
		| 'blocked'
		| 'rejected';
	type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'retry_waiting';
	type LlmReviewStatus = 'pending' | 'processing' | 'reviewed' | 'failed';

	export let data: {
		view: 'current' | 'history';
		jobs: Array<{
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
		}>;
		latestRegionJob: {
			id: string;
			status: JobStatus;
			region_key: string | null;
			total_tiles: number | null;
			created_at: string;
			started_at: string | null;
			finished_at: string | null;
		} | null;
		latestTileJobs: Array<{ id: string; status: JobStatus }>;
		jobStatusCounts: Partial<Record<JobStatus, number>>;
		latestTileStatusCounts: Partial<Record<JobStatus, number>>;
		regionCodes: Array<{
			code: string;
			country_code: string;
			region_name: string;
		}>;
		regionBounds: Array<{
			region_code: string;
			south: number;
			west: number;
			north: number;
			east: number;
			grid_rows: number;
			grid_cols: number;
			active: boolean;
		}>;
		candidateStatusCounts: Partial<Record<OsmCandidateStatus, number>>;
		currentRunCandidates: Array<{
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
		}>;
		pipelineStateCounts: Record<string, number>;
		llmReviewStatusCounts: Partial<Record<LlmReviewStatus, number>>;
		matchBucketCounts: Record<string, number>;
		processReasonCounts: Array<{ status: OsmCandidateStatus; reason: string; count: number }>;
		llmReviews: Array<{
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
		}>;
		llmActionCounts: Record<string, number>;
		llmAutoDecisionCounts: Record<string, number>;
		cronJobs: Array<{
			jobid: number;
			schedule: string;
			active?: boolean | null;
			jobname?: string | null;
		}>;
		cronRuns: Array<{
			jobid: number;
			status: string | null;
			start_time: string | null;
			end_time: string | null;
			return_message: string | null;
		}>;
		cronError: string | null;
		countyCoverage: {
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
			counties: Array<{
				place_id: string;
				code: string;
				name: string;
				state_code: string;
				last_full_scan_at: string | null;
				last_import_job_id: string | null;
				fresh_observed_locations: number;
				collection_locations: number;
				qualifying_brands: number;
			}>;
		} | null;
		countyCoverageError: string | null;
		regionRunHistory: Array<{
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
			lastEndedAt: string | null;
			lastMessage: string | null;
		}>;
		importCronSummary: {
			expected: number;
			configured: number;
			active: number;
			issues: number;
			lastActivity: string | null;
		};
	};

	let selectedRegionCode =
		data.regionCodes.find((region) => region.code === data.latestRegionJob?.region_key)?.code ??
		data.regionCodes.find((region) => region.code === 'US-CA')?.code ??
		data.regionCodes[0]?.code ??
		'US-CA';
	let jobsContainer: HTMLDivElement | null = null;
	let visibleJobsCount = 25;
	let importDetailsOpen = false;
	let selectedBucket: { kind: 'process' | 'llm'; value: string; label: string } | null = null;
	let bucketSearch = '';
	let visibleBucketCount = 100;

	$: visibleJobs = data.jobs.slice(0, visibleJobsCount);
	$: selectedRegion = data.regionCodes.find((r) => r.code === selectedRegionCode);
	$: selectedBounds = data.regionBounds.find((r) => r.region_code === selectedRegionCode);
	$: selectedTileCount = (selectedBounds?.grid_rows ?? 0) * (selectedBounds?.grid_cols ?? 0);
	$: latestTileTotal = data.latestTileJobs.length || data.latestRegionJob?.total_tiles || 0;
	$: latestTileDone =
		(data.latestTileStatusCounts.succeeded ?? 0) + (data.latestTileStatusCounts.failed ?? 0);
	$: latestTilePercent = latestTileTotal ? Math.round((latestTileDone / latestTileTotal) * 100) : 0;
	$: latestImportActive =
		(data.latestTileStatusCounts.queued ?? 0) +
		(data.latestTileStatusCounts.running ?? 0) +
		(data.latestTileStatusCounts.retry_waiting ?? 0);
	$: countyGeocodePercent = data.countyCoverage?.location_geocode.total
		? Math.round(
				(data.countyCoverage.location_geocode.resolved /
					data.countyCoverage.location_geocode.total) *
					100
			)
		: 0;
	$: bucketCandidates = selectedBucket
		? data.currentRunCandidates.filter((candidate) =>
				selectedBucket?.kind === 'process'
					? candidate.process_status === selectedBucket.value
					: llmBucket(candidate) === selectedBucket?.value
			)
		: [];
	$: filteredBucketCandidates = bucketSearch.trim()
		? bucketCandidates.filter((candidate) => {
				const query = bucketSearch.trim().toLowerCase();
				return [
					candidate.name,
					candidate.source_key,
					candidate.matched_brand_slug,
					candidate.process_reason,
					candidate.llm_review_error
				]
					.filter(Boolean)
					.some((value) => String(value).toLowerCase().includes(query));
			})
		: bucketCandidates;
	$: visibleBucketCandidates = filteredBucketCandidates.slice(0, visibleBucketCount);

	function onJobsScroll() {
		if (!jobsContainer) return;
		const nearBottom =
			jobsContainer.scrollTop + jobsContainer.clientHeight >= jobsContainer.scrollHeight - 120;
		if (nearBottom && visibleJobsCount < data.jobs.length) {
			visibleJobsCount = Math.min(visibleJobsCount + 25, data.jobs.length);
		}
	}

	onMount(() => {
		// Reset visible rows if the SSR payload changes (e.g. reload).
		visibleJobsCount = Math.min(25, data.jobs.length || 25);
		const refreshTimer = window.setInterval(() => {
			if (
				data.view === 'current' &&
				data.latestRegionJob &&
				['queued', 'running', 'retry_waiting'].includes(data.latestRegionJob.status)
			) {
				void invalidateAll();
			}
		}, 20_000);

		return () => window.clearInterval(refreshTimer);
	});

	const enhancePipelineAction: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect') {
				await goto(result.location, {
					invalidateAll: true,
					keepFocus: true,
					noScroll: true
				});
				return;
			}

			await applyAction(result);
		};
	};

	function formatNumber(value: number | null | undefined) {
		return new Intl.NumberFormat().format(value ?? 0);
	}

	function formatDate(value: string | null | undefined) {
		return value ? new Date(value).toLocaleString() : '—';
	}

	function shortId(value: string | null | undefined) {
		return value ? value.slice(0, 8) : '—';
	}

	function llmBucket(candidate: (typeof data.currentRunCandidates)[number]) {
		if (
			candidate.pipeline_state === 'not_reviewed_yet' ||
			candidate.pipeline_state === 'awaiting_current_llm_review'
		)
			return 'pending';
		if (candidate.pipeline_state === 'llm_processing') return 'processing';
		if (candidate.pipeline_state === 'llm_failed') return 'failed';
		if (candidate.llm_review_status === 'reviewed') return 'reviewed';
		return null;
	}

	function openBucket(kind: 'process' | 'llm', value: string, label: string) {
		selectedBucket = { kind, value, label };
		bucketSearch = '';
		visibleBucketCount = 100;
	}

	function osmObjectUrl(candidate: (typeof data.currentRunCandidates)[number]) {
		if (!candidate.osm_id || !['node', 'way', 'relation'].includes(candidate.osm_type ?? ''))
			return null;
		return `https://www.openstreetmap.org/${candidate.osm_type}/${candidate.osm_id}`;
	}
</script>

<svelte:window
	on:keydown={(event) => {
		if (event.key !== 'Escape') return;
		if (selectedBucket) selectedBucket = null;
		else importDetailsOpen = false;
	}}
/>

<main class="mx-auto max-w-6xl space-y-8 px-4 py-6">
	<header class="border-b border-gray-200 pb-5">
		<p class="text-xs font-semibold tracking-wide text-teal-700 uppercase">OSM pipeline</p>
		<h1 class="mt-1 text-2xl font-semibold text-gray-950">Import control center</h1>
		<p class="mt-2 max-w-3xl text-sm text-gray-600">
			Configure a region import, move queued data through deterministic and LLM processing, then
			hand unresolved candidates to the review queue.
		</p>
	</header>

	<nav class="flex gap-1 border-b border-gray-200" aria-label="Import views">
		<a
			class={`border-b-2 px-3 py-2 text-sm ${data.view === 'current' ? 'border-gray-950 font-semibold text-gray-950' : 'border-transparent text-gray-600 hover:text-gray-950'}`}
			href="/admin/imports"
		>
			<span class="inline-flex items-center gap-2">
				{#if data.latestRegionJob && ['queued', 'running', 'retry_waiting'].includes(data.latestRegionJob.status)}
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
				<div class="text-xs text-gray-500">Queued tiles</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.latestTileStatusCounts.queued)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Running tiles</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.latestTileStatusCounts.running)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Succeeded</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.latestTileStatusCounts.succeeded)}
				</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Failed</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.latestTileStatusCounts.failed)}
				</div>
			</div>
			<a
				class="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50"
				href="/admin/reviews"
			>
				<div class="text-xs text-gray-500">Manual review</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.pipelineStateCounts.waiting_manual_review)}
				</div>
			</a>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="text-xs text-gray-500">Pending process</div>
				<div class="mt-1 text-2xl font-semibold">
					{formatNumber(data.candidateStatusCounts.pending)}
				</div>
			</div>
		</section>

		<section class="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div>
						<h2 class="text-lg font-semibold text-gray-950">1. Region grid and import</h2>
						<p class="mt-1 text-sm text-gray-500">
							Set tile dimensions, then create one parent job and tile jobs.
						</p>
					</div>
					<div class="flex items-center gap-2">
						{#if selectedBounds}
							<span class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
								{formatNumber(selectedTileCount)} tiles
							</span>
						{/if}
						<button
							type="button"
							class="inline-flex h-8 items-center gap-2 rounded-md border border-gray-300 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
							title="Import details"
							on:click={() => (importDetailsOpen = true)}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<path
									d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
							Details
						</button>
					</div>
				</div>

				<div class="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
					<form
						method="POST"
						action="?/updateGrid"
						class="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_auto]"
						use:enhance={enhancePipelineAction}
					>
						<label class="block">
							<span class="text-xs font-medium text-gray-600">Region</span>
							<select
								name="region_code"
								class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
								bind:value={selectedRegionCode}
							>
								{#each data.regionCodes as rc}
									<option value={rc.code}>{rc.region_name} ({rc.code})</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="text-xs font-medium text-gray-600">Rows</span>
							<input
								name="grid_rows"
								type="number"
								min="1"
								max="200"
								class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
								value={selectedBounds?.grid_rows ?? 40}
							/>
						</label>
						<label class="block">
							<span class="text-xs font-medium text-gray-600">Cols</span>
							<input
								name="grid_cols"
								type="number"
								min="1"
								max="200"
								class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
								value={selectedBounds?.grid_cols ?? 40}
							/>
						</label>
						<button
							class="mt-5 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50"
						>
							Save grid
						</button>
					</form>

					<form
						method="POST"
						action="?/startRegionImport"
						class="flex items-end"
						use:enhance={enhancePipelineAction}
					>
						<input type="hidden" name="region_code" value={selectedRegionCode} />
						<button
							class="rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
						>
							Start import
						</button>
					</form>
				</div>

				{#if selectedBounds}
					<div class="mt-4 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
						<div>
							Bounds: {selectedBounds.south}, {selectedBounds.west} to {selectedBounds.north}, {selectedBounds.east}
						</div>
						<div>Active: {selectedBounds.active ? 'yes' : 'no'}</div>
					</div>
				{/if}
			</div>

			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">Latest region run</h2>
				{#if data.latestRegionJob}
					<div class="mt-3 space-y-3">
						<div class="flex items-center justify-between gap-3">
							<div>
								<div class="text-sm font-medium">
									{data.latestRegionJob.region_key ?? 'Unknown region'}
								</div>
								<div class="text-xs text-gray-500">job {shortId(data.latestRegionJob.id)}</div>
							</div>
							<span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
								>{data.latestRegionJob.status}</span
							>
						</div>
						<div class="h-2 overflow-hidden rounded-full bg-gray-100">
							<div class="h-full bg-emerald-500" style={`width: ${latestTilePercent}%`}></div>
						</div>
						<div class="grid grid-cols-4 gap-2 text-center text-xs">
							<div class="rounded-md bg-gray-50 p-2">
								queued<br /><b>{data.latestTileStatusCounts.queued ?? 0}</b>
							</div>
							<div class="rounded-md bg-blue-50 p-2">
								running<br /><b>{data.latestTileStatusCounts.running ?? 0}</b>
							</div>
							<div class="rounded-md bg-emerald-50 p-2">
								done<br /><b>{data.latestTileStatusCounts.succeeded ?? 0}</b>
							</div>
							<div class="rounded-md bg-rose-50 p-2">
								failed<br /><b>{data.latestTileStatusCounts.failed ?? 0}</b>
							</div>
						</div>
						<p class="text-xs text-gray-500">
							Created {formatDate(data.latestRegionJob.created_at)}
						</p>
						{#if (data.latestTileStatusCounts.failed ?? 0) > 0}
							<form
								method="POST"
								action="?/retryFailedTiles"
								use:enhance={enhancePipelineAction}
							>
								<input type="hidden" name="parent_job_id" value={data.latestRegionJob.id} />
								<button
									class="w-full rounded-md border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
									disabled={latestImportActive > 0}
									title={latestImportActive > 0
										? 'Wait for queued, running, and retrying tiles to finish'
										: 'Requeue only failed tiles'}
								>
									Retry {data.latestTileStatusCounts.failed} failed tiles
								</button>
							</form>
						{/if}
					</div>
				{:else}
					<p class="mt-3 text-sm text-gray-500">No region import has been started yet.</p>
				{/if}
			</div>
		</section>

		<section class="border-y border-gray-200 bg-white px-5 py-5">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-gray-950">County coverage</h2>
					<p class="mt-1 text-sm text-gray-500">
						{data.countyCoverage?.region_code ?? data.latestRegionJob?.region_key ?? 'Current region'}
						· {data.countyCoverage?.freshness_months ?? 24}-month observation window
					</p>
				</div>
				{#if data.countyCoverage?.latest_full_scan_at}
					<div class="text-left text-xs text-gray-500 sm:text-right">
						<div>Last complete scan</div>
						<div class="mt-1 font-semibold text-gray-900">
							{formatDate(data.countyCoverage.latest_full_scan_at)}
						</div>
					</div>
				{/if}
			</div>

			{#if data.countyCoverageError}
				<p class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
					County coverage is unavailable: {data.countyCoverageError}
				</p>
			{:else if data.countyCoverage}
				<div class="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-5">
					<div>
						<div class="text-xs text-gray-500">Counties scanned</div>
						<div class="mt-1 text-xl font-semibold text-gray-950">
							{formatNumber(data.countyCoverage.scanned_count)} / {formatNumber(
								data.countyCoverage.county_count
							)}
						</div>
					</div>
					<div>
						<div class="text-xs text-gray-500">County geocoded</div>
						<div class="mt-1 text-xl font-semibold text-gray-950">{countyGeocodePercent}%</div>
						<div class="mt-1 text-xs text-gray-500">
							{formatNumber(data.countyCoverage.location_geocode.missing)} remaining
						</div>
					</div>
					<div>
						<div class="text-xs text-gray-500">Fresh observations</div>
						<div class="mt-1 text-xl font-semibold text-gray-950">
							{formatNumber(data.countyCoverage.fresh_observed_locations)}
						</div>
					</div>
					<div>
						<div class="text-xs text-gray-500">Collection locations</div>
						<div class="mt-1 text-xl font-semibold text-gray-950">
							{formatNumber(data.countyCoverage.collection_locations)}
						</div>
					</div>
					<div>
						<div class="text-xs text-gray-500">Qualifying brands</div>
						<div class="mt-1 text-xl font-semibold text-gray-950">
							{formatNumber(data.countyCoverage.qualifying_brands)}
						</div>
						<div class="mt-1 text-xs text-gray-500">
							{data.countyCoverage.minimum_brand_locations}+ observed locations
						</div>
					</div>
				</div>

				<div class="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
					<div class="h-full bg-blue-600" style={`width: ${countyGeocodePercent}%`}></div>
				</div>

				<details class="mt-5 border-t border-gray-200 pt-4">
					<summary class="cursor-pointer text-sm font-semibold text-gray-800">
						County breakdown
					</summary>
					<div class="mt-3 max-h-80 overflow-auto border border-gray-200">
						<table class="min-w-full divide-y divide-gray-200 text-left text-xs">
							<thead class="sticky top-0 bg-gray-50 text-gray-500">
								<tr>
									<th class="px-3 py-2 font-medium">County</th>
									<th class="px-3 py-2 font-medium">Last full scan</th>
									<th class="px-3 py-2 text-right font-medium">Observed</th>
									<th class="px-3 py-2 text-right font-medium">Collection</th>
									<th class="px-3 py-2 text-right font-medium">Brands</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100 bg-white">
								{#each data.countyCoverage.counties as county}
									<tr>
										<td class="px-3 py-2">
											<div class="font-medium text-gray-900">{county.name}</div>
											<div class="text-gray-400">{county.code}</div>
										</td>
										<td class="px-3 py-2 text-gray-600">{formatDate(county.last_full_scan_at)}</td>
										<td class="px-3 py-2 text-right text-gray-700">
											{formatNumber(county.fresh_observed_locations)}
										</td>
										<td class="px-3 py-2 text-right text-gray-700">
											{formatNumber(county.collection_locations)}
										</td>
										<td class="px-3 py-2 text-right text-gray-700">
											{formatNumber(county.qualifying_brands)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
		</section>

		<section id="automation" class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="text-lg font-semibold text-gray-950">2. Queue drain and cron</h2>
						<p class="mt-1 text-sm text-gray-500">
							Cron drains queued tile jobs by invoking the tile runner.
						</p>
					</div>
					<form
						method="POST"
						action="?/drainQueue"
						class="flex items-center gap-2"
						use:enhance={enhancePipelineAction}
					>
						<input
							name="limit"
							type="number"
							min="1"
							max="2"
							value="2"
							class="w-20 rounded-md border-gray-300 px-2 py-1.5 text-sm"
						/>
						<button class="rounded-md bg-gray-950 px-3 py-1.5 text-sm font-semibold text-white"
							>Drain now</button
						>
					</form>
				</div>

				{#if data.cronError}
					<p class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
						Protected cron status is unavailable: {data.cronError}
					</p>
				{:else}
					<div class="mt-4 grid grid-cols-3 divide-x divide-gray-200 border-y border-gray-200 py-3">
						<div class="px-3 first:pl-0">
							<div class="text-xs text-gray-500">Overall</div>
							{#if data.importCronSummary.configured === 0}
								<div class="mt-1 text-sm font-semibold text-amber-700">Not configured</div>
							{:else if data.importCronSummary.issues > 0}
								<div class="mt-1 text-sm font-semibold text-rose-700">Needs attention</div>
							{:else}
								<div class="mt-1 text-sm font-semibold text-emerald-700">Healthy</div>
							{/if}
						</div>
						<div class="px-3">
							<div class="text-xs text-gray-500">Active workers</div>
							<div class="mt-1 text-sm font-semibold text-gray-950">
								{data.importCronSummary.active} / {data.importCronSummary.expected}
							</div>
						</div>
						<div class="px-3 pr-0">
							<div class="text-xs text-gray-500">Last activity</div>
							<div class="mt-1 truncate text-sm font-semibold text-gray-950">
								{formatDate(data.importCronSummary.lastActivity)}
							</div>
						</div>
					</div>

					<div class="mt-4 overflow-hidden rounded-md border border-gray-200">
						{#each data.importCronWorkers as worker}
							<div class="border-b border-gray-200 px-3 py-3 last:border-b-0">
								<div class="flex flex-wrap items-start justify-between gap-2">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-sm font-semibold text-gray-950">{worker.label}</span>
											{#if !worker.configured}
												<span
													class="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
												>
													Missing
												</span>
											{:else if !worker.active}
												<span
													class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
												>
													Inactive
												</span>
											{:else if worker.lastStatus === 'succeeded'}
												<span
													class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
												>
													Succeeded
												</span>
											{:else if worker.lastStatus === 'failed'}
												<span
													class="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
												>
													Failed
												</span>
											{:else}
												<span
													class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
												>
													{worker.lastStatus ?? 'Awaiting first run'}
												</span>
											{/if}
										</div>
										<div class="mt-1 truncate text-xs text-gray-500" title={worker.jobname}>
											{worker.jobname}
										</div>
									</div>
									<div class="shrink-0 text-right text-xs text-gray-500">
										<div>{worker.schedule ?? 'Not scheduled'}</div>
										<div class="mt-1">{formatDate(worker.lastStartedAt)}</div>
									</div>
								</div>
								{#if worker.lastMessage && worker.lastStatus !== 'succeeded'}
									<p class="mt-2 line-clamp-2 text-xs text-rose-700">{worker.lastMessage}</p>
								{/if}
							</div>
						{/each}
						{#if data.importCronWorkers.length === 0}
							<p class="px-3 py-4 text-sm text-gray-500">No import cron workers returned.</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="rounded-xl border border-gray-200 bg-white p-5">
				<h2 class="text-lg font-semibold text-gray-950">3. Deterministic processing</h2>
				<p class="mt-1 text-sm text-gray-500">
					Run exact source, Wikidata, alias, website, and repeated-location decisions.
				</p>
				<form
					method="POST"
					action="?/processDeterministic"
					class="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
					use:enhance={enhancePipelineAction}
				>
					<label>
						<span class="text-xs font-medium text-gray-600">Batch size</span>
						<input
							name="limit"
							type="number"
							min="1"
							value="200"
							class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label>
						<span class="text-xs font-medium text-gray-600">Auto-create min locations</span>
						<input
							name="min_locations"
							type="number"
							min="2"
							value="2"
							class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<button class="mt-5 rounded-md bg-gray-950 px-3 py-2 text-sm font-semibold text-white"
						>Process</button
					>
				</form>

				<div class="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
					<button
						type="button"
						class="rounded-md bg-gray-50 p-2 hover:bg-gray-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.candidateStatusCounts.pending ?? 0) === 0}
						on:click={() => openBucket('process', 'pending', 'Pending deterministic processing')}
					>
						pending<br /><b>{data.candidateStatusCounts.pending ?? 0}</b>
					</button>
					<button
						type="button"
						class="rounded-md bg-amber-50 p-2 hover:bg-amber-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.pipelineStateCounts.llm_failed ?? 0) === 0}
						on:click={() => openBucket('llm', 'failed', 'Failed LLM review')}
					>
						LLM failed<br /><b>{data.pipelineStateCounts.llm_failed ?? 0}</b>
					</button>
					<button
						type="button"
						class="rounded-md bg-emerald-50 p-2 hover:bg-emerald-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.candidateStatusCounts.approved ?? 0) === 0}
						on:click={() => openBucket('process', 'approved', 'Approved candidates')}
					>
						approved<br /><b>{data.candidateStatusCounts.approved ?? 0}</b>
					</button>
					<button
						type="button"
						class="rounded-md bg-blue-50 p-2 hover:bg-blue-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.candidateStatusCounts.merged ?? 0) === 0}
						on:click={() => openBucket('process', 'merged', 'Merged candidates')}
					>
						merged<br /><b>{data.candidateStatusCounts.merged ?? 0}</b>
					</button>
					<button
						type="button"
						class="rounded-md bg-rose-50 p-2 hover:bg-rose-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.candidateStatusCounts.blocked ?? 0) === 0}
						on:click={() => openBucket('process', 'blocked', 'Blocked candidates')}
					>
						blocked<br /><b>{data.candidateStatusCounts.blocked ?? 0}</b>
					</button>
					<button
						type="button"
						class="rounded-md bg-slate-50 p-2 hover:bg-slate-100 disabled:cursor-default disabled:opacity-50"
						disabled={(data.candidateStatusCounts.rejected ?? 0) === 0}
						on:click={() => openBucket('process', 'rejected', 'Rejected candidates')}
					>
						rejected<br /><b>{data.candidateStatusCounts.rejected ?? 0}</b>
					</button>
				</div>
				<div class="mt-4 flex flex-wrap gap-2 text-xs">
					{#each Object.entries(data.matchBucketCounts) as [bucket, count]}
						<span class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{bucket}: {count}</span
						>
					{/each}
				</div>
			</div>
		</section>

		<section id="llm-review" class="scroll-mt-28 rounded-xl border border-gray-200 bg-white p-5">
			<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-gray-950">4. LLM review</h2>
					<p class="mt-1 text-sm text-gray-500">
						Score remaining needs-review candidates, then apply only the high-confidence auto
						decisions.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<form
						method="POST"
						action="?/runLlmReview"
						class="flex items-end gap-2"
						use:enhance={enhancePipelineAction}
					>
						<label>
							<span class="text-xs font-medium text-gray-600">Score batch</span>
							<input
								name="limit"
								type="number"
								min="1"
								max="10"
								value="5"
								class="mt-1 w-20 rounded-md border-gray-300 px-2 py-1.5 text-sm"
							/>
						</label>
						<button class="rounded-md bg-gray-950 px-3 py-1.5 text-sm font-semibold text-white">
							Run
						</button>
					</form>
					<form
						method="POST"
						action="?/resetLlmReview"
						class="flex items-end gap-2"
						use:enhance={enhancePipelineAction}
					>
						<label>
							<span class="text-xs font-medium text-gray-600">Reset after min</span>
							<input
								name="minutes"
								type="number"
								min="1"
								max="1440"
								value="30"
								class="mt-1 w-24 rounded-md border-gray-300 px-2 py-1.5 text-sm"
							/>
						</label>
						<button class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold">
							Reset stuck
						</button>
					</form>
					<form
						method="POST"
						action="?/applyAutoLlmReviews"
						class="flex items-end gap-2"
						use:enhance={enhancePipelineAction}
					>
						<label>
							<span class="text-xs font-medium text-gray-600">Apply limit</span>
							<input
								name="limit"
								type="number"
								min="1"
								max="250"
								value="25"
								class="mt-1 w-24 rounded-md border-gray-300 px-2 py-1.5 text-sm"
							/>
						</label>
						<button class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">
							Apply auto
						</button>
					</form>
				</div>
			</div>

			<div class="mt-5 grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
				<button
					type="button"
					class="rounded-md bg-gray-50 p-2 hover:bg-gray-100 disabled:cursor-default disabled:opacity-50"
					disabled={(data.llmReviewStatusCounts.pending ?? 0) === 0}
					on:click={() => openBucket('llm', 'pending', 'Pending LLM review')}
				>
					LLM pending<br /><b>{data.llmReviewStatusCounts.pending ?? 0}</b>
				</button>
				<button
					type="button"
					class="rounded-md bg-blue-50 p-2 hover:bg-blue-100 disabled:cursor-default disabled:opacity-50"
					disabled={(data.llmReviewStatusCounts.processing ?? 0) === 0}
					on:click={() => openBucket('llm', 'processing', 'LLM processing')}
				>
					processing<br /><b>{data.llmReviewStatusCounts.processing ?? 0}</b>
				</button>
				<button
					type="button"
					class="rounded-md bg-emerald-50 p-2 hover:bg-emerald-100 disabled:cursor-default disabled:opacity-50"
					disabled={(data.llmReviewStatusCounts.reviewed ?? 0) === 0}
					on:click={() => openBucket('llm', 'reviewed', 'Completed LLM review')}
				>
					reviewed<br /><b>{data.llmReviewStatusCounts.reviewed ?? 0}</b>
				</button>
				<button
					type="button"
					class="rounded-md bg-rose-50 p-2 hover:bg-rose-100 disabled:cursor-default disabled:opacity-50"
					disabled={(data.llmReviewStatusCounts.failed ?? 0) === 0}
					on:click={() => openBucket('llm', 'failed', 'Failed LLM review')}
				>
					failed<br /><b>{data.llmReviewStatusCounts.failed ?? 0}</b>
				</button>
			</div>

			<div class="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
				<div class="space-y-4">
					<div>
						<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
							Auto decisions
						</h3>
						<div class="mt-2 flex flex-wrap gap-2 text-xs">
							{#each Object.entries(data.llmAutoDecisionCounts) as [decision, count]}
								<span class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700"
									>{decision}: {count}</span
								>
							{/each}
							{#if Object.keys(data.llmAutoDecisionCounts).length === 0}
								<span class="text-gray-500">No reviews yet.</span>
							{/if}
						</div>
					</div>
					<div>
						<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Actions</h3>
						<div class="mt-2 flex flex-wrap gap-2 text-xs">
							{#each Object.entries(data.llmActionCounts) as [action, count]}
								<span class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700"
									>{action}: {count}</span
								>
							{/each}
							{#if Object.keys(data.llmActionCounts).length === 0}
								<span class="text-gray-500">No scored candidates yet.</span>
							{/if}
						</div>
					</div>
					<div>
						<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
							Top blockers
						</h3>
						<div class="mt-2 space-y-2">
							{#each data.processReasonCounts.slice(0, 5) as reason}
								<div
									class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm"
								>
									<span class="truncate">{reason.status}: {reason.reason}</span>
									<span class="font-semibold">{reason.count}</span>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
						Recent reviews
					</h3>
					<div class="mt-2 divide-y rounded-lg border border-gray-200">
						{#each data.llmReviews as review}
							<article class="p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<span class="font-mono text-xs text-gray-500"
												>{shortId(review.candidate_id)}</span
											>
											<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
												{review.auto_decision ?? 'manual_review'}
											</span>
											<span class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
												{review.action ?? 'needs_review'}
											</span>
											{#if review.confidence !== null}
												<span class="text-[11px] text-gray-500">
													{Math.round(review.confidence * 100)}%
												</span>
											{/if}
										</div>
										{#if review.proposed_display || review.proposed_brand_slug}
											<div class="mt-1 truncate text-xs text-gray-700">
												{review.proposed_display ?? review.proposed_brand_slug}
											</div>
										{/if}
									</div>
									<div class="text-[11px] whitespace-nowrap text-gray-500">
										{formatDate(review.created_at)}
									</div>
								</div>
								{#if review.reason}
									<p class="mt-2 line-clamp-2 text-xs text-gray-600">{review.reason}</p>
								{/if}
								{#if review.sources?.length}
									<div class="mt-2 flex flex-wrap gap-2 text-[11px]">
										{#each review.sources.slice(0, 3) as source, index}
											<a
												class="text-blue-600 underline"
												href={source}
												target="_blank"
												rel="noreferrer"
											>
												source {index + 1}
											</a>
										{/each}
									</div>
								{/if}
							</article>
						{/each}
						{#if data.llmReviews.length === 0}
							<div class="p-4 text-sm text-gray-500">No LLM reviews have been recorded yet.</div>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<div
			class="flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<h2 class="text-sm font-semibold text-gray-950">
					Unresolved candidates are reviewed separately
				</h2>
				<p class="mt-1 text-sm text-gray-500">
					The review queue stays available after an import has finished and can include other
					submission sources.
				</p>
			</div>
			<a
				class="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black"
				href="/admin/reviews"
			>
				Open review queue
			</a>
		</div>
	{:else}
		<section>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold text-gray-950">Region import history</h2>
					<p class="mt-1 text-sm text-gray-500">
						Completed tile work and candidate outcomes grouped by campaign.
					</p>
				</div>
				<div class="text-xs text-gray-500">{data.regionRunHistory.length} previous runs</div>
			</div>

			<div class="mt-4 space-y-4">
				{#each data.regionRunHistory as run}
					<article class="overflow-hidden rounded-lg border border-gray-200 bg-white">
						<header
							class="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="font-semibold text-gray-950">{run.regionKey ?? 'Unknown region'}</h3>
									{#if run.status === 'succeeded'}
										<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
											>Succeeded</span
										>
									{:else if run.status === 'failed'}
										<span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800"
											>Failed</span
										>
									{:else}
										<span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
											{run.status}
										</span>
									{/if}
								</div>
								<div class="mt-1 font-mono text-xs text-gray-500">{shortId(run.id)}</div>
							</div>
							<div class="text-left text-xs text-gray-500 sm:text-right">
								<div>Started {formatDate(run.startedAt ?? run.createdAt)}</div>
								<div class="mt-1">Finished {formatDate(run.finishedAt)}</div>
							</div>
						</header>

						<div class="grid divide-y divide-gray-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
							<section class="p-4">
								<h4 class="text-xs font-semibold text-gray-500 uppercase">Tiles</h4>
								<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
									<span class="text-gray-500">Total</span><b class="text-right">{run.totalTiles}</b>
									<span class="text-gray-500">Succeeded</span><b class="text-right text-emerald-700"
										>{run.tileStatusCounts.succeeded ?? 0}</b
									>
									<span class="text-gray-500">Failed</span><b class="text-right text-rose-700"
										>{run.tileStatusCounts.failed ?? 0}</b
									>
									<span class="text-gray-500">Retry waiting</span><b class="text-right"
										>{run.tileStatusCounts.retry_waiting ?? 0}</b
									>
								</div>
							</section>

							<section class="p-4">
								<h4 class="text-xs font-semibold text-gray-500 uppercase">Import output</h4>
								<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
									<span class="text-gray-500">Elements seen</span><b class="text-right"
										>{formatNumber(run.totalElements)}</b
									>
									<span class="text-gray-500">Inserted / updated</span><b class="text-right"
										>{formatNumber(run.insertedOrUpdated)}</b
									>
									<span class="text-gray-500">Skipped</span><b class="text-right"
										>{formatNumber(run.skipped)}</b
									>
									<span class="text-gray-500">Unchanged</span><b class="text-right"
										>{formatNumber(run.unchanged)}</b
									>
								</div>
							</section>

							<section class="p-4">
								<div class="flex items-center justify-between gap-3">
									<h4 class="text-xs font-semibold text-gray-500 uppercase">Candidate outcomes</h4>
									<span class="text-xs font-semibold text-gray-700"
										>{run.candidateCount} retained</span
									>
								</div>
								<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
									<span class="text-gray-500">Approved</span><b class="text-right"
										>{run.candidateStatusCounts.approved ?? 0}</b
									>
									<span class="text-gray-500">Merged</span><b class="text-right"
										>{run.candidateStatusCounts.merged ?? 0}</b
									>
									<span class="text-gray-500">Blocked</span><b class="text-right"
										>{run.candidateStatusCounts.blocked ?? 0}</b
									>
									<span class="text-gray-500">Rejected</span><b class="text-right"
										>{run.candidateStatusCounts.rejected ?? 0}</b
									>
									<span class="text-gray-500">Manual review</span><b
										class="text-right text-amber-700"
										>{run.pipelineStateCounts.waiting_manual_review ?? 0}</b
									>
									<span class="text-gray-500">LLM failed</span><b class="text-right text-rose-700"
										>{run.pipelineStateCounts.llm_failed ?? 0}</b
									>
								</div>
							</section>
						</div>
					</article>
				{/each}

				{#if data.regionRunHistory.length === 0}
					<div class="rounded-lg border border-gray-200 bg-white px-6 py-14 text-center">
						<h3 class="text-sm font-semibold text-gray-950">No previous region runs</h3>
						<p class="mt-1 text-sm text-gray-500">The first completed campaign will appear here.</p>
					</div>
				{/if}
			</div>
		</section>
	{/if}
</main>

{#if selectedBucket}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		role="presentation"
		on:click={(event) => event.currentTarget === event.target && (selectedBucket = null)}
	>
		<div
			class="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="bucket-title"
		>
			<header class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
				<div>
					<h2 id="bucket-title" class="text-lg font-semibold text-gray-950">
						{selectedBucket.label}
					</h2>
					<p class="mt-1 text-sm text-gray-500">
						{formatNumber(bucketCandidates.length)} candidates in {data.latestRegionJob
							?.region_key ?? 'the current run'}
					</p>
				</div>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
					aria-label="Close candidate inspector"
					on:click={() => (selectedBucket = null)}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="m6 6 12 12M18 6 6 18"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>

			<div class="border-b border-gray-200 bg-gray-50 px-5 py-3">
				<div class="relative">
					<svg
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387-1.414 1.414-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z"
							clip-rule="evenodd"
						/>
					</svg>
					<input
						class="w-full rounded-md border-gray-300 py-2 pr-3 pl-9 text-sm"
						placeholder="Search name, source, brand, or reason"
						bind:value={bucketSearch}
					/>
				</div>
			</div>

			<div class="min-h-0 overflow-auto">
				<table class="w-full min-w-[48rem] text-sm">
					<thead class="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e5e7eb]">
						<tr class="text-xs text-gray-500">
							<th class="px-4 py-2 text-left font-medium">Candidate</th>
							<th class="px-4 py-2 text-left font-medium">Source node</th>
							<th class="px-4 py-2 text-left font-medium">Location</th>
							<th class="px-4 py-2 text-left font-medium">Outcome</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each visibleBucketCandidates as candidate}
							<tr class="align-top">
								<td class="px-4 py-3">
									<div class="font-medium text-gray-950">
										{candidate.name ?? 'Unnamed candidate'}
									</div>
									<div class="mt-1 font-mono text-xs text-gray-500">{shortId(candidate.id)}</div>
								</td>
								<td class="px-4 py-3">
									{#if osmObjectUrl(candidate)}
										<a
											class="font-medium text-blue-700 hover:underline"
											href={osmObjectUrl(candidate) ?? '#'}
											target="_blank"
											rel="noreferrer"
										>
											{candidate.osm_type}
											{candidate.osm_id}
										</a>
									{:else}
										<span class="font-mono text-xs text-gray-600">
											{candidate.source ?? 'OSM'}:{candidate.source_key ?? 'unknown'}
										</span>
									{/if}
								</td>
								<td class="px-4 py-3">
									{#if googleMapsCoordinatesUrl(candidate.lat, candidate.lon)}
										<a
											class="font-mono text-xs text-blue-700 hover:underline"
											href={googleMapsCoordinatesUrl(candidate.lat, candidate.lon) ?? '#'}
											target="_blank"
											rel="noreferrer"
										>
											{coordinatesLabel(candidate.lat, candidate.lon)}
										</a>
									{:else}
										<span class="text-xs text-gray-500">Unavailable</span>
									{/if}
								</td>
								<td class="max-w-sm px-4 py-3">
									<div class="flex flex-wrap items-center gap-2">
										<span class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
											{selectedBucket.kind === 'llm'
												? (llmBucket(candidate) ?? candidate.pipeline_state).replaceAll('_', ' ')
												: candidate.process_status.replaceAll('_', ' ')}
										</span>
										{#if candidate.matched_brand_slug}
											<a
												class="font-mono text-xs text-blue-700 hover:underline"
												href={`/admin/brands/catalog?q=${encodeURIComponent(candidate.matched_brand_slug)}`}
											>
												{candidate.matched_brand_slug}
											</a>
										{/if}
									</div>
									{#if candidate.llm_review_error || candidate.process_reason}
										<p class="mt-1 text-xs leading-5 text-gray-600">
											{candidate.llm_review_error ?? candidate.process_reason}
										</p>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>

				{#if filteredBucketCandidates.length === 0}
					<div class="px-6 py-12 text-center text-sm text-gray-500">No matching candidates.</div>
				{/if}
			</div>

			<footer class="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
				<span class="text-xs text-gray-500">
					Showing {Math.min(visibleBucketCount, filteredBucketCandidates.length)} of {filteredBucketCandidates.length}
				</span>
				{#if visibleBucketCount < filteredBucketCandidates.length}
					<button
						type="button"
						class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
						on:click={() => (visibleBucketCount += 100)}
					>
						Show more
					</button>
				{/if}
			</footer>
		</div>
	</div>
{/if}

{#if importDetailsOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		role="presentation"
		on:click={(event) => event.currentTarget === event.target && (importDetailsOpen = false)}
	>
		<div
			class="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="import-details-title"
		>
			<header class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
				<div>
					<h2 id="import-details-title" class="text-lg font-semibold text-gray-950">
						Import details
					</h2>
					<p class="mt-1 text-sm text-gray-500">
						Region configuration and operational job history.
					</p>
				</div>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
					aria-label="Close import details"
					on:click={() => (importDetailsOpen = false)}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d="m6 6 12 12M18 6 6 18"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</header>

			<div
				class="grid grid-cols-2 gap-3 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:grid-cols-4"
			>
				<div>
					<div class="text-xs text-gray-500">Region</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">
						{selectedRegion?.region_name ?? selectedRegionCode}
					</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Grid</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">
						{selectedBounds?.grid_rows ?? 0} × {selectedBounds?.grid_cols ?? 0}
					</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Jobs loaded</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">
						{formatNumber(data.jobs.length)}
					</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Failed</div>
					<div class="mt-1 text-sm font-semibold text-rose-700">
						{formatNumber(data.jobStatusCounts.failed)}
					</div>
				</div>
			</div>

			<div class="min-h-0 overflow-auto" bind:this={jobsContainer} on:scroll={onJobsScroll}>
				<table class="w-full min-w-[56rem] text-sm">
					<thead class="sticky top-0 z-10 bg-gray-50">
						<tr>
							<th class="px-4 py-2 text-left">Created</th>
							<th class="px-4 py-2 text-left">Status</th>
							<th class="px-4 py-2 text-left">Note</th>
							<th class="px-4 py-2 text-left">Stats</th>
							<th class="px-4 py-2 text-left">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each visibleJobs as job}
							<tr>
								<td class="px-4 py-2 whitespace-nowrap"
									>{new Date(job.created_at).toLocaleString()}</td
								>
								<td class="px-4 py-2">
									<span
										class={`inline-flex rounded-full px-2 py-0.5 text-xs ${job.status === 'succeeded' ? 'bg-emerald-100 text-emerald-800' : job.status === 'failed' ? 'bg-rose-100 text-rose-800' : job.status === 'running' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}
									>
										{job.status}
									</span>
								</td>
								<td class="max-w-64 px-4 py-2">
									<div class="truncate">{job.note ?? '—'}</div>
									{#if job.error_text}<div class="mt-1 line-clamp-2 text-xs text-rose-600">
											{job.error_text}
										</div>{/if}
								</td>
								<td class="px-4 py-2">
									{#if job.stats}
										<div class="flex flex-wrap gap-1 text-xs">
											<span class="rounded-full bg-gray-100 px-2 py-0.5"
												>seen {job.stats.total_elements ?? 0}</span
											>
											<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"
												>+{job.stats.inserted_or_updated ?? 0}</span
											>
											<span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800"
												>skip {job.stats.skipped ?? 0}</span
											>
										</div>
									{:else}—{/if}
								</td>
								<td class="px-4 py-2">
									<div class="flex items-center gap-2">
										{#if ['queued', 'failed', 'cancelled', 'retry_waiting'].includes(job.status)}
											<form method="POST" action="/admin/imports/_api/dequeue">
												<input type="hidden" name="job_id" value={job.id} />
												<button
													class="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
													>Delete</button
												>
											</form>
										{:else}
											<span class="text-xs text-gray-400">History preserved</span>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if visibleJobsCount < data.jobs.length}
					<div class="border-t px-4 py-2 text-xs text-gray-500">
						Loading more jobs as you scroll… ({visibleJobsCount}/{data.jobs.length})
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
