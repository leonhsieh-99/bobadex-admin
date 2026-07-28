<!-- src/routes/admin/brands/+page.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { page as pageStore } from '$app/stores';
	import { toasts } from '$lib/toast';
	import { writable, get } from 'svelte/store';
	import { createClient } from '@supabase/supabase-js';
	import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
	import ReviewTabs from '$lib/ReviewTabs.svelte';

	type PendingBrand = {
		id: string;
		suggested_name: string;
		normalized_name: string | null;
		location: string | null;
		source: string | null;
		status: string | null;
		created_at: string;
		duplicates: number | null;
		slug: string | null;
	};

	type PendingDelete = {
		id: string;
		suggested_name: string;
		created_at: string;
		slug: string | null;
		duplicates?: number | null;
	};

	type IconlessBrand = {
		slug: string;
		display: string;
		icon_path: string | null;
		created_at: string;
	};

	type CandidateEvidence = {
		id: string;
		name: string | null;
		normalized_name: string | null;
		lat: number | null;
		lon: number | null;
		tags: Record<string, string> | null;
		raw_tags: Record<string, string> | null;
		match_score: number | null;
		matched_brand_slug: string | null;
		blocked_brand: boolean;
		blocked_reason: string | null;
		staging_id: string | null;
		process_status: string;
		region_key: string | null;
		match_bucket: string | null;
		created_at: string;
	};

	type ReviewGroup = {
		key: string;
		label: string;
		rows: PendingBrand[];
		candidates: CandidateEvidence[];
		locations: string[];
		websites: Array<{ label: string; href: string }>;
		wikidataIds: string[];
		usefulTags: Array<{ key: string; value: string }>;
		suggestedAction: 'verify' | 'merge' | 'review' | 'blocked';
		confidence: string;
	};

	export let data: {
		pending: PendingBrand[];
		pendingDelete: PendingDelete[];
		iconless: IconlessBrand[];
		candidates: CandidateEvidence[];
	};

	const submitting = writable(new Set<string>());
	function markSubmitting(id: string, on: boolean) {
		submitting.update((s) => {
			const next = new Set(s);
			on ? next.add(id) : next.delete(id);
			return next;
		});
	}

	const batchRunning = writable(false);
	const progress = writable<Record<string, 'idle' | 'ok' | 'err' | 'run'>>({});
	const doneCount = writable(0);

	const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: { persistSession: true }
	});

	function groupKey(row: PendingBrand) {
		return row.normalized_name || row.suggested_name.trim().toLowerCase();
	}

	function tagsFor(candidate: CandidateEvidence) {
		return candidate.tags ?? candidate.raw_tags ?? {};
	}

	function unique<T>(items: T[]) {
		return Array.from(new Set(items.filter(Boolean)));
	}

	function formatDate(value: string) {
		return new Date(value).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function locationFromCandidate(candidate: CandidateEvidence) {
		const tags = tagsFor(candidate);
		const street = tags['addr:street'];
		const number = tags['addr:housenumber'];
		const city = tags['addr:city'] || tags.city || tags.town || tags.village;
		const state = tags['addr:state'];

		if (street || number) {
			return `${number ? `${number} ` : ''}${street ?? ''}${city ? `, ${city}` : ''}${state ? `, ${state}` : ''}`;
		}
		if (city || state) return [city, state].filter(Boolean).join(', ');
		if (typeof candidate.lat === 'number' && typeof candidate.lon === 'number') {
			return `${candidate.lat.toFixed(5)}, ${candidate.lon.toFixed(5)}`;
		}
		return '';
	}

	function mapLink(candidate: CandidateEvidence) {
		if (typeof candidate.lat !== 'number' || typeof candidate.lon !== 'number') return null;
		return `https://www.openstreetmap.org/?mlat=${candidate.lat}&mlon=${candidate.lon}#map=18/${candidate.lat}/${candidate.lon}`;
	}

	function websiteLinks(candidates: CandidateEvidence[]) {
		return unique(
			candidates.flatMap((candidate) => {
				const tags = tagsFor(candidate);
				return [tags.website, tags['contact:website'], tags.url].filter(Boolean);
			})
		).map((url) => {
			const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
			return { href, label: url.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
		});
	}

	function wikidataIds(candidates: CandidateEvidence[]) {
		return unique(
			candidates.flatMap((candidate) => {
				const tags = tagsFor(candidate);
				return [
					tags.wikidata,
					tags.brand?.startsWith('Q') ? tags.brand : '',
					tags['brand:wikidata']
				];
			})
		);
	}

	function usefulTags(candidates: CandidateEvidence[]) {
		const keys = ['amenity', 'shop', 'cuisine', 'brand', 'operator', 'opening_hours', 'phone'];
		const pairs = candidates.flatMap((candidate) => {
			const tags = tagsFor(candidate);
			return keys.filter((key) => tags[key]).map((key) => ({ key, value: tags[key] }));
		});

		return Array.from(
			new Map(pairs.map((pair) => [`${pair.key}:${pair.value}`, pair])).values()
		).slice(0, 8);
	}

	function suggestedAction(
		rows: PendingBrand[],
		candidates: CandidateEvidence[]
	): ReviewGroup['suggestedAction'] {
		if (candidates.some((candidate) => candidate.blocked_brand)) return 'blocked';
		if (candidates.some((candidate) => candidate.matched_brand_slug)) return 'merge';
		const hasWebsite = websiteLinks(candidates).length > 0;
		const hasWikidata = wikidataIds(candidates).length > 0;
		const duplicateCount = rows.reduce((sum, row) => sum + (row.duplicates ?? 1), 0);
		if (hasWebsite || hasWikidata || duplicateCount > 1 || candidates.length > 1) return 'verify';
		return 'review';
	}

	function confidenceFor(action: ReviewGroup['suggestedAction'], candidates: CandidateEvidence[]) {
		if (action === 'blocked') return 'Blocked evidence';
		if (action === 'merge') return 'Existing brand match';
		if (websiteLinks(candidates).length || wikidataIds(candidates).length)
			return 'Strong identity signal';
		if (candidates.length > 1) return 'Multiple locations';
		return 'Needs human check';
	}

	function buildGroups(rows: PendingBrand[], candidates: CandidateEvidence[]) {
		const byGroup = new Map<string, PendingBrand[]>();
		for (const row of rows) {
			const key = groupKey(row);
			byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
		}

		return Array.from(byGroup.entries())
			.map(([key, groupRows]) => {
				const candidateMatches = candidates.filter((candidate) => {
					return (
						groupRows.some((row) => row.id === candidate.staging_id) ||
						(candidate.normalized_name && candidate.normalized_name === key)
					);
				});
				const locations = unique([
					...groupRows.map((row) => row.location ?? ''),
					...candidateMatches.map(locationFromCandidate)
				]).slice(0, 8);
				const action = suggestedAction(groupRows, candidateMatches);

				return {
					key,
					label: groupRows[0]?.suggested_name ?? key,
					rows: groupRows,
					candidates: candidateMatches,
					locations,
					websites: websiteLinks(candidateMatches),
					wikidataIds: wikidataIds(candidateMatches),
					usefulTags: usefulTags(candidateMatches),
					suggestedAction: action,
					confidence: confidenceFor(action, candidateMatches)
				};
			})
			.sort((a, b) => {
				const bWeight =
					b.rows.reduce((sum, row) => sum + (row.duplicates ?? 1), 0) + b.candidates.length;
				const aWeight =
					a.rows.reduce((sum, row) => sum + (row.duplicates ?? 1), 0) + a.candidates.length;
				return bWeight - aWeight;
			});
	}

	function actionLabel(action: ReviewGroup['suggestedAction']) {
		return {
			verify: 'Verify as new brand',
			merge: 'Review merge target',
			review: 'Needs review',
			blocked: 'Do not approve yet'
		}[action];
	}

	async function generateOne(slug: string, prompt: string) {
		progress.update((p) => ({ ...p, [slug]: 'run' }));
		const { data: res, error } = await supabase.functions.invoke('generate-icon', {
			body: { slug, prompt }
		});
		if (error || !(res as any)?.path) {
			progress.update((p) => ({ ...p, [slug]: 'err' }));
			return false;
		}
		const originalPath = (res as any).path as string;
		const bucket = 'shop-media';
		await supabase.functions.invoke('generate-thumb', {
			body: { bucket, path: originalPath, sizes: [256, 512], overwrite: true }
		});
		progress.update((p) => ({ ...p, [slug]: 'ok' }));
		doneCount.update((n) => n + 1);
		return true;
	}

	async function runBatch(limit = 50) {
		if (get(batchRunning)) return;
		batchRunning.set(true);
		doneCount.set(0);
		const items = data.iconless.slice(0, limit);
		progress.set(Object.fromEntries(items.map((b) => [b.slug, 'idle'] as const)));
		for (const b of items) {
			if (!get(batchRunning)) break;
			await generateOne(b.slug, b.display);
		}
		batchRunning.set(false);
		toasts.success('Batch icon generation finished');
	}

	$: groups = buildGroups(data.pending, data.candidates);
	$: pendingCount = data.pending.reduce((sum, row) => sum + (row.duplicates ?? 1), 0);

	$: if (browser) {
		const $page = $pageStore;
		const toast = $page.url.searchParams.get('toast');
		const msg = $page.url.searchParams.get('msg');
		const slug = $page.url.searchParams.get('slug');
		const display = $page.url.searchParams.get('display');

		if (toast) {
			if (toast === 'verified') {
				toasts.success('Brand verified');
				if (slug && display) {
					generateOne(slug, display);
				}
			} else if (toast === 'rejected') {
				toasts.success('Brand rejected');
			} else if (toast === 'verify_failed') {
				toasts.error(msg ?? 'Verify failed');
			} else if (toast === 'reject_failed') {
				toasts.error(msg ?? 'Reject failed');
			}
			history.replaceState(null, '', '/admin/brands');
		}
	}
</script>

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<header
		class="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between"
	>
		<div>
			<p class="text-xs font-semibold tracking-wide text-teal-700 uppercase">Brand review</p>
			<h1 class="mt-1 text-2xl font-semibold text-gray-950">Normalized brand triage</h1>
			<p class="mt-2 max-w-3xl text-sm text-gray-600">
				Review pending submissions by normalized name with OSM evidence, identity signals, and the
				safest next action.
			</p>
			<a
				href="/admin/brands/catalog"
				class="mt-3 inline-flex items-center text-sm font-semibold text-gray-700 hover:text-gray-950"
			>
				Open canonical brand catalog
				<span class="ml-1" aria-hidden="true">→</span>
			</a>
		</div>

		<div class="grid grid-cols-3 gap-2 text-sm">
			<div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
				<div class="text-xs text-gray-500">Groups</div>
				<div class="text-xl font-semibold text-gray-950">{groups.length}</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
				<div class="text-xs text-gray-500">Requests</div>
				<div class="text-xl font-semibold text-gray-950">{pendingCount}</div>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
				<div class="text-xs text-gray-500">Evidence</div>
				<div class="text-xl font-semibold text-gray-950">{data.candidates.length}</div>
			</div>
		</div>
	</header>
	<div class="mt-5"><ReviewTabs active="submissions" /></div>

	<section class="mt-6 space-y-4">
		{#if groups.length === 0}
			<div class="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
				<h2 class="text-base font-semibold text-gray-950">No brand submissions awaiting review</h2>
				<p class="mt-1 text-sm text-gray-500">
					New OSM or user submissions will appear here grouped by normalized name.
				</p>
			</div>
		{:else}
			{#each groups as group}
				<article class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
					<div class="border-b border-gray-100 bg-gray-50/80 px-4 py-4 sm:px-5">
						<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="truncate text-lg font-semibold text-gray-950">{group.label}</h2>
									<span
										class="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200"
									>
										normalized: {group.key}
									</span>
									{#if group.rows.length > 1}
										<span
											class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200"
										>
											{group.rows.length} staging rows
										</span>
									{/if}
								</div>
								<div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
									<span>{group.candidates.length} OSM candidates</span>
									<span>{group.locations.length} locations</span>
									<span>{group.websites.length} websites</span>
									<span>{group.wikidataIds.length} Wikidata IDs</span>
								</div>
							</div>

							<div class="flex flex-wrap items-center gap-2">
								<span
									class={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
										group.suggestedAction === 'verify'
											? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
											: group.suggestedAction === 'merge'
												? 'bg-amber-50 text-amber-800 ring-amber-200'
												: group.suggestedAction === 'blocked'
													? 'bg-rose-50 text-rose-700 ring-rose-200'
													: 'bg-slate-50 text-slate-700 ring-slate-200'
									}`}
								>
									{actionLabel(group.suggestedAction)}
								</span>
								<span
									class="rounded-full bg-white px-3 py-1 text-xs text-gray-600 ring-1 ring-gray-200"
								>
									{group.confidence}
								</span>
							</div>
						</div>
					</div>

					<div class="grid gap-0 lg:grid-cols-[1.1fr_1fr_26rem]">
						<section class="border-b border-gray-100 p-4 sm:p-5 lg:border-r lg:border-b-0">
							<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Locations</h3>
							<div class="mt-3 space-y-2">
								{#each group.locations.slice(0, 5) as location}
									<div class="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
										{location}
									</div>
								{/each}
								{#if group.locations.length === 0}
									<p class="text-sm text-gray-500">No location evidence found.</p>
								{/if}
							</div>

							<h3 class="mt-5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Staging rows
							</h3>
							<div class="mt-3 space-y-2">
								{#each group.rows as row}
									<div class="rounded-md border border-gray-200 px-3 py-2">
										<div class="flex items-center justify-between gap-2 text-sm">
											<span class="font-medium text-gray-900">{row.suggested_name}</span>
											<span class="shrink-0 text-xs text-gray-500"
												>{formatDate(row.created_at)}</span
											>
										</div>
										<div class="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
											<span>{row.source ?? 'unknown source'}</span>
											<span>dupes {row.duplicates ?? 1}</span>
											<code class="max-w-full truncate">{row.id}</code>
										</div>
									</div>
								{/each}
							</div>
						</section>

						<section class="border-b border-gray-100 p-4 sm:p-5 lg:border-r lg:border-b-0">
							<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Tags and identity
							</h3>

							<div class="mt-3 flex flex-wrap gap-2">
								{#each group.usefulTags as tag}
									<span
										class="rounded-md bg-slate-50 px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
									>
										<span class="font-medium">{tag.key}</span>: {tag.value}
									</span>
								{/each}
								{#if group.usefulTags.length === 0}
									<p class="text-sm text-gray-500">No high-signal tags found.</p>
								{/if}
							</div>

							<div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
								<div>
									<h4 class="text-xs font-semibold text-gray-500">Websites</h4>
									<div class="mt-2 space-y-1.5">
										{#each group.websites.slice(0, 4) as site}
											<a
												class="block truncate text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
												href={site.href}
												target="_blank"
												rel="noreferrer"
											>
												{site.label}
											</a>
										{/each}
										{#if group.websites.length === 0}
											<p class="text-sm text-gray-500">No website.</p>
										{/if}
									</div>
								</div>

								<div>
									<h4 class="text-xs font-semibold text-gray-500">Brand / Wikidata</h4>
									<div class="mt-2 flex flex-wrap gap-2">
										{#each group.wikidataIds as id}
											<a
												class="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
												href={`https://www.wikidata.org/wiki/${id}`}
												target="_blank"
												rel="noreferrer"
											>
												{id}
											</a>
										{/each}
										{#if group.wikidataIds.length === 0}
											<p class="text-sm text-gray-500">No Wikidata ID.</p>
										{/if}
									</div>
								</div>
							</div>

							{#if group.candidates.length}
								<h4 class="mt-5 text-xs font-semibold text-gray-500">Candidate checks</h4>
								<div class="mt-2 space-y-2">
									{#each group.candidates.slice(0, 4) as candidate}
										<div class="rounded-md border border-gray-200 px-3 py-2 text-xs">
											<div class="flex items-center justify-between gap-3">
												<span class="truncate font-medium text-gray-900"
													>{candidate.name ?? group.label}</span
												>
												<span class="shrink-0 text-gray-500">{candidate.process_status}</span>
											</div>
											<div class="mt-1 flex flex-wrap gap-2 text-gray-500">
												{#if candidate.matched_brand_slug}
													<span>match {candidate.matched_brand_slug}</span>
												{/if}
												{#if candidate.match_score !== null}
													<span>score {candidate.match_score.toFixed(2)}</span>
												{/if}
												{#if candidate.region_key}
													<span>{candidate.region_key}</span>
												{/if}
												{#if mapLink(candidate)}
													<a
														class="font-medium text-blue-700 hover:underline"
														href={mapLink(candidate)}
														target="_blank"
														rel="noreferrer">map</a
													>
												{/if}
											</div>
											{#if candidate.blocked_brand}
												<p class="mt-1 text-rose-700">
													{candidate.blocked_reason ?? 'Marked as blocked.'}
												</p>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</section>

						<section class="p-4 sm:p-5">
							<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Suggested action
							</h3>
							<p class="mt-2 text-sm text-gray-700">{group.confidence}</p>

							<form
								method="post"
								class="mt-4 space-y-3"
								on:submit={(e) => {
									const form = e.currentTarget as HTMLFormElement;
									const id = (form.querySelector('input[name="id"]') as HTMLInputElement)?.value;
									if (id) markSubmitting(id, true);
								}}
							>
								<input type="hidden" name="id" value={group.rows[0].id} />

								<label class="block">
									<span class="text-xs font-medium text-gray-600">Display override</span>
									<input
										name="force_display"
										class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
										placeholder={group.label}
									/>
								</label>

								<div class="grid grid-cols-2 gap-2">
									<button
										formaction="?/verify"
										class="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
										disabled={$submitting.has(group.rows[0].id) ||
											group.suggestedAction === 'blocked'}
										aria-busy={$submitting.has(group.rows[0].id)}
									>
										{$submitting.has(group.rows[0].id) ? 'Working...' : 'Verify'}
									</button>
									<button
										type="button"
										class="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
										on:click={() => {
											window.location.href = `/admin/imports?q=${encodeURIComponent(group.label)}&status=pending`;
										}}
									>
										Inspect OSM
									</button>
								</div>

								<label class="block">
									<span class="text-xs font-medium text-gray-600">Rejection reason</span>
									<input
										name="reason"
										class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:ring-gray-900"
										placeholder="optional"
									/>
								</label>

								<button
									formaction="?/reject"
									class="w-full rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
									disabled={$submitting.has(group.rows[0].id)}
									aria-busy={$submitting.has(group.rows[0].id)}
								>
									Reject group lead
								</button>
							</form>

							{#if group.rows.length > 1}
								<p class="mt-3 text-xs leading-5 text-gray-500">
									This action applies to the lead staging row. Remaining rows stay visible until
									handled by the approval RPC or reviewed separately.
								</p>
							{/if}
						</section>
					</div>
				</article>
			{/each}
		{/if}
	</section>

	<section class="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
		<div class="rounded-lg border border-gray-200 bg-white p-5">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-base font-semibold text-gray-950">Pending delete requests</h2>
				<span
					class="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
				>
					{data.pendingDelete.length}
				</span>
			</div>

			{#if data.pendingDelete.length === 0}
				<p class="py-8 text-center text-sm text-gray-500">No delete requests.</p>
			{:else}
				<ul class="divide-y divide-gray-100">
					{#each data.pendingDelete as brand}
						<li class="py-4">
							<div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
								<div class="min-w-0">
									<div class="text-sm font-semibold text-gray-950">{brand.suggested_name}</div>
									<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
										<code>{brand.id}</code>
										{#if brand.slug}
											<span class="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700"
												>slug: {brand.slug}</span
											>
										{:else}
											<span class="rounded bg-yellow-50 px-1.5 py-0.5 text-yellow-800"
												>no slug attached</span
											>
										{/if}
										<span>{formatDate(brand.created_at)}</span>
									</div>
								</div>

								<form
									method="post"
									class="grid gap-2 sm:grid-cols-[auto_1fr_auto]"
									on:submit={(e) => {
										const form = e.currentTarget as HTMLFormElement;
										const id = (form.querySelector('input[name="id"]') as HTMLInputElement)?.value;
										if (id) markSubmitting(id, true);
									}}
								>
									<input type="hidden" name="id" value={brand.id} />
									<input type="hidden" name="slug" value={brand.slug ?? ''} />
									<button
										formaction="?/approveDelete"
										class="rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
										disabled={$submitting.has(brand.id) || !brand.slug}
										aria-busy={$submitting.has(brand.id)}
									>
										Approve delete
									</button>
									<input
										name="reason"
										class="min-w-0 rounded-md border-gray-300 px-3 py-2 text-xs focus:border-gray-900 focus:ring-gray-900"
										placeholder="why keeping?"
									/>
									<button
										formaction="?/rejectDelete"
										class="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
										disabled={$submitting.has(brand.id)}
										aria-busy={$submitting.has(brand.id)}
									>
										Keep
									</button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="rounded-lg border border-gray-200 bg-white p-5">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-base font-semibold text-gray-950">Brands needing icons</h2>
				{#if data.iconless.length}
					<div class="flex items-center gap-3">
						<span class="text-xs text-gray-600">{$doneCount}/{data.iconless.length} completed</span>
						<button
							class="rounded-md bg-gray-950 px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50"
							on:click={() => runBatch(50)}
							disabled={$batchRunning}
						>
							{$batchRunning ? 'Generating...' : 'Generate batch'}
						</button>
					</div>
				{/if}
			</div>

			{#if data.iconless.length === 0}
				<p class="py-8 text-center text-sm text-gray-500">All set. Every brand has an icon.</p>
			{:else}
				<ul class="max-h-[30rem] divide-y divide-gray-100 overflow-y-auto">
					{#each data.iconless as brand}
						<li class="flex items-center justify-between gap-3 py-3">
							<div class="min-w-0">
								<div class="truncate text-sm font-medium text-gray-950">{brand.display}</div>
								<div class="text-xs text-gray-500">slug: <code>{brand.slug}</code></div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if $progress[brand.slug] === 'ok'}
									<span class="text-xs text-emerald-700">Done</span>
								{:else if $progress[brand.slug] === 'err'}
									<span class="text-xs text-red-600">Failed</span>
								{:else if $progress[brand.slug] === 'run'}
									<span class="text-xs text-gray-600">Working...</span>
								{/if}
								<button
									class="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
									on:click={() => generateOne(brand.slug, brand.display)}
									disabled={$batchRunning || $progress[brand.slug] === 'run'}
								>
									Generate
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</main>
