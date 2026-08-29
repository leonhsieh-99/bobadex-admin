<script lang="ts">
	/* eslint-disable @typescript-eslint/no-explicit-any, svelte/prefer-svelte-reactivity, svelte/require-each-key */
	import { applyAction, enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ReviewTabs from '$lib/ReviewTabs.svelte';
	import type { SubmitFunction } from './$types';

	export let data: any;
	let searchTerm = data.q;
	const enhanceAction: SubmitFunction =
		() =>
		async ({ result }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true, keepFocus: true, noScroll: true });
				return;
			}
			await applyAction(result);
		};
	function tabCount(tab: any) {
		return tab.statuses.reduce(
			(sum: number, status: string) => sum + (data.statusCounts[status] ?? 0),
			0
		);
	}
	function reviewUrl(tab: string) {
		const params = new URLSearchParams({ tab });
		if (searchTerm.trim()) params.set('q', searchTerm.trim());
		return '/admin/reviews?' + params.toString();
	}
	function safeUrl(value: unknown) {
		if (typeof value !== 'string') return null;
		try {
			const url = new URL(value);
			return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
		} catch {
			return null;
		}
	}
	function confidence(value: number | null) {
		return value === null ? 'â' : Math.round(value * 100) + '%';
	}
	function evidenceText(value: unknown) {
		if (typeof value === 'string') return value;
		if (value && typeof value === 'object')
			return Object.entries(value as Record<string, unknown>)
				.map(([key, item]) => key.replaceAll('_', ' ') + ': ' + String(item))
				.join(' Â· ');
		return String(value ?? '');
	}
	function optionsFor(candidate: any) {
		const query = String(candidate.normalized_name ?? candidate.canonical_name ?? '').toLowerCase();
		const slugs = new Set(
			data.aliases
				.filter((alias: any) => {
					const value = String(alias.normalized_name ?? alias.alias_display ?? '').toLowerCase();
					return query.length >= 3 && (value.includes(query) || query.includes(value));
				})
				.map((alias: any) => alias.brand_slug)
		);
		return data.brands.filter((brand: any) => slugs.has(brand.slug)).slice(0, 5);
	}
</script>

<svelte:head><title>POI review queue | Bobadex Admin</title></svelte:head>

