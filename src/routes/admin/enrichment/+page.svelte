<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toasts } from '$lib/toast';
	import { onMount } from 'svelte';
	import type { SubmitFunction } from './$types';

	type Citation = {
		citation_role: string | null;
		evidence_excerpt: string | null;
		source: {
			id: string;
			url: string;
			title: string | null;
			publisher: string | null;
			credibility: string | number | null;
		} | null;
	};

	type Dossier = {
		brand_slug: string;
		approval_status: string;
		customer_summary: string | null;
		creative_brief: Record<string, unknown> | string | null;
		profile_facts: Record<string, unknown>;
		last_researched_at: string | null;
		updated_at: string;
		review_reasons: string[] | null;
		metrics: {
			overallConfidence: number | null;
			identityConfidence: number | null;
			citationCoverage: number | null;
			credibleSources: number | null;
			independentSources: number | null;
		};
		run: {
			id: string;
			model: string | null;
			customer_summary_draft: string | null;
			creative_brief_draft: Record<string, unknown> | string | null;
			error_text: string | null;
		} | null;
		claims: Array<{
			id: string;
			claim_key: string;
			claim_value: unknown;
			confidence: number | null;
			evidence_assessment: string | null;
			materiality: string | null;
			rationale: string | null;
			citations: Citation[];
		}>;
		integrityFlags: Array<{
			id: string;
			severity: string;
			title: string;
			details: unknown;
			recommended_action: string | null;
		}>;
		profile: {
			summary: string | null;
			summary_confidence: number | null;
			publication_method: string | null;
			published_at: string | null;
		} | null;
		activeJob: EnrichmentJob | null;
	};

	type EnrichmentJob = {
		id: string;
		brand_slug: string;
		trigger_kind: string;
		status: string;
		attempt_count: number;
		last_error: string | null;
		created_at: string;
		completed_at?: string | null;
	};

	type PublishedProfile = {
		brand_slug: string;
		summary: string | null;
		summary_confidence: number | null;
		publication_method: string | null;
		published_at: string | null;
		updated_at: string;
	};

	type CronState = {
		serverTime: string | null;
		configured: boolean;
		jobs: Array<{
			jobid: number;
			jobname: string | null;
			schedule: string;
			active: boolean;
		}>;
		runs: Array<{
			jobid: number;
			status: string;
			start_time: string;
			end_time: string | null;
			return_message: string | null;
		}>;
		error: string | null;
	};

	export let data: {
		metrics: {
			queued: number;
			running: number;
			failed: number;
			publishedProfiles: number;
			dossiersNeedingReview: number;
			dueRefreshes: number;
			openIntegrityFlags: number;
		};
		dossiers: Dossier[];
		activeJobs: EnrichmentJob[];
		publishedProfiles: PublishedProfile[];
		recentJobs: EnrichmentJob[];
		sourceErrors: string[];
		cron: CronState;
	};

	let deleting: Dossier | null = null;
	let deleteConfirmation = '';
	let deleteNote = '';
	let deleteError = '';
	let rerunning: Dossier | null = null;
	let rerunError = '';
	let publishing: Dossier | null = null;
	let publishError = '';
	let pendingAction = '';
	let activeTab: 'review' | 'queue' | 'published' = 'review';
	let refreshing = false;
	let liveCron = data.cron;
	let cronRefreshing = false;
	let cronCheckedAt = Date.now();

	const number = new Intl.NumberFormat('en-US');

	function percent(value: number | null) {
		if (value == null) return 'Unknown';
		return `${Math.round(value * 100)}%`;
	}

	function identityEvidence(dossier: Dossier) {
		return (
			dossier.claims.find((claim) =>
				['brand_identity', 'identity', 'brand_name', 'official_name'].includes(claim.claim_key)
			) ?? null
		);
	}

	function identityLabel(dossier: Dossier) {
		const claim = identityEvidence(dossier);
		return claim?.confidence != null
			? `${percent(claim.confidence)} · ${claim.evidence_assessment ?? 'unassessed'}`
			: percent(dossier.metrics.identityConfidence);
	}

	function relativeDate(value: string | null) {
		if (!value) return 'Unknown';
		const elapsed = Date.now() - new Date(value).getTime();
		const hours = Math.max(0, Math.floor(elapsed / 3_600_000));
		if (hours < 1) return 'Less than an hour ago';
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function displayValue(value: unknown) {
		if (value == null) return 'Not provided';
		if (typeof value === 'string') return value;
		return JSON.stringify(value, null, 2);
	}

	function flagDescription(details: unknown) {
		if (typeof details === 'string') return details;
		if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
		const description = (details as Record<string, unknown>).description;
		return typeof description === 'string' ? description : null;
	}

	function flagSourceUrls(details: unknown) {
		if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
		const sourceUrls = (details as Record<string, unknown>).source_urls;
		return Array.isArray(sourceUrls)
			? sourceUrls.filter((url): url is string => typeof url === 'string')
			: [];
	}

	function actionEnhance(action: string): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = action;
			deleteError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The request could not be completed.';

				if (result.type === 'success') {
					toasts.success(message);
					if (action === 'deleteFalsePositive') closeDelete();
					if (action === 'rerunBrand') closeRerun();
					if (action === 'reviewAndPublish') closePublish();
					await invalidateAll();
					if (action === 'configureCron' || action === 'disableCron') {
						await refreshCron();
					}
					return;
				}
				if (action === 'deleteFalsePositive') deleteError = message;
				if (action === 'rerunBrand') rerunError = message;
				if (action === 'reviewAndPublish') publishError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function openDelete(dossier: Dossier) {
		deleting = dossier;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function closeDelete() {
		deleting = null;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function openRerun(dossier: Dossier) {
		rerunning = dossier;
		rerunError = '';
	}

	function closeRerun() {
		rerunning = null;
		rerunError = '';
	}

	function openPublish(dossier: Dossier) {
		publishing = dossier;
		publishError = '';
	}

	function closePublish() {
		publishing = null;
		publishError = '';
	}

	function factText(dossier: Dossier, key: string) {
		const value = dossier.profile_facts?.[key];
		return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
	}

	function factList(dossier: Dossier, key: string) {
		const value = dossier.profile_facts?.[key];
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string').join('\n')
			: '';
	}

	function factSocials(dossier: Dossier) {
		const value = dossier.profile_facts?.official_socials;
		if (!Array.isArray(value)) return '';
		return value
			.filter(
				(item): item is { platform: string; url: string } =>
					Boolean(item) &&
					typeof item === 'object' &&
					typeof (item as Record<string, unknown>).platform === 'string' &&
					typeof (item as Record<string, unknown>).url === 'string'
			)
			.map((item) => `${item.platform} | ${item.url}`)
			.join('\n');
	}

	function statusClasses(status: string) {
		if (status === 'succeeded' || status === 'published') return 'bg-emerald-50 text-emerald-700';
		if (status === 'failed') return 'bg-red-50 text-red-700';
		if (status === 'running') return 'bg-blue-50 text-blue-700';
		return 'bg-zinc-100 text-zinc-700';
	}

	function latestCronRun(jobId: number) {
		return liveCron.runs.find((run) => run.jobid === jobId) ?? liveCron.runs[0] ?? null;
	}

	function exactDate(value: string | null) {
		if (!value) return 'Still running';
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		}).format(new Date(value));
	}

	function runDuration(start: string, end: string | null) {
		const elapsed = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
		if (!Number.isFinite(elapsed) || elapsed < 0) return 'Unknown duration';
		if (elapsed < 1_000) return `${elapsed}ms`;
		if (elapsed < 60_000) return `${Math.round(elapsed / 1_000)}s`;
		return `${Math.floor(elapsed / 60_000)}m ${Math.round((elapsed % 60_000) / 1_000)}s`;
	}

	async function refreshCron() {
		if (cronRefreshing || document.hidden) return;
		cronRefreshing = true;
		try {
			const response = await fetch('/admin/enrichment/cron-status', {
				headers: { accept: 'application/json' },
				cache: 'no-store'
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(
					payload && typeof payload.error === 'string'
						? payload.error
						: 'Cron status could not be refreshed.'
				);
			}
			liveCron = {
				serverTime: typeof payload.server_time === 'string' ? payload.server_time : null,
				configured: payload.configured === true,
				jobs: Array.isArray(payload.jobs) ? payload.jobs : [],
				runs: Array.isArray(payload.runs) ? payload.runs : [],
				error: null
			};
			cronCheckedAt = Date.now();
		} catch (error) {
			liveCron = {
				...liveCron,
				error: error instanceof Error ? error.message : 'Cron status could not be refreshed.'
			};
			cronCheckedAt = Date.now();
		} finally {
			cronRefreshing = false;
		}
	}

	async function refreshEnrichment() {
		if (refreshing || document.hidden) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		const enrichmentInterval = window.setInterval(() => {
			if (data.activeJobs.length > 0) void refreshEnrichment();
		}, 5_000);
		const cronInterval = window.setInterval(() => void refreshCron(), 10_000);
		void refreshCron();
		return () => {
			window.clearInterval(enrichmentInterval);
			window.clearInterval(cronInterval);
		};
	});
</script>

<svelte:head><title>Brand Enrichment | Bobadex Admin</title></svelte:head>

<svelte:window
	on:keydown={(event) => {
		if (event.key !== 'Escape') return;
		if (deleting) closeDelete();
		if (rerunning) closeRerun();
		if (publishing) closePublish();
	}}
/>

<main class="mx-auto max-w-7xl space-y-8 px-5 py-7 sm:py-9">
	<header class="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
		<div>
			<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
				Brand intelligence
			</p>
			<h2 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Enrichment</h2>
			<p class="mt-2 max-w-2xl text-sm text-zinc-600">
				Run research campaigns, review evidence, and publish verified brand profiles.
			</p>
		</div>
	</header>

	{#if data.sourceErrors.length}
		<div class="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			<p class="font-medium">Some enrichment data could not be loaded</p>
			<p class="mt-0.5">{data.sourceErrors.join(', ')}</p>
		</div>
	{/if}

	<section
		aria-label="Enrichment metrics"
		class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
	>
		{#each [['Queued', data.metrics.queued, 'text-zinc-950'], ['Running', data.metrics.running, 'text-blue-700'], ['Failed', data.metrics.failed, data.metrics.failed ? 'text-red-700' : 'text-zinc-950'], ['Published', data.metrics.publishedProfiles, 'text-emerald-700'], ['Needs review', data.metrics.dossiersNeedingReview, 'text-amber-700'], ['Due refreshes', data.metrics.dueRefreshes, 'text-zinc-950'], ['Open flags', data.metrics.openIntegrityFlags, data.metrics.openIntegrityFlags ? 'text-red-700' : 'text-zinc-950']] as metric}
			<div class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-xs font-medium text-zinc-500">{metric[0]}</p>
				<p class="mt-2 text-2xl font-semibold {metric[2]}">{number.format(Number(metric[1]))}</p>
			</div>
		{/each}
	</section>

	<section class="border-y border-zinc-200 py-6">
		<div>
			<h3 class="text-lg font-semibold text-zinc-950">Campaign controls</h3>
			<p class="mt-1 text-sm text-zinc-500">
				Select work in bounded campaigns, then let the queue worker process it in small batches.
			</p>
		</div>

		<div class="mt-5 grid gap-6 lg:grid-cols-2 lg:divide-x lg:divide-zinc-200">
			<div class="lg:pr-6">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h4 class="font-semibold text-zinc-950">Automatic selection</h4>
						<p class="mt-1 text-sm text-zinc-500">
							Queue the next eligible brands without pasting slugs.
						</p>
					</div>
					<span class="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
						>Maximum 500</span
					>
				</div>

				<form
					method="post"
					action="?/campaign"
					use:enhance={actionEnhance('campaign')}
					class="mt-4 grid gap-4 sm:grid-cols-2"
				>
					<label class="sm:col-span-2">
						<span class="text-sm font-medium text-zinc-800">Campaign type</span>
						<select
							name="trigger_kind"
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
						>
							<option value="backfill">Backfill · never researched</option>
							<option value="audit">Audit · least recently researched</option>
							<option value="scheduled_refresh">Scheduled refresh · currently due</option>
						</select>
					</label>
					<label>
						<span class="text-sm font-medium text-zinc-800">Brands to select</span>
						<input
							name="count"
							type="number"
							min="1"
							max="500"
							step="1"
							value="100"
							required
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm tabular-nums focus:border-zinc-500 focus:ring-zinc-500"
						/>
					</label>
					<label>
						<span class="text-sm font-medium text-zinc-800">Process immediately</span>
						<input
							name="limit"
							type="number"
							min="1"
							max="5"
							step="1"
							value="5"
							required
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm tabular-nums focus:border-zinc-500 focus:ring-zinc-500"
						/>
					</label>
					<div class="sm:col-span-2">
						<button
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
							disabled={Boolean(pendingAction)}
						>
							{pendingAction === 'campaign' ? 'Starting campaign…' : 'Start counted campaign'}
						</button>
						<p class="mt-2 text-xs text-zinc-500">
							The selected remainder stays queued for subsequent worker or cron runs.
						</p>
					</div>
				</form>
			</div>

			<div class="lg:pl-6">
				<div class="flex items-start justify-between gap-4">
					<div>
						<h4 class="font-semibold text-zinc-950">Queue worker</h4>
						<p class="mt-1 text-sm text-zinc-500">
							Process already queued work without selecting more brands.
						</p>
					</div>
					<span
						class="rounded px-2 py-1 text-xs font-medium {liveCron.jobs.some((job) => job.active)
							? 'bg-emerald-50 text-emerald-700'
							: 'bg-amber-50 text-amber-800'}"
					>
						{liveCron.jobs.some((job) => job.active) ? 'Cron active' : 'Cron disabled'}
					</span>
				</div>

				<form
					method="post"
					action="?/drain"
					use:enhance={actionEnhance('drain')}
					class="mt-4 flex items-end gap-3"
				>
					<label class="max-w-40 flex-1">
						<span class="text-sm font-medium text-zinc-800">Worker batch limit</span>
						<input
							name="limit"
							type="number"
							min="1"
							max="5"
							step="1"
							value="5"
							required
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm tabular-nums focus:border-zinc-500 focus:ring-zinc-500"
						/>
					</label>
					<button
						class="h-10 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
						disabled={Boolean(pendingAction)}
					>
						{pendingAction === 'drain' ? 'Processing…' : 'Run worker now'}
					</button>
				</form>

				<div
					class="mt-3 flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<div>
						<p class="text-sm font-medium text-zinc-900">Automatic queue drain</p>
						<p class="mt-0.5 text-xs text-zinc-500">
							Every five minutes · up to five brands per run
						</p>
					</div>
					<div class="flex shrink-0 gap-2">
						<form
							method="post"
							action="?/configureCron"
							use:enhance={actionEnhance('configureCron')}
						>
							<button
								class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
								disabled={Boolean(pendingAction)}
							>
								{pendingAction === 'configureCron'
									? 'Enabling…'
									: liveCron.jobs.some((job) => job.active)
										? 'Repair cron'
										: 'Enable cron'}
							</button>
						</form>
						{#if liveCron.jobs.some((job) => job.active)}
							<form
								method="post"
								action="?/disableCron"
								use:enhance={actionEnhance('disableCron')}
								onsubmit={(event) => {
									if (
										!window.confirm(
											'Disable automatic enrichment processing? Queued jobs will remain available.'
										)
									) {
										event.preventDefault();
									}
								}}
							>
								<button
									class="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
									disabled={Boolean(pendingAction)}
								>
									{pendingAction === 'disableCron' ? 'Disabling…' : 'Disable cron'}
								</button>
							</form>
						{/if}
					</div>
				</div>

				<div class="mt-5 border-t border-zinc-200 pt-4">
					<div class="mb-3 flex items-center justify-between gap-3">
						<p class="text-xs font-medium text-zinc-500">
							Live status · checked {new Date(cronCheckedAt).toLocaleTimeString([], {
								hour: 'numeric',
								minute: '2-digit',
								second: '2-digit'
							})}
						</p>
						<button
							type="button"
							onclick={() => void refreshCron()}
							class="text-xs font-medium text-zinc-600 hover:text-zinc-950 disabled:opacity-50"
							disabled={cronRefreshing}
						>
							{cronRefreshing ? 'Refreshing…' : 'Refresh'}
						</button>
					</div>
					{#if liveCron.error}
						<p class="text-sm text-amber-800">Cron status unavailable: {liveCron.error}</p>
					{:else if liveCron.jobs.length}
						<div class="space-y-4">
							{#each liveCron.jobs as job}
								{@const latestRun = latestCronRun(job.jobid)}
								<div class="flex items-start justify-between gap-4 text-sm">
									<div class="min-w-0">
										<p class="truncate font-medium text-zinc-900">
											{job.jobname ?? `Cron job ${job.jobid}`}
										</p>
										<p class="mt-0.5 text-xs text-zinc-500">
											{job.schedule} · {job.active ? 'active' : 'paused'}
										</p>
									</div>
									{#if latestRun}
										<div class="shrink-0 text-right">
											<span class="rounded px-2 py-1 text-xs {statusClasses(latestRun.status)}"
												>{latestRun.status}</span
											>
											<p class="mt-1 text-xs text-zinc-500">
												{relativeDate(latestRun.start_time)} · {runDuration(
													latestRun.start_time,
													latestRun.end_time
												)}
											</p>
										</div>
									{/if}
								</div>
							{/each}

							{#if liveCron.runs.length}
								<div class="overflow-hidden rounded border border-zinc-200 bg-white">
									<div
										class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500"
									>
										<span>Started</span>
										<span>Duration</span>
										<span>Status</span>
									</div>
									{#each liveCron.runs.slice(0, 5) as run}
										<div
											class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-xs last:border-0"
											title={run.return_message ?? undefined}
										>
											<span class="truncate text-zinc-700">{exactDate(run.start_time)}</span>
											<span class="text-zinc-500 tabular-nums"
												>{runDuration(run.start_time, run.end_time)}</span
											>
											<span class="rounded px-2 py-1 {statusClasses(run.status)}">{run.status}</span
											>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<p class="text-sm text-zinc-600">
							Automatic draining is disabled. Queued jobs are preserved and can still be run
							manually.
						</p>
					{/if}
				</div>
			</div>
		</div>

		<details class="mt-6 border-t border-zinc-200 pt-4">
			<summary class="cursor-pointer text-sm font-semibold text-zinc-800">
				Target specific brand slugs
			</summary>
			<div class="mt-4 max-w-2xl">
				<p class="text-sm text-zinc-500">
					Enter up to 20 brand slugs separated by commas or new lines.
				</p>
				<form method="post" class="mt-3" use:enhance={actionEnhance('targetedCampaign')}>
					<textarea
						name="brand_slugs"
						rows="4"
						required
						placeholder="cocofreshteaandjuice-859a55"
						class="block w-full rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
					></textarea>
					<div class="mt-3 flex flex-wrap gap-2">
						<button
							formaction="?/backfill"
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
							disabled={Boolean(pendingAction)}>Run targeted backfill</button
						>
						<button
							formaction="?/audit"
							class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
							disabled={Boolean(pendingAction)}>Run targeted audit</button
						>
					</div>
				</form>
			</div>
		</details>

		<div class="mt-6 grid gap-3 border-t border-zinc-200 pt-4 text-sm md:grid-cols-3">
			<p>
				<strong class="text-zinc-900">Backfill</strong> can auto-publish when every evidence gate clears.
			</p>
			<p><strong class="text-zinc-900">Audit</strong> always stops for admin review.</p>
			<p>
				<strong class="text-zinc-900">Blocking integrity flags</strong> always stop publication.
			</p>
		</div>
	</section>

	<nav class="sticky top-0 z-20 -mx-5 border-y border-zinc-200 bg-white/95 px-5 backdrop-blur">
		<div class="flex gap-6 overflow-x-auto" aria-label="Enrichment views">
			{#each [['review', 'Needs review', data.dossiers.length], ['queue', 'Queue', data.activeJobs.length], ['published', 'Published', data.publishedProfiles.length]] as tab}
				<button
					type="button"
					onclick={() => (activeTab = tab[0] as typeof activeTab)}
					class="flex h-12 shrink-0 items-center gap-2 border-b-2 text-sm font-medium {activeTab ===
					tab[0]
						? 'border-zinc-950 text-zinc-950'
						: 'border-transparent text-zinc-500 hover:text-zinc-900'}"
				>
					{tab[1]}
					<span
						class="inline-flex min-w-5 items-center justify-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700 tabular-nums"
						>{tab[2]}</span
					>
				</button>
			{/each}
			{#if data.activeJobs.length > 0}
				<span class="ml-auto flex shrink-0 items-center gap-2 text-xs text-zinc-500">
					<span class="h-2 w-2 animate-pulse rounded-full bg-blue-500"></span>
					{refreshing ? 'Refreshing' : 'Live'}
				</span>
			{/if}
		</div>
	</nav>

	{#if activeTab === 'review'}
		<section>
			<div class="mb-4 flex items-end justify-between gap-4">
				<div>
					<h3 class="text-lg font-semibold text-zinc-950">Dossiers needing review</h3>
					<p class="mt-1 text-sm text-zinc-500">
						Claims, citations, and integrity signals from the current research run.
					</p>
				</div>
				<span class="text-sm text-zinc-500 tabular-nums">{data.dossiers.length} dossiers</span>
			</div>

			<div class="space-y-5">
				{#each data.dossiers as dossier}
					<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
						<header
							class="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h4 class="text-base font-semibold break-all text-zinc-950">
										{dossier.brand_slug}
									</h4>
									{#if dossier.integrityFlags.length}<span
											class="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
											>{dossier.integrityFlags.length} open flag{dossier.integrityFlags.length === 1
												? ''
												: 's'}</span
										>{/if}
									{#if dossier.activeJob}
										<span
											class="rounded px-2 py-1 text-xs font-medium {statusClasses(
												dossier.activeJob.status
											)}"
										>
											{dossier.activeJob.status === 'running'
												? 'Enrichment running'
												: 'Enrichment queued'}
										</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-zinc-500">
									Updated {relativeDate(dossier.updated_at)}{dossier.run?.model
										? ` · ${dossier.run.model}`
										: ''}
								</p>
							</div>
							<div class="grid grid-cols-3 gap-4 text-right text-xs sm:grid-cols-5">
								<div>
									<p class="font-semibold text-zinc-900">
										{percent(dossier.metrics.overallConfidence)}
									</p>
									<p class="text-zinc-500">overall</p>
								</div>
								<div>
									<p class="font-semibold text-zinc-900">
										{identityLabel(dossier)}
									</p>
									<p class="text-zinc-500">identity evidence</p>
								</div>
								<div>
									<p class="font-semibold text-zinc-900">
										{percent(dossier.metrics.citationCoverage)}
									</p>
									<p class="text-zinc-500">coverage</p>
								</div>
								<div>
									<p class="font-semibold text-zinc-900">
										{dossier.metrics.credibleSources ?? '—'}
									</p>
									<p class="text-zinc-500">credible</p>
								</div>
								<div>
									<p class="font-semibold text-zinc-900">
										{dossier.metrics.independentSources ?? '—'}
									</p>
									<p class="text-zinc-500">independent</p>
								</div>
							</div>
						</header>

						<div class="grid gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
							<div class="min-w-0 space-y-6">
								<section>
									<h5 class="text-xs font-semibold text-zinc-500 uppercase">Draft summary</h5>
									<p class="mt-2 text-sm leading-6 whitespace-pre-wrap text-zinc-700">
										{dossier.run?.customer_summary_draft ??
											dossier.customer_summary ??
											'No draft summary was produced.'}
									</p>
								</section>

								<section>
									<div class="flex items-center justify-between">
										<h5 class="text-xs font-semibold text-zinc-500 uppercase">
											Claims and evidence
										</h5>
										<span class="text-xs text-zinc-500">{dossier.claims.length} claims</span>
									</div>
									<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
										{#each dossier.claims as claim}
											<div class="py-4">
												<div class="flex flex-wrap items-start justify-between gap-2">
													<div>
														<p class="text-sm font-semibold text-zinc-900">
															{claim.claim_key.replaceAll('_', ' ')}
														</p>
														<p class="mt-1 text-sm whitespace-pre-wrap text-zinc-700">
															{displayValue(claim.claim_value)}
														</p>
													</div>
													<div class="flex gap-2">
														<span
															class="rounded px-2 py-1 text-xs font-medium {claim.evidence_assessment ===
															'contradicted'
																? 'bg-red-50 text-red-700'
																: 'bg-zinc-100 text-zinc-700'}"
															>{claim.evidence_assessment ?? 'unassessed'}</span
														><span class="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700"
															>{percent(claim.confidence)}</span
														>
													</div>
												</div>
												{#if claim.rationale}<p class="mt-2 text-sm leading-6 text-zinc-600">
														{claim.rationale}
													</p>{/if}
												{#if claim.citations.length}
													<div class="mt-3 flex flex-wrap gap-2">
														{#each claim.citations as citation}
															{#if citation.source}<a
																	href={citation.source.url}
																	target="_blank"
																	rel="noreferrer"
																	class="max-w-full truncate rounded border border-zinc-200 px-2 py-1 text-xs text-blue-700 hover:bg-zinc-50"
																	>{citation.source.title ??
																		citation.source.publisher ??
																		citation.source.url}</a
																>{/if}
														{/each}
													</div>
												{/if}
											</div>
										{/each}
										{#if dossier.claims.length === 0}<p class="py-5 text-sm text-zinc-500">
												No claims are attached to the current run.
											</p>{/if}
									</div>
								</section>
							</div>

							<aside class="space-y-5">
								<section>
									<h5 class="text-xs font-semibold text-zinc-500 uppercase">Review reasons</h5>
									<div class="mt-2 flex flex-wrap gap-2">
										{#each dossier.review_reasons ?? [] as reason}<span
												class="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
												>{reason.replaceAll('_', ' ')}</span
											>{/each}{#if !dossier.review_reasons?.length}<span
												class="text-sm text-zinc-500">No reason supplied.</span
											>{/if}
									</div>
								</section>

								{#if dossier.integrityFlags.length}
									<section>
										<h5 class="text-xs font-semibold text-red-700 uppercase">Integrity flags</h5>
										<div class="mt-2 space-y-2">
											{#each dossier.integrityFlags as flag}<div
													class="border-l-2 border-red-400 bg-red-50 px-3 py-2"
												>
													<p class="text-sm font-medium text-red-900">{flag.title}</p>
													{#if flagDescription(flag.details)}<p class="mt-1 text-xs text-red-800">
															{flagDescription(flag.details)}
														</p>{/if}
													{#if flagSourceUrls(flag.details).length}<div
															class="mt-1 flex flex-wrap gap-x-3 gap-y-1"
														>
															{#each flagSourceUrls(flag.details) as url}<a
																	href={url}
																	target="_blank"
																	rel="noreferrer"
																	class="text-xs text-red-800 underline hover:text-red-950"
																	>Source</a
																>{/each}
														</div>{/if}
													{#if flag.recommended_action}<p
															class="mt-1 text-xs font-medium text-red-900"
														>
															{flag.recommended_action}
														</p>{/if}
													<form
														method="post"
														action="?/resolveFlag"
														use:enhance={actionEnhance('resolveFlag')}
														class="mt-2 flex gap-2"
													>
														<input type="hidden" name="flag_id" value={flag.id} />
														<input
															name="note"
															required
															placeholder="Resolution note"
															class="min-w-0 flex-1 rounded border-red-200 bg-white px-2 py-1 text-xs"
														/>
														<button
															name="resolution"
															value="resolved"
															disabled={Boolean(pendingAction)}
															class="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
															>Resolve</button
														><button
															name="resolution"
															value="dismissed"
															disabled={Boolean(pendingAction)}
															class="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
															>Dismiss</button
														>
													</form>
												</div>{/each}
										</div>
									</section>
								{/if}

								<section>
									<h5 class="text-xs font-semibold text-zinc-500 uppercase">Published profile</h5>
									{#if dossier.profile}<div class="mt-2 border-l-2 border-emerald-400 pl-3">
											<p class="text-sm leading-6 text-zinc-700">
												{dossier.profile.summary ?? 'Published without a summary.'}
											</p>
											<p class="mt-1 text-xs text-zinc-500">
												{dossier.profile.publication_method ?? 'Unknown method'} · {percent(
													dossier.profile.summary_confidence
												)}
											</p>
										</div>{:else}<p class="mt-2 text-sm text-zinc-500">
											No published profile.
										</p>{/if}
								</section>
							</aside>
						</div>

						<footer class="border-t border-zinc-200 bg-zinc-50 px-5 py-4">
							<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
								<div class="grid gap-2 sm:grid-cols-2">
									<button
										type="button"
										onclick={() => openPublish(dossier)}
										class="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
										disabled={Boolean(pendingAction)}
									>
										Approve
									</button>
									<form
										method="post"
										action="?/markClosed"
										use:enhance={actionEnhance('markClosed')}
										class="flex gap-2"
									>
										<input type="hidden" name="brand_slug" value={dossier.brand_slug} /><input
											name="note"
											required
											placeholder="Closure evidence"
											class="min-w-0 flex-1 rounded border-zinc-300 text-sm"
										/><button
											class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-50"
											disabled={Boolean(pendingAction)}>Mark closed</button
										>
									</form>
								</div>
								<div class="flex flex-wrap justify-end gap-2">
									<a
										href={`/admin/brands/catalog?q=${encodeURIComponent(dossier.brand_slug)}`}
										class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
										>Edit identity</a
									>
									<button
										type="button"
										onclick={() => openRerun(dossier)}
										disabled={Boolean(dossier.activeJob)}
										class="rounded border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
										>{dossier.activeJob ? 'Rerun queued' : 'Rerun enrichment'}</button
									>
									<button
										type="button"
										onclick={() => openDelete(dossier)}
										class="rounded border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
										>Delete false positive</button
									>
								</div>
							</div>
						</footer>
					</article>
				{/each}
				{#if data.dossiers.length === 0}<div
						class="border-y border-zinc-200 py-14 text-center text-sm text-zinc-500"
					>
						No dossiers currently need review.
					</div>{/if}
			</div>
		</section>
	{:else if activeTab === 'queue'}
		<section>
			<div class="mb-3">
				<h3 class="text-lg font-semibold text-zinc-950">Enrichment queue</h3>
				<p class="mt-1 text-sm text-zinc-500">
					Queued and running work updates automatically every five seconds.
				</p>
			</div>
			<div class="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
				<table class="min-w-full divide-y divide-zinc-200 text-left text-sm">
					<thead class="bg-zinc-50 text-xs text-zinc-500 uppercase"
						><tr
							><th class="px-4 py-3 font-medium">Brand</th><th class="px-4 py-3 font-medium"
								>Trigger</th
							><th class="px-4 py-3 font-medium">Status</th><th class="px-4 py-3 font-medium"
								>Attempts</th
							><th class="px-4 py-3 font-medium">Created</th></tr
						></thead
					><tbody class="divide-y divide-zinc-100"
						>{#each data.activeJobs as job}<tr
								><td class="max-w-xs truncate px-4 py-3 font-medium text-zinc-900"
									>{job.brand_slug}</td
								><td class="px-4 py-3 text-zinc-600">{job.trigger_kind}</td><td class="px-4 py-3"
									><span class="rounded px-2 py-1 text-xs font-medium {statusClasses(job.status)}"
										>{job.status}</span
									>{#if job.last_error}<p class="mt-1 max-w-md text-xs text-red-700">
											{job.last_error}
										</p>{/if}</td
								><td class="px-4 py-3 text-zinc-600 tabular-nums">{job.attempt_count}</td><td
									class="px-4 py-3 text-zinc-500">{relativeDate(job.created_at)}</td
								></tr
							>{/each}{#if data.activeJobs.length === 0}<tr
								><td colspan="5" class="px-4 py-10 text-center text-zinc-500"
									>The enrichment queue is clear.</td
								></tr
							>{/if}</tbody
					>
				</table>
			</div>
		</section>

		<section>
			<div class="mb-3">
				<h3 class="text-lg font-semibold text-zinc-950">Recent activity</h3>
				<p class="mt-1 text-sm text-zinc-500">Latest completed and failed worker attempts.</p>
			</div>
			<div class="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
				{#each data.recentJobs.filter((job) => !['queued', 'running'].includes(job.status)) as job}
					<div
						class="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
					>
						<div class="min-w-0">
							<p class="truncate font-medium text-zinc-900">{job.brand_slug}</p>
							<p class="mt-0.5 text-xs text-zinc-500">{job.trigger_kind}</p>
						</div>
						<span class="w-fit rounded px-2 py-1 text-xs font-medium {statusClasses(job.status)}">
							{job.status}
						</span>
						<span class="text-xs text-zinc-500"
							>{relativeDate(job.completed_at ?? job.created_at)}</span
						>
					</div>
				{/each}
			</div>
		</section>
	{:else}
		<section>
			<div class="mb-3">
				<h3 class="text-lg font-semibold text-zinc-950">Published profiles</h3>
				<p class="mt-1 text-sm text-zinc-500">
					Brand profiles currently available to the public experience.
				</p>
			</div>
			<div class="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
				<table class="min-w-full divide-y divide-zinc-200 text-left text-sm">
					<thead class="bg-zinc-50 text-xs text-zinc-500 uppercase">
						<tr>
							<th class="px-4 py-3 font-medium">Brand</th>
							<th class="px-4 py-3 font-medium">Summary</th>
							<th class="px-4 py-3 font-medium">Confidence</th>
							<th class="px-4 py-3 font-medium">Method</th>
							<th class="px-4 py-3 font-medium">Published</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100">
						{#each data.publishedProfiles as profile}
							<tr>
								<td class="max-w-xs px-4 py-3 font-medium break-all text-zinc-900">
									{profile.brand_slug}
								</td>
								<td class="max-w-xl px-4 py-3 text-zinc-600">
									<p class="line-clamp-2">{profile.summary ?? 'No summary.'}</p>
								</td>
								<td class="px-4 py-3 text-zinc-600">{percent(profile.summary_confidence)}</td>
								<td class="px-4 py-3 text-zinc-600">
									{profile.publication_method ?? 'Unknown'}
								</td>
								<td class="px-4 py-3 text-zinc-500">
									{relativeDate(profile.published_at ?? profile.updated_at)}
								</td>
							</tr>
						{/each}
						{#if data.publishedProfiles.length === 0}
							<tr>
								<td colspan="5" class="px-4 py-10 text-center text-zinc-500">
									No profiles have been published.
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</main>

{#if publishing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closePublish()}
	>
		<div
			class="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="publish-title"
		>
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h3 id="publish-title" class="text-lg font-semibold text-zinc-950">Review and publish</h3>
					<p class="mt-1 text-sm text-zinc-600">
						{publishing.brand_slug} · Current enrichment values are prefilled.
					</p>
				</div>
				<button
					type="button"
					onclick={closePublish}
					aria-label="Close review and publish"
					class="text-xl leading-none text-zinc-400 hover:text-zinc-800"
				>
					×
				</button>
			</div>

			<form
				method="post"
				action="?/reviewAndPublish"
				use:enhance={actionEnhance('reviewAndPublish')}
				class="flex min-h-0 flex-1 flex-col"
			>
				<input type="hidden" name="brand_slug" value={publishing.brand_slug} />
				<input
					type="hidden"
					name="original_profile_facts"
					value={JSON.stringify(publishing.profile_facts ?? {})}
				/>

				<div class="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
					<section>
						<h4 class="text-sm font-semibold text-zinc-950">Customer summary</h4>
						<label class="mt-3 block">
							<span class="sr-only">Customer summary</span>
							<textarea
								name="summary"
								rows="5"
								required
								value={publishing.customer_summary ?? publishing.run?.customer_summary_draft ?? ''}
								class="block w-full rounded border-zinc-300 text-sm leading-6 focus:border-zinc-500 focus:ring-zinc-500"
							></textarea>
						</label>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Official presence</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2">
							<label>
								<span class="text-xs font-medium text-zinc-600">Official website</span>
								<input
									name="fact_official_website"
									type="url"
									value={factText(publishing, 'official_website')}
									placeholder="https://…"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Official ordering URL</span>
								<input
									name="fact_official_ordering_url"
									type="url"
									value={factText(publishing, 'official_ordering_url')}
									placeholder="https://…"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label class="md:col-span-2">
								<span class="text-xs font-medium text-zinc-600">Official social accounts</span>
								<textarea
									name="fact_official_socials"
									rows="3"
									value={factSocials(publishing)}
									placeholder={'Instagram | https://instagram.com/brand\nTikTok | https://tiktok.com/@brand'}
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
								<span class="mt-1 block text-xs text-zinc-500">One per line: Platform | URL</span>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Identity and origin</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<label>
								<span class="text-xs font-medium text-zinc-600">Founded year</span>
								<input
									name="fact_founded_year"
									type="number"
									min="1800"
									max={new Date().getFullYear()}
									value={factText(publishing, 'founded_year')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Founded place</span>
								<input
									name="fact_founded_place"
									value={factText(publishing, 'founded_place')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Parent company</span>
								<input
									name="fact_parent_company"
									value={factText(publishing, 'parent_company')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Ownership model</span>
								<select
									name="fact_ownership_model"
									value={factText(publishing, 'ownership_model')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="independent">Independent</option>
									<option value="franchise">Franchise</option>
									<option value="company_operated">Company operated</option>
									<option value="mixed">Mixed</option>
									<option value="subsidiary">Subsidiary</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Native names</span>
								<textarea
									name="fact_native_names"
									rows="3"
									value={factList(publishing, 'native_names')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Former names</span>
								<textarea
									name="fact_former_names"
									rows="3"
									value={factList(publishing, 'former_names')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Classification</h4>
						<div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<label>
								<span class="text-xs font-medium text-zinc-600">Business type</span>
								<select
									name="fact_business_type"
									value={factText(publishing, 'business_type')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="tea_focused">Tea focused</option>
									<option value="dessert_bakery_hybrid">Dessert/bakery hybrid</option>
									<option value="restaurant_with_boba">Restaurant with boba</option>
									<option value="boba_secondary">Boba secondary</option>
									<option value="other">Other</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Boba relevance</span>
								<select
									name="fact_boba_relevance"
									value={factText(publishing, 'boba_relevance')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="primary">Primary</option>
									<option value="substantial">Substantial</option>
									<option value="secondary">Secondary</option>
									<option value="incidental">Incidental</option>
									<option value="none">None</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Price positioning</span>
								<select
									name="fact_price_positioning"
									value={factText(publishing, 'price_positioning')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="budget">Budget</option>
									<option value="mid_range">Mid range</option>
									<option value="premium">Premium</option>
									<option value="luxury">Luxury</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Brand status</span>
								<select
									name="fact_brand_status"
									value={factText(publishing, 'brand_status')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="active">Active</option>
									<option value="dormant">Dormant</option>
									<option value="acquired">Acquired</option>
									<option value="rebranded">Rebranded</option>
									<option value="closed">Closed</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Products and footprint</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<label>
								<span class="text-xs font-medium text-zinc-600">Product categories</span>
								<textarea
									name="fact_product_categories"
									rows="4"
									value={factList(publishing, 'product_categories')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Signature products</span>
								<textarea
									name="fact_signature_products"
									rows="4"
									value={factList(publishing, 'signature_products')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Known for</span>
								<textarea
									name="fact_known_for"
									rows="4"
									value={factList(publishing, 'known_for')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Markets</span>
								<textarea
									name="fact_markets"
									rows="4"
									value={factList(publishing, 'markets')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Store count statement</span>
								<input
									name="fact_store_count_statement"
									value={factText(publishing, 'store_count_statement')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Store count as of</span>
								<input
									name="fact_store_count_as_of"
									value={factText(publishing, 'store_count_as_of')}
									placeholder="2026-07"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">History and review</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2">
							<label class="md:col-span-2">
								<span class="text-xs font-medium text-zinc-600">History summary</span>
								<textarea
									name="fact_history_summary"
									rows="4"
									value={factText(publishing, 'history_summary')}
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Observed at</span>
								<input
									name="fact_observed_at"
									value={factText(publishing, 'observed_at')}
									placeholder="2026-07-27"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Review note (optional)</span>
								<input
									name="note"
									placeholder="Why you changed or approved this result"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
					</section>

					{#if publishError}
						<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
							{publishError}
						</div>
					{/if}
				</div>

				<div
					class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4"
				>
					<p class="text-xs text-zinc-500">Only changed fields are recorded in the audit.</p>
					<div class="flex shrink-0 gap-2">
						<button
							type="button"
							onclick={closePublish}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>
							Cancel
						</button>
						<button
							class="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
							disabled={Boolean(pendingAction)}
						>
							{pendingAction === 'reviewAndPublish' ? 'Publishing…' : 'Confirm and publish'}
						</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if rerunning}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeRerun()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="rerun-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="rerun-title" class="text-lg font-semibold text-zinc-950">
					Rerun brand enrichment?
				</h3>
				<p class="mt-1 text-sm text-zinc-600">
					This queues a fresh audit for the brand. It will always return for manual review and may
					run now or during the next cron drain.
				</p>
			</div>
			<form
				method="post"
				action="?/rerunBrand"
				use:enhance={actionEnhance('rerunBrand')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={rerunning.brand_slug} />
				<div>
					<p class="text-sm font-medium text-zinc-900">{rerunning.brand_slug}</p>
					<p class="mt-1 text-xs text-zinc-500">
						The current dossier remains available until the new research run completes.
					</p>
				</div>
				{#if rerunError}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{rerunError}
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeRerun}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
						disabled={Boolean(pendingAction)}
					>
						{pendingAction === 'rerunBrand' ? 'Queuing…' : 'Confirm rerun'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deleting}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeDelete()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="delete-title" class="text-lg font-semibold text-zinc-950">
					Permanently delete false positive
				</h3>
				<p class="mt-1 text-sm text-red-700">
					This cannot be undone. The API will refuse deletion when shops or feed events still depend
					on this brand.
				</p>
			</div>
			<form
				method="post"
				action="?/deleteFalsePositive"
				use:enhance={actionEnhance('deleteFalsePositive')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={deleting.brand_slug} />
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Type the exact slug</span><code
						class="mt-1 block rounded bg-zinc-100 px-2 py-1 text-xs break-all text-zinc-700"
						>{deleting.brand_slug}</code
					><input
						name="confirmation_slug"
						bind:value={deleteConfirmation}
						autocomplete="off"
						required
						class="mt-2 block w-full rounded border-zinc-300 text-sm"
					/></label
				>
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Verification note</span><textarea
						name="note"
						bind:value={deleteNote}
						rows="3"
						required
						placeholder="Verified false positive through …"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea></label
				>
				{#if deleteError}<div
						class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{deleteError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeDelete}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					><button
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={deleteConfirmation !== deleting.brand_slug ||
							!deleteNote.trim() ||
							Boolean(pendingAction)}
						>{pendingAction === 'deleteFalsePositive' ? 'Deleting…' : 'Delete permanently'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
