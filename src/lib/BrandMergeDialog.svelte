<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { BrandMergePreview } from '$lib/server/brand-merge.server';

	type BrandOption = {
		slug: string;
		display: string;
		website: string | null;
		wikidata: string | null;
		matched_alias: string | null;
	};

	export let source: { slug: string; display: string };
	export let action = '?/mergeBrand';
	export let enhanceSubmit: SubmitFunction<any, any>;
	export let busy = false;
	export let error = '';
	export let onClose: () => void;

	let sourceKey = '';
	let query = '';
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let results: BrandOption[] = [];
	let selected: BrandOption | null = null;
	let preview: BrandMergePreview | null = null;
	let searchLoading = false;
	let previewLoading = false;
	let localError = '';
	let reason = '';
	let markTargetForReview = true;

	$: if (source.slug !== sourceKey) {
		sourceKey = source.slug;
		query = '';
		results = [];
		selected = null;
		preview = null;
		localError = '';
		reason = '';
		markTargetForReview = true;
	}

	function scheduleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		selected = null;
		preview = null;
		localError = '';
		if (query.trim().length < 2) {
			results = [];
			return;
		}
		searchTimer = setTimeout(searchTargets, 220);
	}

	async function searchTargets() {
		searchLoading = true;
		try {
			const response = await fetch(
				`/admin/_api/brand-search?q=${encodeURIComponent(query.trim())}`
			);
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? 'Could not search brands.');
			results = (payload as BrandOption[]).filter((brand) => brand.slug !== source.slug);
		} catch (searchError) {
			localError = searchError instanceof Error ? searchError.message : 'Could not search brands.';
			results = [];
		} finally {
			searchLoading = false;
		}
	}

	async function chooseTarget(target: BrandOption) {
		selected = target;
		query = target.display;
		results = [];
		preview = null;
		localError = '';
		previewLoading = true;
		try {
			const params = new URLSearchParams({ source: source.slug, target: target.slug });
			const response = await fetch(`/admin/_api/brand-merge-preview?${params}`);
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error ?? 'Could not preview this merge.');
			preview = payload as BrandMergePreview;
		} catch (previewError) {
			localError =
				previewError instanceof Error ? previewError.message : 'Could not preview this merge.';
		} finally {
			previewLoading = false;
		}
	}

	function count(value: number | undefined) {
		return new Intl.NumberFormat('en-US').format(value ?? 0);
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && !busy && onClose()} />

<div
	class="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-3 sm:p-5"
	role="presentation"
	onclick={(event) => event.currentTarget === event.target && !busy && onClose()}
