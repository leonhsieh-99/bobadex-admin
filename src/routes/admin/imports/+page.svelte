<!-- src/routes/admin/imports/+page.svelte -->
<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
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
			command: string;
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
	};

	let selectedRegionCode =
		data.regionCodes.find((r) => r.code === 'US-CA')?.code ?? data.regionCodes[0]?.code ?? 'US-CA';
	let jobsContainer: HTMLDivElement | null = null;
	let visibleJobsCount = 25;
	let importDetailsOpen = false;

	$: visibleJobs = data.jobs.slice(0, visibleJobsCount);
	$: selectedRegion = data.regionCodes.find((r) => r.code === selectedRegionCode);
	$: selectedBounds = data.regionBounds.find((r) => r.region_code === selectedRegionCode);
	$: selectedTileCount = (selectedBounds?.grid_rows ?? 0) * (selectedBounds?.grid_cols ?? 0);
	$: latestTileTotal = data.latestTileJobs.length || data.latestRegionJob?.total_tiles || 0;
	$: latestTileDone =
		(data.latestTileStatusCounts.succeeded ?? 0) + (data.latestTileStatusCounts.failed ?? 0);
	$: latestTilePercent = latestTileTotal ? Math.round((latestTileDone / latestTileTotal) * 100) : 0;

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
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && (importDetailsOpen = false)} />

