<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { toasts } from '$lib/toast';
	import type { SubmitFunction } from './$types';

	type Brand = {
		slug: string;
		display: string;
		icon_path: string | null;
		icon_url: string | null;
		icon_thumbnail_url: string | null;
		created_at: string;
		dossier_status: string | null;
		dossier_updated_at: string | null;
		latest_candidate_status: string | null;
		latest_candidate_url: string | null;
		latest_candidate_thumbnail_url: string | null;
	};

	type Candidate = {
		id: string;
		brand_slug: string;
		brand_display: string;
		status: string;
		creative_mode: string;
		quality: string;
		quality_score: number;
		model: string;
		concept: Record<string, unknown>;
		storage_path: string | null;
		error_text: string | null;
		created_at: string;
		updated_at: string;
		publication_strategy: string;
		published_at: string | null;
		preview_url: string | null;
		thumbnail_url: string | null;
		current_icon_url: string | null;
	};

	export let data: {
		view: 'ready' | 'generated' | 'review' | 'history';
		q: string;
		storage: { ready: boolean; isPublic: boolean; error: string | null };
		metrics: {
			eligible: number;
			iconless: number;
			ready: number;
			review: number;
			active: number;
			failed: number;
			published: number;
		};
		brands: Brand[];
		iconless: Brand[];
		generatedBrands: Brand[];
		reviewCandidates: Candidate[];
		historyCandidates: Candidate[];
	};

	let q = data.q;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let generating = false;
	let selectedSlug = '';
	let quality: 'auto' | 'low' | 'medium' | 'high' = 'auto';
	let publishMode: 'auto' | 'review' | 'force' = 'auto';
	let direction = '';
	let confirmReplace = false;
	let publishing: Candidate | null = null;
	let pendingAction = '';
	let modalError = '';
	let selectedRegenerationSlugs = new Set<string>();
	let regenerationConfirm = false;
	let regenerationQuality: 'auto' | 'low' | 'medium' | 'high' = 'auto';
	let regenerationDirection = '';
	let comparisonQueue: Candidate[] = [];
	let comparisonTotal = 0;
	let comparisonCompleted = 0;
	$: selectedBrand = data.brands.find((brand) => brand.slug === selectedSlug) ?? null;
	$: comparisonCandidate = comparisonQueue[0] ?? null;

	const number = new Intl.NumberFormat('en-US');

	function pageUrl(view = data.view, search = q) {
		const params: string[] = [];
		if (view !== 'ready') params.push(`view=${encodeURIComponent(view)}`);
		if (search.trim()) params.push(`q=${encodeURIComponent(search.trim())}`);
		return `/admin/image-gen${params.length ? `?${params.join('&')}` : ''}`;
	}

	function scheduleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(
			() => void goto(pageUrl(data.view, q), { keepFocus: true, noScroll: true }),
			250
		);
	}

	function openGenerator(brand?: Brand, requestedMode?: 'auto' | 'review') {
		selectedSlug = brand?.slug ?? '';
		quality = 'auto';
		publishMode = requestedMode ?? (brand?.icon_path ? 'review' : 'auto');
		direction = '';
		confirmReplace = false;
		modalError = '';
		generating = true;
	}

	function closeModal() {
		if (pendingAction) return;
		generating = false;
		publishing = null;
		selectedSlug = '';
		direction = '';
		confirmReplace = false;
		regenerationConfirm = false;
		comparisonQueue = [];
		comparisonTotal = 0;
		comparisonCompleted = 0;
		modalError = '';
	}

	function toggleRegeneration(slug: string) {
		const next = new Set(selectedRegenerationSlugs);
		if (next.has(slug)) next.delete(slug);
		else if (next.size < 5) next.add(slug);
		selectedRegenerationSlugs = next;
	}

	function openRegeneration(slugs?: string[]) {
		if (slugs) selectedRegenerationSlugs = new Set(slugs.slice(0, 5));
		if (!selectedRegenerationSlugs.size) return;
		regenerationQuality = 'auto';
		regenerationDirection = '';
		modalError = '';
		regenerationConfirm = true;
	}

	function actionEnhance(action: string): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = action;
			modalError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The image action could not be completed.';

				if (result.type === 'success') {
					toasts.success(message);
					if (action === 'regenerateSelected') {
						const regenerationResult = resultData as Record<string, unknown> | null;
						const candidateIds =
							regenerationResult && Array.isArray(regenerationResult.candidateIds)
								? regenerationResult.candidateIds.filter(
										(candidateId: unknown): candidateId is string => typeof candidateId === 'string'
									)
								: [];
						regenerationConfirm = false;
						selectedRegenerationSlugs = new Set();
						await invalidateAll();
						comparisonQueue = candidateIds.flatMap((candidateId: string) => {
							const candidate = data.reviewCandidates.find((item) => item.id === candidateId);
							return candidate ? [candidate] : [];
						});
						comparisonTotal = comparisonQueue.length;
						comparisonCompleted = 0;
						return;
					}
					if (action === 'publishComparison' || action === 'rejectComparison') {
						comparisonQueue = comparisonQueue.slice(1);
						comparisonCompleted += 1;
						await invalidateAll();
						return;
					}
					generating = false;
					publishing = null;
					await invalidateAll();
					return;
				}
				modalError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function relativeDate(value: string | null) {
		if (!value) return 'Not recorded';
		const elapsed = Date.now() - new Date(value).getTime();
		const minutes = Math.floor(elapsed / 60_000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function conceptText(candidate: Candidate, key: string) {
		const value = candidate.concept?.[key];
		if (typeof value === 'string') return value;
		if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ');
		return '';
	}

	function statusClass(status: string) {
		if (status === 'published') return 'bg-emerald-100 text-emerald-800';
		if (status === 'generated') return 'bg-amber-100 text-amber-800';
		if (status === 'failed') return 'bg-red-100 text-red-800';
		if (status === 'generating' || status === 'processing') return 'bg-blue-100 text-blue-800';
		return 'bg-zinc-100 text-zinc-700';
	}

	function selectionLabel() {
		const count = selectedRegenerationSlugs.size;
		return count === 1 ? 'Regenerate 1 brand' : `Regenerate ${count} brands`;
	}
</script>

<svelte:head><title>Image Generation | Bobadex Admin</title></svelte:head>
<svelte:window onkeydown={(event) => event.key === 'Escape' && closeModal()} />

<main class="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6">
	<header
		class="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end"
	>
		<div>
			<p class="text-xs font-semibold text-zinc-500 uppercase">Pipeline stage 4</p>
			<h1 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Image generation</h1>
			<p class="mt-2 max-w-3xl text-sm text-zinc-600">
				Generate grounded Bobadex mascots from approved brand research, inspect held drafts, and
				publish reviewed candidates.
			</p>
		</div>
		<button
			type="button"
			onclick={() => openGenerator()}
			disabled={!data.storage.ready || !data.storage.isPublic}
			class="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
		>
			Generate icon
		</button>
	</header>

	{#if !data.storage.ready || !data.storage.isPublic}
		<section class="border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
			<h2 class="text-sm font-semibold text-amber-950">Storage setup required</h2>
			<p class="mt-1 text-sm text-amber-900">
				The new functions require a public <code>shop-media</code> bucket for drafts, published icons,
				and thumbnails. Generation is disabled so a paid image cannot fail after rendering.
			</p>
			{#if data.storage.error}<p class="mt-1 text-xs text-amber-800">{data.storage.error}</p>{/if}
		</section>
	{/if}

	<section
		class="grid border-y border-zinc-200 sm:grid-cols-3 lg:grid-cols-6"
		aria-label="Image generation metrics"
	>
		{#each [['Ready', data.metrics.ready], ['Without icon', data.metrics.iconless], ['Awaiting review', data.metrics.review], ['In progress', data.metrics.active], ['Failed', data.metrics.failed], ['Published', data.metrics.published]] as metric (metric[0])}
			<div class="border-b border-zinc-200 px-4 py-3 sm:border-r sm:last:border-r-0 lg:border-b-0">
				<p class="text-xs font-medium text-zinc-500">{metric[0]}</p>
				<strong class="mt-1 block text-xl text-zinc-950 tabular-nums"
					>{number.format(Number(metric[1]))}</strong
				>
			</div>
		{/each}
	</section>

	<nav
		class="sticky top-[65px] z-30 flex gap-6 overflow-x-auto border-y border-zinc-200 bg-white/95 px-1 backdrop-blur"
		aria-label="Image generation views"
	>
		{#each [{ id: 'ready', label: 'Ready', count: data.metrics.iconless }, { id: 'generated', label: 'Generated', count: data.generatedBrands.length }, { id: 'review', label: 'Review', count: data.reviewCandidates.length }, { id: 'history', label: 'History', count: data.historyCandidates.length }] as tab (tab.id)}
			<a
				href={pageUrl(tab.id as 'ready' | 'generated' | 'review' | 'history')}
				class="shrink-0 border-b-2 px-1 py-3 text-sm {data.view === tab.id
					? 'border-zinc-950 font-semibold text-zinc-950'
					: 'border-transparent text-zinc-600 hover:text-zinc-950'}"
			>
				{tab.label}
				<span class="ml-1 text-xs text-zinc-500 tabular-nums">{tab.count}</span>
			</a>
		{/each}
	</nav>

	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<label class="relative block min-w-0 flex-1 sm:max-w-xl">
			<span class="sr-only">Search brands</span>
			<svg
				class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-zinc-400"
				viewBox="0 0 24 24"
				fill="none"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
				<path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			</svg>
			<input
				bind:value={q}
				oninput={scheduleSearch}
				placeholder="Search by brand or slug"
				class="h-10 w-full rounded border-zinc-300 pr-3 pl-9 text-sm"
			/>
		</label>
		{#if data.view === 'ready'}
			<form
				method="post"
				action="?/generateBatch"
				use:enhance={actionEnhance('generateBatch')}
				class="flex items-center gap-2"
			>
				<label class="sr-only" for="batch-count">Batch size</label>
				<select id="batch-count" name="count" class="h-10 rounded border-zinc-300 text-sm">
					<option value="1">Next 1</option>
					<option value="3">Next 3</option>
					<option value="5">Next 5</option>
				</select>
				<button
					disabled={!data.storage.ready || !data.storage.isPublic || Boolean(pendingAction)}
					class="h-10 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
				>
					{pendingAction === 'generateBatch' ? 'Running…' : 'Run small batch'}
				</button>
			</form>
		{:else if data.view === 'generated'}
			<div class="flex items-center gap-3">
				<span class="text-xs text-zinc-500 tabular-nums">
					{selectedRegenerationSlugs.size}/5 selected
				</span>
				<button
					type="button"
					onclick={() => openRegeneration()}
					disabled={!selectedRegenerationSlugs.size || Boolean(pendingAction)}
					class="h-10 rounded bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{selectionLabel()}
				</button>
			</div>
		{/if}
	</div>

	{#if modalError && !generating && !publishing && !regenerationConfirm && !comparisonCandidate}
		<div class="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{modalError}</div>
	{/if}

	{#if data.view === 'ready'}
		<section class="overflow-hidden border border-zinc-200 bg-white">
			<div
				class="grid grid-cols-[minmax(0,1fr)_130px_150px_auto] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 uppercase max-md:hidden"
			>
				<span>Brand</span><span>Enrichment</span><span>Latest candidate</span><span></span>
			</div>
			{#each data.iconless as brand (brand.slug)}
				<div
					class="grid items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_130px_150px_auto]"
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-zinc-950">{brand.display}</p>
						<code class="block truncate text-xs text-zinc-500">{brand.slug}</code>
					</div>
					<span
						class="text-xs {brand.dossier_status === 'approved'
							? 'text-emerald-700'
							: 'text-amber-700'}"
					>
						{brand.dossier_status === 'approved'
							? 'Approved'
							: (brand.dossier_status ?? 'No dossier')}
					</span>
					<div class="flex items-center gap-2">
						{#if brand.latest_candidate_url && brand.latest_candidate_status === 'generated'}
							<a
								href={brand.latest_candidate_url}
								target="_blank"
								rel="noreferrer"
								class="block h-10 w-10 shrink-0 overflow-hidden border border-zinc-200 bg-zinc-50 hover:border-zinc-400"
								title={`View generated icon for ${brand.display}`}
							>
								<img
									src={brand.latest_candidate_thumbnail_url ?? brand.latest_candidate_url}
									alt={`Generated icon for ${brand.display}`}
									width="40"
									height="40"
									loading="lazy"
									decoding="async"
									fetchpriority="low"
									class="h-full w-full object-contain"
								/>
							</a>
						{/if}
						<span class="text-xs text-zinc-600"
							>{brand.latest_candidate_status ?? 'Never generated'}</span
						>
					</div>
					<button
						type="button"
						onclick={() => openGenerator(brand, 'auto')}
						disabled={!data.storage.ready || !data.storage.isPublic}
						class="justify-self-start rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 md:justify-self-end"
					>
						Generate
					</button>
				</div>
			{/each}
			{#if data.iconless.length === 0}<p class="px-5 py-12 text-center text-sm text-zinc-500">
					No iconless brands match this search.
				</p>{/if}
		</section>
	{:else if data.view === 'generated'}
		<section>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-zinc-600">
					Select up to five brands. Regenerations stay private until you choose which icon to use.
				</p>
				{#if selectedRegenerationSlugs.size}
					<button
						type="button"
						onclick={() => (selectedRegenerationSlugs = new Set())}
						class="text-sm font-medium text-zinc-600 hover:text-zinc-950"
					>
						Clear selection
					</button>
				{/if}
			</div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
				{#each data.generatedBrands as brand (brand.slug)}
					{@const selected = selectedRegenerationSlugs.has(brand.slug)}
					<article
						class="relative overflow-hidden rounded-lg border bg-white {selected
							? 'border-zinc-950 ring-1 ring-zinc-950'
							: 'border-zinc-200'}"
					>
						<label class="absolute top-2 left-2 z-10">
							<span class="sr-only">Select {brand.display} for regeneration</span>
							<input
								type="checkbox"
								checked={selected}
								onchange={() => toggleRegeneration(brand.slug)}
								disabled={!selected && selectedRegenerationSlugs.size >= 5}
								class="h-5 w-5 rounded border-zinc-400 bg-white text-zinc-950 shadow-sm disabled:opacity-40"
							/>
						</label>
						<button
							type="button"
							onclick={() => toggleRegeneration(brand.slug)}
							disabled={!selected && selectedRegenerationSlugs.size >= 5}
							class="flex aspect-square w-full items-center justify-center border-b border-zinc-200 bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%),linear-gradient(-45deg,#f4f4f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f4f4f5_75%),linear-gradient(-45deg,transparent_75%,#f4f4f5_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] p-4 disabled:cursor-not-allowed"
						>
							{#if brand.icon_thumbnail_url ?? brand.icon_url}
								<img
									src={brand.icon_thumbnail_url ?? brand.icon_url ?? ''}
									alt={`Current icon for ${brand.display}`}
									width="128"
									height="128"
									loading="lazy"
									decoding="async"
									fetchpriority="low"
									class="h-full w-full object-contain"
								/>
							{/if}
						</button>
						<div class="space-y-3 p-3">
							<div class="min-w-0">
								<h2 class="truncate text-sm font-semibold text-zinc-950">{brand.display}</h2>
								<code class="block truncate text-xs text-zinc-500">{brand.slug}</code>
							</div>
							<button
								type="button"
								onclick={() => openRegeneration([brand.slug])}
								disabled={!data.storage.ready || !data.storage.isPublic}
								class="w-full rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
							>
								Regenerate
							</button>
						</div>
					</article>
				{/each}
			</div>
			{#if data.generatedBrands.length === 0}
				<p class="border border-zinc-200 px-5 py-12 text-center text-sm text-zinc-500">
					No generated icons match this search.
				</p>
			{/if}
		</section>
	{:else if data.view === 'review'}
		<section class="divide-y divide-zinc-200 border border-zinc-200 bg-white">
			{#each data.reviewCandidates as candidate (candidate.id)}
				<article class="grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)_auto]">
					<div
						class="flex aspect-square items-center justify-center overflow-hidden border border-zinc-200 bg-[linear-gradient(45deg,#f4f4f5_25%,transparent_25%),linear-gradient(-45deg,#f4f4f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f4f4f5_75%),linear-gradient(-45deg,transparent_75%,#f4f4f5_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]"
					>
						{#if candidate.thumbnail_url ?? candidate.preview_url}<img
								src={candidate.thumbnail_url ?? candidate.preview_url ?? ''}
								alt={`Draft icon for ${candidate.brand_display}`}
								width="112"
								height="112"
								loading="lazy"
								decoding="async"
								fetchpriority="low"
								class="h-full w-full object-contain"
							/>{:else}<span class="px-2 text-center text-xs text-zinc-500"
								>Preview unavailable</span
							>{/if}
					</div>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h2 class="font-semibold text-zinc-950">{candidate.brand_display}</h2>
							<span
								class={`rounded px-2 py-0.5 text-xs font-medium ${statusClass(candidate.status)}`}
								>{candidate.status}</span
							>
						</div>
						<code class="block truncate text-xs text-zinc-500">{candidate.brand_slug}</code>
						<p class="mt-2 text-sm text-zinc-700">
							{conceptText(candidate, 'subject') || 'Concept unavailable'}
							{#if conceptText(candidate, 'primary_motif')}
								· {conceptText(candidate, 'primary_motif')}{/if}
						</p>
						<p class="mt-1 text-xs text-zinc-500">
							{candidate.model} · {candidate.quality} · {candidate.creative_mode.replaceAll(
								'_',
								' '
							)} · updated {relativeDate(candidate.updated_at)}
						</p>
						{#if candidate.error_text}<p class="mt-2 text-xs text-red-700">
								{candidate.error_text}
							</p>{/if}
					</div>
					<div class="flex items-start gap-2 sm:justify-end">
						<button
							type="button"
							onclick={() =>
								openGenerator(
									data.brands.find((brand) => brand.slug === candidate.brand_slug),
									'review'
								)}
							disabled={!data.storage.ready || !data.storage.isPublic}
							class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
							>Regenerate</button
						>
						{#if candidate.status === 'generated'}<button
								type="button"
								onclick={() => {
									publishing = candidate;
									modalError = '';
								}}
								disabled={!data.storage.ready || !data.storage.isPublic}
								class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
								>Publish</button
							>{/if}
					</div>
				</article>
			{/each}
			{#if data.reviewCandidates.length === 0}<p
					class="px-5 py-12 text-center text-sm text-zinc-500"
				>
					No candidates currently need attention.
				</p>{/if}
		</section>
	{:else}
		<section class="overflow-hidden border border-zinc-200 bg-white">
			<div
				class="grid grid-cols-[minmax(0,1fr)_120px_140px_140px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 uppercase max-md:hidden"
			>
				<span>Brand</span><span>Status</span><span>Strategy</span><span>Updated</span>
			</div>
			{#each data.historyCandidates as candidate (candidate.id)}
				<div
					class="grid gap-2 border-b border-zinc-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px_140px_140px] md:items-center md:gap-4"
				>
					{#if candidate.preview_url}
						<a
							href={candidate.preview_url}
							target="_blank"
							rel="noreferrer"
							class="flex min-w-0 items-center gap-3 rounded-sm hover:bg-zinc-50 focus:outline-2 focus:outline-offset-2 focus:outline-zinc-950"
							title={`View ${candidate.status} icon for ${candidate.brand_display}`}
						>
							<img
								src={candidate.thumbnail_url ?? candidate.preview_url}
								alt=""
								width="48"
								height="48"
								loading="lazy"
								decoding="async"
								fetchpriority="low"
								class="h-12 w-12 shrink-0 border border-zinc-200 bg-zinc-50 object-contain"
							/>
							<span class="min-w-0">
								<span class="block truncate text-sm font-semibold text-zinc-950"
									>{candidate.brand_display}</span
								>
								<code class="block truncate text-xs text-zinc-500">{candidate.id}</code>
							</span>
						</a>
					{:else}
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-zinc-950">{candidate.brand_display}</p>
							<code class="block truncate text-xs text-zinc-500">{candidate.id}</code>
						</div>
					{/if}
					<span
						class={`w-fit rounded px-2 py-0.5 text-xs font-medium ${statusClass(candidate.status)}`}
						>{candidate.status}</span
					>
					<span class="text-xs text-zinc-600"
						>{candidate.publication_strategy.replaceAll('_', ' ')}</span
					>
					<span class="text-xs text-zinc-500">{relativeDate(candidate.updated_at)}</span>
				</div>
			{/each}
			{#if data.historyCandidates.length === 0}<p
					class="px-5 py-12 text-center text-sm text-zinc-500"
				>
					No image-generation history yet.
				</p>{/if}
		</section>
	{/if}
</main>

<datalist id="brand-options">
	{#each data.brands as brand (brand.slug)}<option value={brand.slug}>{brand.display}</option
		>{/each}
</datalist>

{#if regenerationConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="regenerate-title"
		>
			<header class="border-b border-zinc-200 px-5 py-4">
				<h2 id="regenerate-title" class="text-lg font-semibold text-zinc-950">
					Confirm regeneration
				</h2>
				<p class="mt-1 text-sm text-zinc-600">
					Generate {selectedRegenerationSlugs.size} replacement{selectedRegenerationSlugs.size === 1
						? ''
						: 's'} for review. Current icons remain live.
				</p>
			</header>
			<form
				method="post"
				action="?/regenerateSelected"
				use:enhance={actionEnhance('regenerateSelected')}
				class="min-h-0 overflow-y-auto"
			>
				{#each [...selectedRegenerationSlugs] as slug (slug)}
					<input type="hidden" name="brand_slugs" value={slug} />
				{/each}
				<div class="space-y-5 px-5 py-5">
					<div class="max-h-40 divide-y divide-zinc-100 overflow-y-auto border-y border-zinc-200">
						{#each data.generatedBrands.filter( (brand) => selectedRegenerationSlugs.has(brand.slug) ) as brand (brand.slug)}
							<div class="flex items-center gap-3 py-2">
								{#if brand.icon_thumbnail_url ?? brand.icon_url}<img
										src={brand.icon_thumbnail_url ?? brand.icon_url ?? ''}
										alt=""
										width="40"
										height="40"
										decoding="async"
										class="h-10 w-10 shrink-0 object-contain"
									/>{/if}
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-zinc-900">{brand.display}</p>
									<code class="block truncate text-xs text-zinc-500">{brand.slug}</code>
								</div>
							</div>
						{/each}
					</div>
					<label class="block">
						<span class="text-sm font-medium text-zinc-800">Quality</span>
						<select
							name="quality"
							bind:value={regenerationQuality}
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						>
							<option value="auto">Automatic</option>
							<option value="low">Low</option>
							<option value="medium">Medium</option>
							<option value="high">High</option>
						</select>
					</label>
					<label class="block">
						<span class="text-sm font-medium text-zinc-800">Optional shared art direction</span>
						<textarea
							name="direction"
							bind:value={regenerationDirection}
							rows="3"
							maxlength="1000"
							placeholder="Applied to every selected brand"
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						></textarea>
					</label>
					<div class="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
						This starts {selectedRegenerationSlugs.size} paid image generation request{selectedRegenerationSlugs.size ===
						1
							? ''
							: 's'}. The batch limit is five.
					</div>
					{#if modalError}<div
							class="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
						>
							{modalError}
						</div>{/if}
				</div>
				<footer class="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4">
					<button
						type="button"
						onclick={closeModal}
						disabled={Boolean(pendingAction)}
						class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						disabled={Boolean(pendingAction)}
						class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
					>
						{pendingAction === 'regenerateSelected' ? 'Generating…' : 'Confirm regeneration'}
					</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

{#if comparisonCandidate}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
		<div
			class="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="comparison-title"
		>
			<header class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<p class="text-xs font-semibold text-zinc-500 uppercase">
						{comparisonCompleted + 1} of {comparisonTotal}
					</p>
					<h2 id="comparison-title" class="mt-1 text-lg font-semibold text-zinc-950">
						Choose an icon for {comparisonCandidate.brand_display}
					</h2>
				</div>
				<div class="h-1.5 w-28 overflow-hidden rounded bg-zinc-200" aria-hidden="true">
					<div
						class="h-full bg-zinc-950"
						style={`width: ${((comparisonCompleted + 1) / comparisonTotal) * 100}%`}
					></div>
				</div>
			</header>
			<div class="min-h-0 overflow-y-auto px-5 py-5">
				<div class="grid gap-4 sm:grid-cols-2">
					<section class="overflow-hidden rounded-lg border border-zinc-200">
						<div class="flex aspect-square items-center justify-center bg-zinc-50 p-5">
							{#if comparisonCandidate.current_icon_url}<img
									src={comparisonCandidate.current_icon_url}
									alt={`Current icon for ${comparisonCandidate.brand_display}`}
									class="h-full w-full object-contain"
								/>{/if}
						</div>
						<div class="border-t border-zinc-200 p-3">
							<p class="text-sm font-semibold text-zinc-950">Current icon</p>
							<p class="text-xs text-zinc-500">Remains live unless you publish the regeneration.</p>
						</div>
					</section>
					<section class="overflow-hidden rounded-lg border border-zinc-950 ring-1 ring-zinc-950">
						<div class="flex aspect-square items-center justify-center bg-zinc-50 p-5">
							{#if comparisonCandidate.preview_url}<img
									src={comparisonCandidate.preview_url}
									alt={`Regenerated icon for ${comparisonCandidate.brand_display}`}
									class="h-full w-full object-contain"
								/>{/if}
						</div>
						<div class="border-t border-zinc-200 p-3">
							<p class="text-sm font-semibold text-zinc-950">Regenerated icon</p>
							<p class="text-xs text-zinc-500">
								{comparisonCandidate.model} · {comparisonCandidate.quality} · {comparisonCandidate.creative_mode.replaceAll(
									'_',
									' '
								)}
							</p>
						</div>
					</section>
				</div>
				{#if modalError}<div
						class="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{modalError}
					</div>{/if}
			</div>
			<footer
				class="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4 sm:flex-row sm:justify-end"
			>
				<button
					type="button"
					onclick={closeModal}
					disabled={Boolean(pendingAction)}
					class="rounded px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40"
				>
					Review later
				</button>
				<form
					method="post"
					action="?/rejectCandidate"
					use:enhance={actionEnhance('rejectComparison')}
				>
					<input type="hidden" name="candidate_id" value={comparisonCandidate.id} />
					<button
						disabled={Boolean(pendingAction)}
						class="w-full rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-40"
					>
						{pendingAction === 'rejectComparison' ? 'Saving…' : 'Keep current'}
					</button>
				</form>
				<form
					method="post"
					action="?/publishCandidate"
					use:enhance={actionEnhance('publishComparison')}
				>
					<input type="hidden" name="candidate_id" value={comparisonCandidate.id} />
					<button
						disabled={Boolean(pendingAction)}
						class="w-full rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
					>
						{pendingAction === 'publishComparison' ? 'Publishing…' : 'Use regenerated'}
					</button>
				</form>
			</footer>
		</div>
	</div>
{/if}

{#if generating}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="generate-title"
		>
			<header class="border-b border-zinc-200 px-5 py-4">
				<h2 id="generate-title" class="text-lg font-semibold text-zinc-950">Generate brand icon</h2>
				<p class="mt-1 text-sm text-zinc-600">
					The function loads canonical identity and enrichment evidence directly.
				</p>
			</header>
			<form
				method="post"
				action="?/generateIcon"
				use:enhance={actionEnhance('generateIcon')}
				class="min-h-0 overflow-y-auto"
			>
				<div class="space-y-5 px-5 py-5">
					<label class="block"
						><span class="text-sm font-medium text-zinc-800">Brand slug</span><input
							name="brand_slug"
							list="brand-options"
							bind:value={selectedSlug}
							autocomplete="off"
							required
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						/></label
					>
					{#if selectedBrand}
						<div class="flex items-center justify-between gap-4 border-y border-zinc-200 py-3">
							<div>
								<p class="text-sm font-semibold text-zinc-950">{selectedBrand.display}</p>
								<p class="text-xs text-zinc-500">
									{selectedBrand.icon_path
										? 'A live icon already exists.'
										: 'No live icon; auto mode will publish.'}
								</p>
							</div>
							{#if selectedBrand.icon_thumbnail_url ?? selectedBrand.icon_url}<img
									src={selectedBrand.icon_thumbnail_url ?? selectedBrand.icon_url ?? ''}
									alt="Current brand icon"
									width="56"
									height="56"
									decoding="async"
									class="h-14 w-14 object-contain"
								/>{/if}
						</div>
					{/if}
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block"
							><span class="text-sm font-medium text-zinc-800">Quality</span><select
								name="quality"
								bind:value={quality}
								class="mt-1 block w-full rounded border-zinc-300 text-sm"
								><option value="auto">Automatic</option><option value="low">Low</option><option
									value="medium">Medium</option
								><option value="high">High</option></select
							></label
						>
						<label class="block"
							><span class="text-sm font-medium text-zinc-800">Publication mode</span><select
								name="publish_mode"
								bind:value={publishMode}
								onchange={() => (confirmReplace = false)}
								class="mt-1 block w-full rounded border-zinc-300 text-sm"
								><option value="auto">Auto if missing</option><option value="review"
									>Hold for review</option
								><option value="force">Force replacement</option></select
							></label
						>
					</div>
					<p class="text-xs text-zinc-500">
						{publishMode === 'auto'
							? 'Publishes only when the brand has no live icon; otherwise creates a review draft.'
							: publishMode === 'review'
								? 'Always creates a draft and leaves the live icon unchanged.'
								: 'Immediately replaces the live icon after generation.'}
					</p>
					<label class="block"
						><span class="text-sm font-medium text-zinc-800">Optional art direction</span><textarea
							name="direction"
							bind:value={direction}
							rows="3"
							maxlength="1000"
							placeholder="Use a sleepy red panda holding a jasmine flower"
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						></textarea></label
					>
					{#if publishMode === 'force'}<label
							class="flex items-start gap-2 border border-red-200 bg-red-50 p-3 text-sm text-red-900"
							><input
								type="checkbox"
								name="confirm_replace_existing"
								value="true"
								bind:checked={confirmReplace}
								class="mt-0.5 rounded border-red-300 text-red-700"
							/><span
								>I understand this generates and immediately replaces the current live icon.</span
							></label
						>{/if}
					{#if modalError}<div
							class="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
						>
							{modalError}
						</div>{/if}
				</div>
				<footer
					class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4"
				>
					<p class="text-xs text-zinc-500">Generation can take several minutes.</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={closeModal}
							disabled={Boolean(pendingAction)}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
							>Cancel</button
						><button
							disabled={!selectedSlug.trim() ||
								(publishMode === 'force' && !confirmReplace) ||
								Boolean(pendingAction)}
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
							>{pendingAction === 'generateIcon'
								? 'Generating…'
								: publishMode === 'force'
									? 'Generate and replace'
									: 'Generate'}</button
						>
					</div>
				</footer>
			</form>
		</div>
	</div>
{/if}

{#if publishing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="publish-title"
		>
			<header class="border-b border-zinc-200 px-5 py-4">
				<h2 id="publish-title" class="text-lg font-semibold text-zinc-950">
					Publish reviewed icon
				</h2>
				<p class="mt-1 text-sm text-zinc-600">
					This candidate will replace the current live icon for {publishing.brand_display}.
				</p>
			</header>
			<form
				method="post"
				action="?/publishCandidate"
				use:enhance={actionEnhance('publishCandidate')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="candidate_id" value={publishing.id} />
				{#if publishing.preview_url}<div
						class="mx-auto flex aspect-square w-48 items-center justify-center border border-zinc-200 bg-zinc-50"
					>
						<img
							src={publishing.preview_url}
							alt={`Candidate for ${publishing.brand_display}`}
							class="h-full w-full object-contain"
						/>
					</div>{/if}
				{#if modalError}<div class="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{modalError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeModal}
						disabled={Boolean(pendingAction)}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
						>Cancel</button
					><button
						disabled={Boolean(pendingAction)}
						class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
						>{pendingAction === 'publishCandidate' ? 'Publishing…' : 'Confirm and publish'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