<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<header class="border-b border-zinc-200 pb-5">
		<p class="text-xs font-semibold text-teal-700 uppercase">Generic POI pipeline</p>
		<div class="flex flex-wrap items-end justify-between gap-4">
			<div>
				<h1 class="mt-1 text-2xl font-semibold text-zinc-950">POI review queue</h1>
				<p class="mt-2 max-w-3xl text-sm text-zinc-600">
					Canonical candidates stay separate from FSQ, Overture, and OSM observations.
				</p>
			</div>
			{#if data.reviewTab === 'ready'}
				<form method="POST" action="?/processReady" use:enhance={enhanceAction} class="flex gap-2">
					<input type="hidden" name="filter_tab" value="ready" />
					<input type="hidden" name="filter_q" value={searchTerm} />
					<input
						name="limit"
						type="number"
						min="1"
						max="25"
						value="1"
						class="w-16 rounded-md border-zinc-300 text-sm"
					/>
					<button class="rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
						>Process ready</button
					>
				</form>
			{/if}
		</div>
		<div class="mt-5"><ReviewTabs active="candidates" /></div>
	</header>

	<nav class="mt-5 flex flex-wrap gap-2" aria-label="POI states">
		{#each data.reviewTabs as tab}
			<a
				href={reviewUrl(tab.id)}
				class:!border-zinc-900={data.reviewTab === tab.id}
				class:!bg-zinc-900={data.reviewTab === tab.id}
				class:!text-white={data.reviewTab === tab.id}
				class="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
			>
				{tab.label} <span class="ml-1 opacity-70">{tabCount(tab)}</span>
			</a>
		{/each}
	</nav>

	<form method="GET" class="mt-4 flex gap-2">
		<input type="hidden" name="tab" value={data.reviewTab} />
		<input
			name="q"
			bind:value={searchTerm}
			placeholder="Filter POIs"
			class="min-w-0 flex-1 rounded-md border-zinc-300 text-sm"
		/>
		<button class="rounded-md border border-zinc-300 bg-white px-4 text-sm">Search</button>
	</form>

	<section class="mt-5 space-y-4">
		{#each data.candidates as candidate}
			{@const observations = data.observationsByCandidate[candidate.id] ?? []}
			{@const review = data.latestReviewByCandidate[candidate.id]}
			{@const suggestions = optionsFor(candidate)}
			{@const canAct = ['pending', 'needs_exception_resolution', 'needs_manual_review'].includes(
				candidate.process_status
			)}
			<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
				<header
					class="flex flex-wrap justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3"
				>
					<div>
						<h2 class="font-semibold text-zinc-950">{candidate.canonical_name ?? 'Unnamed POI'}</h2>
						<p class="mt-1 text-xs text-zinc-500">
							{candidate.address_input ?? 'Address unavailable'} Â· {candidate.region_key ??
								'No region'}
						</p>
					</div>
					<div class="text-right text-xs">
						<p class="font-medium text-zinc-800">{candidate.process_status.replaceAll('_', ' ')}</p>
						<p class="mt-1 text-zinc-500">
							{candidate.route_class?.replaceAll('_', ' ') ?? 'No route'}
						</p>
					</div>
				</header>

				<div
					class="grid divide-y divide-zinc-200 lg:grid-cols-[1fr_1fr_19rem] lg:divide-x lg:divide-y-0"
				>
					<section class="p-4">
						<h3 class="text-xs font-semibold text-zinc-500 uppercase">Provider observations</h3>
						<div class="mt-3 space-y-3">
							{#each observations as observation}
								<div class="rounded-md border border-zinc-200 p-3 text-xs">
									<div class="flex justify-between gap-2">
										<strong>{observation.provider.toUpperCase()}</strong>
										{#if safeUrl(observation.source_url)}<a
												href={safeUrl(observation.source_url) ?? '#'}
												target="_blank"
												rel="noreferrer"
												class="text-blue-700">Source</a
											>{/if}
									</div>
									<p class="mt-1">{observation.name ?? candidate.canonical_name}</p>
									<p class="mt-1 text-zinc-500">
										{observation.address_input ?? 'No provider address'}
									</p>
									<p class="mt-1 font-mono text-[11px] break-all text-zinc-500">
										{observation.provider_record_id}
									</p>
								</div>
							{/each}
							{#if observations.length === 0}<p class="text-xs text-zinc-500">
									No active observations.
								</p>{/if}
						</div>
					</section>

					<section class="p-4">
						<h3 class="text-xs font-semibold text-zinc-500 uppercase">Resolution evidence</h3>
						<dl class="mt-3 grid grid-cols-[7rem_1fr] gap-2 text-xs">
							<dt class="text-zinc-500">Reason</dt>
							<dd>{candidate.process_reason ?? 'None'}</dd>
							<dt class="text-zinc-500">Identity</dt>
							<dd>{confidence(candidate.identity_confidence)}</dd>
							<dt class="text-zinc-500">Eligibility</dt>
							<dd>{confidence(candidate.eligibility_confidence)}</dd>
							<dt class="text-zinc-500">Freshness</dt>
							<dd>{confidence(candidate.freshness_confidence)}</dd>
							<dt class="text-zinc-500">Matched brand</dt>
							<dd class="font-mono">{candidate.matched_brand_slug ?? 'None'}</dd>
						</dl>
						{#if review}
							<div class="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs">
								<p class="font-semibold text-blue-900">
									{review.review_kind} Â· {review.decision ?? review.status}
								</p>
								<p class="mt-1 text-blue-700">
									{review.model ?? 'deterministic'} Â· {confidence(review.confidence)}
								</p>
								{#each review.evidence ?? [] as item}<p class="mt-2">{evidenceText(item)}</p>{/each}
							</div>
						{/if}
						{#if candidate.risk_flags && Object.keys(candidate.risk_flags).length}
							<details class="mt-3 text-xs">
								<summary class="cursor-pointer text-amber-700">Risk flags</summary>
								<pre class="mt-2 overflow-auto text-[11px] whitespace-pre-wrap">{JSON.stringify(
										candidate.risk_flags,
										null,
										2
									)}</pre>
							</details>
						{/if}
					</section>

					<aside class="space-y-4 bg-zinc-50 p-4">
						{#if canAct}
							<form method="POST" action="?/approve" use:enhance={enhanceAction} class="space-y-2">
								<input type="hidden" name="candidate_id" value={candidate.id} />
								<input type="hidden" name="filter_tab" value={data.reviewTab} />
								<input type="hidden" name="filter_q" value={searchTerm} />
								<input
									name="force_display"
									value={candidate.canonical_name ?? ''}
									placeholder="Brand display"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<input
									name="note"
									placeholder="Approval note"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<button
									class="w-full rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white"
									>Create new brand</button
								>
							</form>

							<form
								method="POST"
								action="?/merge"
								use:enhance={enhanceAction}
								class="space-y-2 border-t border-zinc-200 pt-4"
							>
								<input type="hidden" name="candidate_id" value={candidate.id} />
								<input type="hidden" name="filter_tab" value={data.reviewTab} />
								<input type="hidden" name="filter_q" value={searchTerm} />
								<span class="text-[11px] text-zinc-600">Attach existing brand</span>
								<input
									name="brand_slug"
									list={'brands-' + candidate.id}
									value={review?.proposed_brand_slug ?? candidate.matched_brand_slug ?? ''}
									required
									placeholder="Brand slug"
									class="w-full rounded-md border-zinc-300 font-mono text-xs"
								/>
								<datalist id={'brands-' + candidate.id}
									>{#each suggestions as brand}<option value={brand.slug}>{brand.display}</option
										>{/each}</datalist
								>
								<input
									name="note"
									placeholder="Attachment note"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<button
									class="w-full rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white"
									>Attach existing</button
								>
							</form>

							<form
								method="POST"
								action="?/reject"
								use:enhance={enhanceAction}
								class="space-y-2 border-t border-zinc-200 pt-4"
							>
								<input type="hidden" name="candidate_id" value={candidate.id} />
								<input type="hidden" name="filter_tab" value={data.reviewTab} />
								<input type="hidden" name="filter_q" value={searchTerm} />
								<input
									name="note"
									required
									placeholder="Rejection reason"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<button
									class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
									>Reject candidate</button
								>
							</form>
						{:else}
							<p class="text-xs leading-5 text-zinc-500">This state is informational.</p>
						{/if}
					</aside>
				</div>
			</article>
		{/each}
		{#if data.candidates.length === 0}
			<div
				class="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center text-sm text-zinc-500"
			>
				No POIs in this view.
			</div>
		{/if}
	</section>
</main>