<main class="mx-auto max-w-6xl space-y-8 px-4 py-6">
	<header class="border-b border-gray-200 pb-5">
		<p class="text-xs font-semibold tracking-wide text-teal-700 uppercase">OSM pipeline</p>
		<h1 class="mt-1 text-2xl font-semibold text-gray-950">Import control center</h1>
		<p class="mt-2 max-w-3xl text-sm text-gray-600">
			Configure a region import, move queued data through deterministic and LLM processing, then
			hand unresolved candidates to the review queue.
		</p>
	</header>

	<section class="grid grid-cols-2 gap-3 lg:grid-cols-6">
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="text-xs text-gray-500">Queued tiles</div>
			<div class="mt-1 text-2xl font-semibold">{formatNumber(data.jobStatusCounts.queued)}</div>
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="text-xs text-gray-500">Running tiles</div>
			<div class="mt-1 text-2xl font-semibold">{formatNumber(data.jobStatusCounts.running)}</div>
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="text-xs text-gray-500">Succeeded</div>
			<div class="mt-1 text-2xl font-semibold">{formatNumber(data.jobStatusCounts.succeeded)}</div>
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="text-xs text-gray-500">Failed</div>
			<div class="mt-1 text-2xl font-semibold">{formatNumber(data.jobStatusCounts.failed)}</div>
		</div>
		<a class="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50" href="/admin/reviews">
			<div class="text-xs text-gray-500">Needs review</div>
			<div class="mt-1 text-2xl font-semibold">
				{formatNumber(data.candidateStatusCounts.needs_review)}
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
							<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
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
					<p class="text-xs text-gray-500">Created {formatDate(data.latestRegionJob.created_at)}</p>
				</div>
			{:else}
				<p class="mt-3 text-sm text-gray-500">No region import has been started yet.</p>
			{/if}
		</div>
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
						max="50"
						value="5"
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
				<div class="mt-4 grid gap-4 lg:grid-cols-2">
					<div class="space-y-3">
						<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Schedules</h3>
						{#each data.cronJobs as job}
							<div class="rounded-md border border-gray-200 px-3 py-2">
								<div class="flex items-center justify-between gap-3 text-sm">
									<span class="font-medium">{job.jobname ?? `cron job ${job.jobid}`}</span>
									<span class="text-xs text-gray-500">{job.schedule}</span>
								</div>
								<div class="mt-1 truncate text-xs text-gray-500">{job.command}</div>
							</div>
						{/each}
						{#if data.cronJobs.length === 0}
							<p class="text-sm text-gray-500">No cron jobs returned.</p>
						{/if}
					</div>

					<div class="space-y-3">
						<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Recent runs</h3>
						{#each data.cronRuns.slice(0, 5) as run}
							<div class="rounded-md bg-gray-50 px-3 py-2">
								<div class="flex items-center justify-between gap-3 text-sm">
									<span class="font-medium">job {run.jobid}</span>
									<span class="text-xs text-gray-500">{run.status ?? 'unknown'}</span>
								</div>
								<div class="mt-1 text-xs text-gray-500">{formatDate(run.start_time)}</div>
								{#if run.return_message}
									<div class="mt-1 line-clamp-2 text-xs text-gray-500">{run.return_message}</div>
								{/if}
							</div>
						{/each}
						{#if data.cronRuns.length === 0}
							<p class="text-sm text-gray-500">No recent cron runs returned.</p>
						{/if}
					</div>
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
				<div class="rounded-md bg-gray-50 p-2">
					pending<br /><b>{data.candidateStatusCounts.pending ?? 0}</b>
				</div>
				<div class="rounded-md bg-amber-50 p-2">
					review<br /><b>{data.candidateStatusCounts.needs_review ?? 0}</b>
				</div>
				<div class="rounded-md bg-emerald-50 p-2">
					approved<br /><b>{data.candidateStatusCounts.approved ?? 0}</b>
				</div>
				<div class="rounded-md bg-blue-50 p-2">
					merged<br /><b>{data.candidateStatusCounts.merged ?? 0}</b>
				</div>
				<div class="rounded-md bg-rose-50 p-2">
					blocked<br /><b>{data.candidateStatusCounts.blocked ?? 0}</b>
				</div>
				<div class="rounded-md bg-slate-50 p-2">
					rejected<br /><b>{data.candidateStatusCounts.rejected ?? 0}</b>
				</div>
			</div>
			<div class="mt-4 flex flex-wrap gap-2 text-xs">
				{#each Object.entries(data.matchBucketCounts) as [bucket, count]}
					<span class="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{bucket}: {count}</span>
				{/each}
			</div>
		</div>
	</section>

	<section id="llm-review" class="scroll-mt-28 rounded-xl border border-gray-200 bg-white p-5">
		<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
			<div>
				<h2 class="text-lg font-semibold text-gray-950">4. LLM review</h2>
				<p class="mt-1 text-sm text-gray-500">
					Score remaining needs-review candidates, then apply only the high-confidence auto decisions.
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
			<div class="rounded-md bg-gray-50 p-2">
				LLM pending<br /><b>{data.llmReviewStatusCounts.pending ?? 0}</b>
			</div>
			<div class="rounded-md bg-blue-50 p-2">
				processing<br /><b>{data.llmReviewStatusCounts.processing ?? 0}</b>
			</div>
			<div class="rounded-md bg-emerald-50 p-2">
				reviewed<br /><b>{data.llmReviewStatusCounts.reviewed ?? 0}</b>
			</div>
			<div class="rounded-md bg-rose-50 p-2">
				failed<br /><b>{data.llmReviewStatusCounts.failed ?? 0}</b>
			</div>
		</div>

		<div class="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
			<div class="space-y-4">
				<div>
					<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Auto decisions</h3>
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
					<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Top blockers</h3>
					<div class="mt-2 space-y-2">
						{#each data.processReasonCounts.slice(0, 5) as reason}
							<div class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm">
								<span class="truncate">{reason.status}: {reason.reason}</span>
								<span class="font-semibold">{reason.count}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div>
				<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Recent reviews</h3>
				<div class="mt-2 divide-y rounded-lg border border-gray-200">
					{#each data.llmReviews as review}
						<article class="p-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-mono text-xs text-gray-500">{shortId(review.candidate_id)}</span>
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
										<a class="text-blue-600 underline" href={source} target="_blank" rel="noreferrer">
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

	<div class="flex flex-col gap-3 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h2 class="text-sm font-semibold text-gray-950">Unresolved candidates are reviewed separately</h2>
			<p class="mt-1 text-sm text-gray-500">The review queue stays available after an import has finished and can include other submission sources.</p>
		</div>
		<a class="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black" href="/admin/reviews">
			Open review queue
		</a>
	</div>
</main>

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
					<h2 id="import-details-title" class="text-lg font-semibold text-gray-950">Import details</h2>
					<p class="mt-1 text-sm text-gray-500">Region configuration and operational job history.</p>
				</div>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-950"
					aria-label="Close import details"
					on:click={() => (importDetailsOpen = false)}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					</svg>
				</button>
			</header>

			<div class="grid grid-cols-2 gap-3 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:grid-cols-4">
				<div>
					<div class="text-xs text-gray-500">Region</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">{selectedRegion?.region_name ?? selectedRegionCode}</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Grid</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">{selectedBounds?.grid_rows ?? 0} × {selectedBounds?.grid_cols ?? 0}</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Jobs loaded</div>
					<div class="mt-1 text-sm font-semibold text-gray-950">{formatNumber(data.jobs.length)}</div>
				</div>
				<div>
					<div class="text-xs text-gray-500">Failed</div>
					<div class="mt-1 text-sm font-semibold text-rose-700">{formatNumber(data.jobStatusCounts.failed)}</div>
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
								<td class="px-4 py-2 whitespace-nowrap">{new Date(job.created_at).toLocaleString()}</td>
								<td class="px-4 py-2">
									<span class={`inline-flex rounded-full px-2 py-0.5 text-xs ${job.status === 'succeeded' ? 'bg-emerald-100 text-emerald-800' : job.status === 'failed' ? 'bg-rose-100 text-rose-800' : job.status === 'running' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
										{job.status}
									</span>
								</td>
								<td class="max-w-64 px-4 py-2">
									<div class="truncate">{job.note ?? '—'}</div>
									{#if job.error_text}<div class="mt-1 line-clamp-2 text-xs text-rose-600">{job.error_text}</div>{/if}
								</td>
								<td class="px-4 py-2">
									{#if job.stats}
										<div class="flex flex-wrap gap-1 text-xs">
											<span class="rounded-full bg-gray-100 px-2 py-0.5">seen {job.stats.total_elements ?? 0}</span>
											<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">+{job.stats.inserted_or_updated ?? 0}</span>
											<span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">skip {job.stats.skipped ?? 0}</span>
										</div>
									{:else}—{/if}
								</td>
								<td class="px-4 py-2">
									<div class="flex items-center gap-2">
										{#if ['queued', 'failed', 'cancelled', 'retry_waiting'].includes(job.status)}
											<form method="POST" action="/admin/imports/_api/dequeue">
												<input type="hidden" name="job_id" value={job.id} />
												<button class="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">Delete</button>
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
					<div class="border-t px-4 py-2 text-xs text-gray-500">Loading more jobs as you scroll… ({visibleJobsCount}/{data.jobs.length})</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
