<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ReviewTabs from '$lib/ReviewTabs.svelte';
	import { toasts } from '$lib/toast';
	import type { SubmitFunction } from './$types';

	type OsmCandidateStatus =
		| 'pending'
		| 'merged'
		| 'approved'
		| 'needs_review'
		| 'blocked'
		| 'rejected';
	type LlmReviewStatus = 'pending' | 'processing' | 'reviewed' | 'failed';
	type PipelineState =
		| 'applied_approved'
		| 'applied_blocked'
		| 'applied_merged'
		| 'awaiting_current_llm_review'
		| 'not_reviewed_yet'
		| 'waiting_manual_review'
		| 'waiting_region_reconciliation';
	type ReviewTab = 'manual' | 'region' | 'awaiting' | 'not_reviewed' | 'history';

	type Candidate = {
		id: string;
		name: string | null;
		normalized_name: string | null;
		lat: number | null;
		lon: number | null;
		tags: Record<string, string> | null;
		matched_brand_slug: string | null;
		match_score: number | null;
		blocked_brand: boolean;
		blocked_reason: string | null;
		staging_id: string | null;
		process_status: OsmCandidateStatus;
		llm_review_status: LlmReviewStatus | null;
		llm_review_error: string | null;
		pipeline_state: PipelineState;
		region_key: string | null;
		detected_region_key: string | null;
		region_consistency_status: string | null;
		llm_primary_business_type: string | null;
		created_at: string;
	};

	type LatestReview = {
		id: string;
		model: string | null;
		action: string | null;
		proposed_brand_slug: string | null;
		proposed_display: string | null;
		confidence: number | null;
		reason: string | null;
		evidence: unknown[] | null;
		sources: unknown[] | null;
		evidence_flags: Record<string, unknown> | null;
		risk_flags: Record<string, unknown> | null;
		is_boba_or_tea_business: boolean | null;
		appears_currently_open: boolean | null;
		auto_decision: string | null;
		reviewer_version: string | null;
		created_at: string;
	};

	type AliasSuggestion = {
		brand_slug: string;
		brand_display: string;
		alias: string;
		score: number;
		match_mode: string;
		website: string | null;
		wikidata: string | null;
	};

	type BrandLookupResult = {
		slug: string;
		display: string;
		website: string | null;
		wikidata: string | null;
		matched_alias: string | null;
	};

	export let data: {
		candidates: Candidate[];
		reviewTabs: Array<{ id: ReviewTab; states: PipelineState[] }>;
		pipelineStateCounts: Partial<Record<PipelineState, number>>;
		latestReviewByCandidate: Record<string, LatestReview>;
		similarAliasesByCandidate: Record<string, AliasSuggestion[]>;
		reviewTab: ReviewTab;
		q: string;
	};

	const reviewTabLabels: Record<ReviewTab, string> = {
		manual: 'Manual Review',
		region: 'Region Reconciliation',
		awaiting: 'Awaiting Current LLM',
		not_reviewed: 'Not Reviewed',
		history: 'Applied / History'
	};

	const pipelineStateLabels: Record<PipelineState, string> = {
		applied_approved: 'Applied approved',
		applied_blocked: 'Applied blocked',
		applied_merged: 'Applied merged',
		awaiting_current_llm_review: 'Awaiting current LLM',
		not_reviewed_yet: 'Not reviewed',
		waiting_manual_review: 'Manual review',
		waiting_region_reconciliation: 'Region reconciliation'
	};

	let searchTerm = data.q;
	let lastSyncedQ = data.q;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let brandQuery = '';
	let brandResults: BrandLookupResult[] = [];
	let brandLoading = false;
	let brandOpen = false;
	let brandSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let brandSearchBox: HTMLDivElement | null = null;
	let mergeSlugs: Record<string, string> = {};

	$: if (data.q !== lastSyncedQ) {
		searchTerm = data.q;
		lastSyncedQ = data.q;
	}

	function reviewUrl(tab = data.reviewTab, q = searchTerm) {
		const params = new URLSearchParams({ tab });
		if (q.trim()) params.set('q', q.trim());
		return `/admin/reviews?${params.toString()}`;
	}

	function applyFilters(tab = data.reviewTab, q = searchTerm, replaceState = false) {
		return goto(reviewUrl(tab, q), { keepFocus: true, noScroll: true, replaceState });
	}

	function scheduleCandidateSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			void applyFilters(data.reviewTab, searchTerm, true);
		}, 250);
	}

	function scheduleBrandSearch() {
		if (brandSearchTimer) clearTimeout(brandSearchTimer);
		const query = brandQuery.trim();
		if (query.length < 2) {
			brandResults = [];
			brandOpen = false;
			return;
		}
		brandSearchTimer = setTimeout(() => void runBrandSearch(query), 200);
	}

	async function runBrandSearch(query: string) {
		brandLoading = true;
		try {
			const response = await fetch(`/admin/_api/brand-search?q=${encodeURIComponent(query)}`);
			if (!response.ok) throw new Error('Brand lookup failed');
			brandResults = await response.json();
			brandOpen = true;
		} catch (lookupError) {
			console.error(lookupError);
			brandResults = [];
			brandOpen = true;
		} finally {
			brandLoading = false;
		}
	}

	function setMergeSlug(candidateId: string, slug: string) {
		mergeSlugs = { ...mergeSlugs, [candidateId]: slug };
	}

	async function copySlug(slug: string) {
		try {
			await navigator.clipboard.writeText(slug);
			toasts.success(`Copied ${slug}`);
		} catch (copyError) {
			console.error(copyError);
			toasts.error('Could not copy slug');
		}
	}

	const enhanceAction: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true, keepFocus: true, noScroll: true });
				return;
			}
			await applyAction(result);
		};
	};

	function locationLabel(candidate: Candidate) {
		const tags = candidate.tags ?? {};
		const number = tags['addr:housenumber'] ?? '';
		const street = tags['addr:street'] ?? '';
		const city = tags['addr:city'] ?? tags.city ?? tags.town ?? tags.village ?? '';
		if (street || number) return `${number ? `${number} ` : ''}${street}${city ? `, ${city}` : ''}`;
		if (city) return city;
		if (typeof candidate.lat === 'number' && typeof candidate.lon === 'number') {
			return `${candidate.lat.toFixed(5)}, ${candidate.lon.toFixed(5)}`;
		}
		return 'Location unavailable';
	}

	function mapLink(candidate: Candidate) {
		if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') return null;
		return `https://www.openstreetmap.org/?mlat=${candidate.lat}&mlon=${candidate.lon}#map=18/${candidate.lat}/${candidate.lon}`;
	}

	function osmWebsite(candidate: Candidate) {
		const website = candidate.tags?.website ?? candidate.tags?.['contact:website'];
		return safeUrl(website);
	}

	function safeUrl(value: unknown) {
		if (typeof value !== 'string' || !value.trim()) return null;
		try {
			const url = new URL(value.trim());
			return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
		} catch {
			return null;
		}
	}

	function wikidataUrl(value: string | null) {
		if (!value) return null;
		const direct = safeUrl(value);
		if (direct) return direct;
		return /^Q\d+$/i.test(value.trim()) ? `https://www.wikidata.org/wiki/${value.trim()}` : null;
	}

	function sourceUrl(value: unknown) {
		if (typeof value === 'string') return safeUrl(value);
		if (value && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			return safeUrl(record.url ?? record.href ?? record.source);
		}
		return null;
	}

	function sourceLabel(value: unknown, index: number) {
		if (value && typeof value === 'object') {
			const record = value as Record<string, unknown>;
			if (typeof record.title === 'string') return record.title;
			if (typeof record.label === 'string') return record.label;
		}
		const url = sourceUrl(value);
		if (url) {
			try {
				return new URL(url).hostname.replace(/^www\./, '');
			} catch {
				return `Source ${index + 1}`;
			}
		}
		return `Source ${index + 1}`;
	}

	function evidenceText(value: unknown) {
		if (typeof value === 'string') return value;
		if (value && typeof value === 'object') {
			return Object.entries(value as Record<string, unknown>)
				.filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
				.map(([key, item]) => `${key.replaceAll('_', ' ')}: ${String(item)}`)
				.join(' · ');
		}
		return String(value ?? '');
	}

	function visibleFlags(flags: Record<string, unknown> | null) {
		return Object.entries(flags ?? {}).filter(([, value]) => value === true || (typeof value === 'string' && value));
	}

	function formatNumber(value: number | null | undefined) {
		return new Intl.NumberFormat().format(value ?? 0);
	}

	function tabCount(tab: { states: PipelineState[] }) {
		return tab.states.reduce((total, state) => total + (data.pipelineStateCounts[state] ?? 0), 0);
	}

	onMount(() => {
		const closeLookup = (event: MouseEvent) => {
			if (brandSearchBox && !brandSearchBox.contains(event.target as Node)) brandOpen = false;
		};
		document.addEventListener('click', closeLookup);
		return () => document.removeEventListener('click', closeLookup);
	});