>
	<div
		class="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-labelledby="brand-merge-title"
	>
		<header class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
			<div>
				<p class="text-xs font-semibold text-red-700 uppercase">Rare repair action</p>
				<h2 id="brand-merge-title" class="mt-1 text-lg font-semibold text-zinc-950">
					Merge into another brand
				</h2>
				<p class="mt-1 text-sm text-zinc-600">
					The source becomes a permanent redirect. The target identity and published profile
					survive.
				</p>
			</div>
			<button
				type="button"
				onclick={onClose}
				disabled={busy}
				aria-label="Close brand merge"
				class="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
			>
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="m6 6 12 12M18 6 6 18"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</header>

		<form method="post" {action} use:enhance={enhanceSubmit} class="flex min-h-0 flex-1 flex-col">
			<input type="hidden" name="source_slug" value={source.slug} />
			<input type="hidden" name="target_slug" value={selected?.slug ?? ''} />
			<input
				type="hidden"
				name="mark_target_for_review"
				value={markTargetForReview ? 'true' : 'false'}
			/>

			<div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
				<section class="grid gap-4 sm:grid-cols-2">
					<div class="border-l-2 border-red-400 pl-3">
						<p class="text-xs font-semibold text-zinc-500 uppercase">Source being absorbed</p>
						<p class="mt-1 font-semibold text-zinc-950">{source.display}</p>
						<code class="text-xs break-all text-zinc-500">{source.slug}</code>
					</div>
					<div class="border-l-2 border-emerald-500 pl-3">
						<p class="text-xs font-semibold text-zinc-500 uppercase">Target that survives</p>
						{#if selected}
							<p class="mt-1 font-semibold text-zinc-950">{selected.display}</p>
							<code class="text-xs break-all text-zinc-500">{selected.slug}</code>
						{:else}
							<p class="mt-1 text-sm text-zinc-500">Select an active canonical brand.</p>
						{/if}
					</div>
				</section>

				<section class="border-t border-zinc-200 pt-5">
					<label class="block">
						<span class="text-sm font-semibold text-zinc-900">Find the surviving brand</span>
						<span class="mt-1 block text-xs text-zinc-500">
							Search by canonical name, slug, or alias.
						</span>
						<div class="relative mt-2">
							<svg
								class="pointer-events-none absolute top-3 left-3 h-4 w-4 text-zinc-400"
								viewBox="0 0 24 24"
								fill="none"
								aria-hidden="true"
							>
								<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
								<path
									d="m20 20-4-4"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
							<input
								bind:value={query}
								oninput={scheduleSearch}
								autocomplete="off"
								placeholder="Search brands"
								class="h-10 w-full rounded border-zinc-300 pr-3 pl-9 text-sm"
							/>
							{#if searchLoading}
								<span class="absolute top-3 right-3 text-xs text-zinc-500">Searching…</span>
							{/if}
						</div>
					</label>
					{#if results.length}
						<div
							class="mt-2 max-h-52 divide-y divide-zinc-100 overflow-y-auto border border-zinc-200 bg-white"
						>
							{#each results as brand}
								<button
									type="button"
									onclick={() => chooseTarget(brand)}
									class="flex w-full items-start justify-between gap-4 px-3 py-3 text-left hover:bg-zinc-50"
								>
									<span class="min-w-0">
										<span class="block truncate text-sm font-semibold text-zinc-950"
											>{brand.display}</span
										>
										<code class="block truncate text-xs text-zinc-500">{brand.slug}</code>
									</span>
									{#if brand.matched_alias}
										<span class="shrink-0 text-xs text-zinc-500">via {brand.matched_alias}</span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</section>

				{#if previewLoading}
					<p class="border-t border-zinc-200 pt-5 text-sm text-zinc-500">Checking merge impact…</p>
				{:else if preview}
					<section class="border-t border-zinc-200 pt-5">
						<h3 class="text-sm font-semibold text-zinc-950">Target canonical fields</h3>
						<div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
							<p><span class="text-emerald-700">✓</span> Name: {preview.target.display}</p>
							<p>
								<span class="text-emerald-700">✓</span> Slug: <code>{preview.target.slug}</code>
							</p>
							<p>
								<span class="text-emerald-700">✓</span> Website:
								{preview.target.website ?? 'Not set'}
							</p>
							<p>
								<span class="text-emerald-700">✓</span> Wikidata:
								{preview.target.wikidata ?? 'Not set'}
							</p>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-5">
						<h3 class="text-sm font-semibold text-zinc-950">Will transfer or preserve</h3>
						<div class="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
							<div>
								<strong class="block text-lg text-zinc-950"
									>{count(preview.counts.reference_locations)}</strong
								><span class="text-xs text-zinc-500">OSM locations</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950">{count(preview.counts.shops)}</strong
								><span class="text-xs text-zinc-500">user shops</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950"
									>{count(preview.counts.aliases + 1)}</strong
								><span class="text-xs text-zinc-500">aliases, incl. source name</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950">{count(preview.counts.sources)}</strong
								><span class="text-xs text-zinc-500">source records</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950"
									>{count(preview.counts.feed_events)}</strong
								><span class="text-xs text-zinc-500">feed events</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950"
									>{count(preview.counts.osm_candidates)}</strong
								><span class="text-xs text-zinc-500">OSM matches</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950"
									>{count(preview.counts.research_runs)}</strong
								><span class="text-xs text-zinc-500">research runs retained</span>
							</div>
							<div>
								<strong class="block text-lg text-zinc-950">{count(preview.counts.dossiers)}</strong
								><span class="text-xs text-zinc-500">historical dossiers</span>
							</div>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-5">
						<label class="block">
							<span class="text-sm font-semibold text-zinc-900">Reason</span>
							<textarea
								name="reason"
								bind:value={reason}
								rows="3"
								required
								placeholder="Same continuing business after rebrand"
								class="mt-2 block w-full rounded border-zinc-300 text-sm"
							></textarea>
						</label>
						<label class="mt-3 flex items-start gap-2 text-sm text-zinc-700">
							<input
								type="checkbox"
								bind:checked={markTargetForReview}
								class="mt-0.5 rounded border-zinc-300 text-zinc-950"
							/>
							<span>
								Return the target dossier for a quick post-merge review. Its published profile
								remains live.
							</span>
						</label>
					</section>
				{/if}

				{#if localError || error}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{localError || error}
					</div>
				{/if}
			</div>

			<footer
				class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4"
			>
				<p class="text-xs text-zinc-500">
					All changes roll back if any transfer or conflict check fails.
				</p>
				<div class="flex shrink-0 gap-2">
					<button
						type="button"
						onclick={onClose}
						disabled={busy}
						class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						disabled={!preview || !reason.trim() || busy}
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{busy ? 'Merging…' : 'Confirm merge'}
					</button>
				</div>
			</footer>
		</form>
	</div>
</div>