</script>

<svelte:head><title>Review queue | Bobadex Admin</title></svelte:head>

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<header class="border-b border-zinc-200 pb-5">
		<p class="text-xs font-semibold text-teal-700 uppercase">Location pipeline</p>
		<h1 class="mt-1 text-2xl font-semibold text-zinc-950">Review queue</h1>
		<p class="mt-2 max-w-3xl text-sm text-zinc-600">
			Compare source evidence, model inferences, and existing aliases before taking action.
		</p>
		<div class="mt-5"><ReviewTabs active="candidates" /></div>
	</header>

	<section class="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Location pipeline states">
		{#each data.reviewTabs as tab}
			<button type="button" class={`rounded-lg border p-3 text-left ${data.reviewTab === tab.id ? 'border-zinc-950 bg-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50'}`} on:click={() => applyFilters(tab.id, searchTerm)}>
				<div class="text-xs text-zinc-500">{reviewTabLabels[tab.id]}</div>
				<div class="mt-1 text-xl font-semibold text-zinc-950">{formatNumber(tabCount(tab))}</div>
			</button>
		{/each}
	</section>

	<section class="sticky top-[61px] z-30 mt-5 border-y border-zinc-200 bg-white/95 py-3 backdrop-blur">
		<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
			<div class="relative" bind:this={brandSearchBox}>
				<div class="flex items-center gap-3 rounded-md border border-zinc-300 bg-white px-3 shadow-sm focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-200">
					<svg class="h-4 w-4 shrink-0 text-zinc-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387-1.414 1.414-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clip-rule="evenodd" /></svg>
					<div class="min-w-0 flex-1 py-2">
						<label for="brand-lookup" class="block text-[10px] font-semibold text-zinc-500 uppercase">Check existing brands and aliases</label>
						<input id="brand-lookup" class="w-full border-0 bg-transparent p-0 text-sm text-zinc-950 placeholder:text-zinc-400 focus:ring-0" placeholder="Search before creating a brand" bind:value={brandQuery} on:input={scheduleBrandSearch} on:focus={() => (brandOpen = brandResults.length > 0)} />
					</div>
					{#if brandLoading}<span class="text-xs text-zinc-500">Searching</span>{/if}
				</div>

				{#if brandOpen}
					<div class="absolute right-0 left-0 z-40 mt-1 max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white shadow-xl">
						{#each brandResults as brand}
							<div class="flex items-center justify-between gap-4 border-b border-zinc-100 px-3 py-2.5 last:border-b-0">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-zinc-950">{brand.display}</p>
									<p class="truncate text-xs text-zinc-500">{brand.slug}{brand.matched_alias ? ` · alias: ${brand.matched_alias}` : ''}</p>
								</div>
								<div class="flex shrink-0 items-center gap-3 text-xs">
									{#if safeUrl(brand.website)}<a href={safeUrl(brand.website) ?? '#'} target="_blank" rel="noreferrer" class="text-zinc-600 hover:text-zinc-950">Website</a>{/if}
									{#if wikidataUrl(brand.wikidata)}<a href={wikidataUrl(brand.wikidata) ?? '#'} target="_blank" rel="noreferrer" class="text-zinc-600 hover:text-zinc-950">Wikidata</a>{/if}
									<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950" title={`Copy slug: ${brand.slug}`} aria-label={`Copy slug for ${brand.display}`} on:click={() => copySlug(brand.slug)}>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
									</button>
								</div>
							</div>
						{/each}
						{#if brandResults.length === 0}<p class="px-4 py-6 text-center text-sm text-zinc-500">No matching brand or alias.</p>{/if}
					</div>
				{/if}
			</div>

			<form method="GET" class="flex items-center gap-2" on:submit|preventDefault={() => applyFilters(data.reviewTab, searchTerm)}>
				<select name="tab" aria-label="Location pipeline state" class="rounded-md border-zinc-300 py-2 text-sm" value={data.reviewTab} on:change={(event) => applyFilters((event.currentTarget as HTMLSelectElement).value as ReviewTab, searchTerm)}>
					{#each data.reviewTabs as tab}<option value={tab.id}>{reviewTabLabels[tab.id]}</option>{/each}
				</select>
				<input name="q" aria-label="Search candidates" class="min-w-0 rounded-md border-zinc-300 py-2 text-sm lg:w-56" placeholder="Filter candidates" bind:value={searchTerm} on:input={scheduleCandidateSearch} />
			</form>
		</div>
	</section>

	<section class="mt-5 space-y-4" aria-label="Candidate decisions">
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-zinc-950">Candidate decisions</h2>
			<span class="text-xs text-zinc-500">Showing {data.candidates.length}</span>
		</div>

		{#each data.candidates as candidate}
			{@const latestReview = data.latestReviewByCandidate[candidate.id]}
			{@const aliasSuggestions = data.similarAliasesByCandidate[candidate.id] ?? []}
			{@const canAct = candidate.pipeline_state === 'waiting_manual_review' || candidate.pipeline_state === 'waiting_region_reconciliation'}
			<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
				<header class="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="truncate text-base font-semibold text-zinc-950">{candidate.name ?? 'Unnamed candidate'}</h3>
							<span class="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">{pipelineStateLabels[candidate.pipeline_state]}</span>
							<span class="rounded bg-zinc-200/70 px-2 py-0.5 text-[11px] text-zinc-700">OSM</span>
						</div>
						<p class="mt-1 truncate text-xs text-zinc-500">{candidate.normalized_name ?? 'No normalized name'} · {locationLabel(candidate)}</p>
					</div>
					<div class="flex shrink-0 items-center gap-3 text-xs">
						{#if mapLink(candidate)}<a class="font-medium text-blue-700 hover:text-blue-900" href={mapLink(candidate) ?? '#'} target="_blank" rel="noreferrer">OSM map</a>{/if}
						{#if osmWebsite(candidate)}<a class="font-medium text-blue-700 hover:text-blue-900" href={osmWebsite(candidate) ?? '#'} target="_blank" rel="noreferrer">Website</a>{/if}
						<span class="text-zinc-500">{new Date(candidate.created_at).toLocaleDateString()}</span>
					</div>
				</header>

				<div class="grid divide-y divide-zinc-200 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_20rem] xl:divide-x xl:divide-y-0">
					<section class="p-4">
						<h4 class="text-xs font-semibold text-zinc-500 uppercase">Source evidence</h4>
						<dl class="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
							<dt class="text-zinc-500">Location</dt><dd class="text-zinc-900">{locationLabel(candidate)}</dd>
							<dt class="text-zinc-500">Match target</dt><dd class="font-medium text-zinc-900">{candidate.matched_brand_slug ?? 'None'}</dd>
							<dt class="text-zinc-500">Match score</dt><dd class="text-zinc-900">{candidate.match_score !== null ? `${Math.round(candidate.match_score * 100)}%` : 'None'}</dd>
							<dt class="text-zinc-500">OSM category</dt><dd class="text-zinc-900">{candidate.tags?.amenity ?? candidate.tags?.shop ?? candidate.tags?.cuisine ?? 'Unspecified'}</dd>
							<dt class="text-zinc-500">Business type</dt><dd class="text-zinc-900">{candidate.llm_primary_business_type?.replaceAll('_', ' ') ?? 'Unknown'}</dd>
							<dt class="text-zinc-500">OSM region</dt><dd class="text-zinc-900">{candidate.region_key ?? 'Missing'}</dd>
							<dt class="text-zinc-500">Detected region</dt><dd class="text-zinc-900">{candidate.detected_region_key ?? 'Missing'}</dd>
							<dt class="text-zinc-500">Region check</dt><dd class="text-zinc-900">{candidate.region_consistency_status?.replaceAll('_', ' ') ?? 'Unknown'}</dd>
						</dl>
						{#if candidate.blocked_reason || candidate.llm_review_error}
							<p class="mt-3 border-l-2 border-red-400 bg-red-50 px-3 py-2 text-xs text-red-700">{candidate.blocked_reason ?? candidate.llm_review_error}</p>
						{/if}
						{#if candidate.tags && Object.keys(candidate.tags).length}
							<details class="mt-4 border-t border-zinc-100 pt-3">
								<summary class="cursor-pointer text-xs font-medium text-zinc-600">All OSM tags ({Object.keys(candidate.tags).length})</summary>
								<div class="mt-2 grid gap-1.5 text-xs text-zinc-700 sm:grid-cols-2 xl:grid-cols-1">
									{#each Object.entries(candidate.tags) as [key, value]}<div class="break-words"><span class="text-zinc-500">{key}:</span> {String(value)}</div>{/each}
								</div>
							</details>
						{/if}
					</section>

					<section class="p-4">
						<div class="flex items-center justify-between gap-3">
							<h4 class="text-xs font-semibold text-zinc-500 uppercase">Decision intelligence</h4>
							{#if latestReview}<span class="rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">{latestReview.model ?? 'LLM'}{latestReview.confidence !== null ? ` · ${Math.round(latestReview.confidence * 100)}%` : ''}</span>{/if}
						</div>

						{#if latestReview}
							<div class="mt-3 rounded-md border border-blue-100 bg-blue-50/40 p-3">
								<div class="flex flex-wrap gap-2">
									<span class="rounded bg-white px-2 py-1 text-xs font-semibold text-blue-800">{latestReview.auto_decision ?? latestReview.action ?? 'reviewed'}</span>
									{#if latestReview.proposed_display}<span class="rounded bg-white px-2 py-1 text-xs text-zinc-700">Display: {latestReview.proposed_display}</span>{/if}
									{#if latestReview.proposed_brand_slug}<span class="rounded bg-white px-2 py-1 text-xs text-zinc-700">Brand: {latestReview.proposed_brand_slug}</span>{/if}
								</div>
								<div class="mt-3 grid grid-cols-2 gap-2 text-xs">
									<div><span class="text-zinc-500">Tea business</span><p class="font-medium text-zinc-900">{latestReview.is_boba_or_tea_business === null ? 'Unknown' : latestReview.is_boba_or_tea_business ? 'Yes' : 'No'}</p></div>
									<div><span class="text-zinc-500">Currently open</span><p class="font-medium text-zinc-900">{latestReview.appears_currently_open === null ? 'Unknown' : latestReview.appears_currently_open ? 'Yes' : 'No'}</p></div>
								</div>
								{#if latestReview.reason}<p class="mt-3 text-xs leading-5 text-zinc-700">{latestReview.reason}</p>{/if}
								{#if latestReview.evidence?.length}
									<ul class="mt-3 space-y-1.5 border-t border-blue-100 pt-3">
										{#each latestReview.evidence.slice(0, 5) as item}<li class="flex gap-2 text-xs text-zinc-700"><span class="text-blue-500">•</span><span>{evidenceText(item)}</span></li>{/each}
									</ul>
								{/if}
								{#if latestReview.sources?.length}
									<div class="mt-3 flex flex-wrap gap-2 border-t border-blue-100 pt-3">
										{#each latestReview.sources.slice(0, 8) as source, index}
											{#if sourceUrl(source)}<a href={sourceUrl(source) ?? '#'} target="_blank" rel="noreferrer" class="rounded border border-blue-200 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:border-blue-400">{sourceLabel(source, index)} ↗</a>{/if}
										{/each}
									</div>
									{#if latestReview.sources.length > 8}
										<details class="mt-2 text-xs">
											<summary class="cursor-pointer font-medium text-blue-700">{latestReview.sources.length - 8} more sources</summary>
											<div class="mt-2 flex flex-wrap gap-2">
												{#each latestReview.sources.slice(8) as source, index}
													{#if sourceUrl(source)}<a href={sourceUrl(source) ?? '#'} target="_blank" rel="noreferrer" class="rounded border border-blue-200 bg-white px-2 py-1 font-medium text-blue-700 hover:border-blue-400">{sourceLabel(source, index + 8)} ↗</a>{/if}
												{/each}
											</div>
										</details>
									{/if}
								{/if}
								{#if visibleFlags(latestReview.evidence_flags).length}<div class="mt-3 flex flex-wrap gap-1.5">{#each visibleFlags(latestReview.evidence_flags) as [key]}<span class="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">{key.replaceAll('_', ' ')}</span>{/each}</div>{/if}
								{#if visibleFlags(latestReview.risk_flags).length}<div class="mt-3 flex flex-wrap gap-1.5">{#each visibleFlags(latestReview.risk_flags) as [key]}<span class="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{key.replaceAll('_', ' ')}</span>{/each}</div>{/if}
							</div>
						{:else}
							<p class="mt-3 rounded-md bg-zinc-50 px-3 py-4 text-xs text-zinc-500">No LLM inference has been recorded for this candidate.</p>
						{/if}

						<div class="mt-4">
							<div class="flex items-center justify-between"><h5 class="text-xs font-semibold text-zinc-700">Similar existing aliases</h5><span class="text-[11px] text-zinc-400">heuristic match</span></div>
							<div class="mt-2 space-y-2">
								{#each aliasSuggestions as suggestion}
									<div class="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2">
										<div class="min-w-0">
											<p class="truncate text-xs font-medium text-zinc-900">{suggestion.brand_display} <span class="font-normal text-zinc-500">{Math.round(suggestion.score * 100)}%</span></p>
											<p class="truncate text-[11px] text-zinc-500">{suggestion.alias} · {suggestion.brand_slug}</p>
										</div>
										<div class="flex shrink-0 items-center gap-2">
											{#if safeUrl(suggestion.website)}<a href={safeUrl(suggestion.website) ?? '#'} target="_blank" rel="noreferrer" class="text-[11px] text-zinc-500 hover:text-zinc-900">Site</a>{/if}
											{#if wikidataUrl(suggestion.wikidata)}<a href={wikidataUrl(suggestion.wikidata) ?? '#'} target="_blank" rel="noreferrer" class="text-[11px] text-zinc-500 hover:text-zinc-900">WD</a>{/if}
											<button type="button" class="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-200" on:click={() => setMergeSlug(candidate.id, suggestion.brand_slug)}>Use</button>
										</div>
									</div>
								{/each}
								{#if aliasSuggestions.length === 0}<p class="text-xs text-zinc-500">No convincing alias match found.</p>{/if}
							</div>
						</div>
					</section>

					<aside class="space-y-4 bg-zinc-50/50 p-4">
						{#if canAct}
						<div>
							<h4 class="text-xs font-semibold text-zinc-500 uppercase">Create new brand</h4>
							<form method="POST" action="?/approve" class="mt-2 space-y-2" use:enhance={enhanceAction}>
								<input type="hidden" name="candidate_id" value={candidate.id} /><input type="hidden" name="filter_tab" value={data.reviewTab} /><input type="hidden" name="filter_q" value={searchTerm} />
								<label class="block"><span class="sr-only">Display name</span><input name="force_display" class="w-full rounded-md border-zinc-300 px-3 py-2 text-xs" placeholder="Brand display name" value={latestReview?.proposed_display ?? candidate.name ?? ''} /></label>
								<label class="block"><span class="sr-only">Approval note</span><input name="note" class="w-full rounded-md border-zinc-300 px-3 py-2 text-xs" placeholder="Approval note" /></label>
								<button class="h-9 w-full rounded-md bg-blue-700 px-3 text-xs font-semibold text-white hover:bg-blue-800">Approve new brand</button>
							</form>
						</div>

						<div class="border-t border-zinc-200 pt-4">
							<h4 class="text-xs font-semibold text-zinc-500 uppercase">Merge existing</h4>
							<form method="POST" action="?/merge" class="mt-2 space-y-2" use:enhance={enhanceAction}>
								<input type="hidden" name="candidate_id" value={candidate.id} /><input type="hidden" name="filter_tab" value={data.reviewTab} /><input type="hidden" name="filter_q" value={searchTerm} />
								<label class="block"><span class="sr-only">Brand slug</span><input name="brand_slug" required class="w-full rounded-md border-zinc-300 px-3 py-2 font-mono text-xs" placeholder="Existing brand slug" value={mergeSlugs[candidate.id] ?? latestReview?.proposed_brand_slug ?? candidate.matched_brand_slug ?? ''} on:input={(event) => setMergeSlug(candidate.id, event.currentTarget.value)} /></label>
								<label class="block"><span class="sr-only">Merge note</span><input name="note" class="w-full rounded-md border-zinc-300 px-3 py-2 text-xs" placeholder="Merge note" /></label>
								<button class="h-9 w-full rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700">Merge into brand</button>
							</form>
						</div>

						<div class="border-t border-zinc-200 pt-4">
							<form method="POST" action="?/reject" class="space-y-2" use:enhance={enhanceAction}>
								<input type="hidden" name="candidate_id" value={candidate.id} /><input type="hidden" name="filter_tab" value={data.reviewTab} /><input type="hidden" name="filter_q" value={searchTerm} />
								<label class="block"><span class="sr-only">Rejection reason</span><input name="note" class="w-full rounded-md border-zinc-300 px-3 py-2 text-xs" placeholder="Rejection reason" /></label>
								<button class="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-100">Reject candidate</button>
							</form>
						</div>
						{:else}
							<div>
								<h4 class="text-xs font-semibold text-zinc-500 uppercase">Pipeline status</h4>
								<p class="mt-2 text-sm font-medium text-zinc-900">{pipelineStateLabels[candidate.pipeline_state]}</p>
								<p class="mt-1 text-xs leading-5 text-zinc-500">This state is informational. Decisions are available only for manual review and region reconciliation.</p>
							</div>
						{/if}
					</aside>
				</div>
			</article>
		{/each}

		{#if data.candidates.length === 0}
			<div class="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center"><h2 class="text-sm font-semibold text-zinc-950">No candidates in this view</h2><p class="mt-1 text-sm text-zinc-500">Change the status filter or clear the search.</p></div>
		{/if}
	</section>
</main>
