<script lang="ts">
	/* eslint-disable @typescript-eslint/no-explicit-any, svelte/prefer-svelte-reactivity, svelte/require-each-key */
	import { applyAction, enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import ReviewTabs from '$lib/ReviewTabs.svelte';
	import { formatPostalAddress, foursquarePlaceUrl, googleMapsCoordinatesUrl } from '$lib/maps';
	import { reviewActionFlags } from '$lib/poi-review-actions';
	import {
		STOREFRONT_RESOLUTIONS,
		storefrontLifecycleLabel,
		storefrontReasonLabel,
		storefrontRelationshipLabel
	} from '$lib/poi-storefront-dossiers';
	import type { SubmitFunction } from './$types';

	export let data: any;
	let searchTerm = data.q;
	let expandedHistoryId: string | null = null;
	const enhanceAction: SubmitFunction =
		() =>
		async ({ result }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { keepFocus: true, noScroll: true });
				await invalidate('app:reviews');
				return;
			}
			await applyAction(result);
		};
	function tabCount(tab: any) {
		if (tab.id === 'history') return data.historyCount ?? 0;
		if (tab.id === 'manual') return data.dossierCount ?? 0;
		return tab.statuses.reduce(
			(sum: number, status: string) => sum + (data.statusCounts[status] ?? 0),
			0
		);
	}
	function reviewUrl(tab: string, page = 1) {
		const params = new URLSearchParams({ tab });
		if (searchTerm.trim()) params.set('q', searchTerm.trim());
		if (tab === 'manual' && page > 1) params.set('page', String(page));
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
	function observationSourceHref(observation: any) {
		if (observation.provider === 'fsq') return foursquarePlaceUrl(observation.provider_record_id);
		return safeUrl(observation.source_url);
	}
	function observationAddress(observation: any) {
		return formatPostalAddress({
			street: observation.address_input,
			locality: observation.locality,
			admin1: observation.admin1,
			postalCode: observation.postal_code
		});
	}
	function candidateAddress(candidate: any, observations: any[]) {
		const place = observations.find(
			(observation: any) => observation.locality || observation.admin1 || observation.postal_code
		);
		return formatPostalAddress({
			street: candidate.address_input ?? place?.address_input,
			locality: place?.locality,
			admin1: place?.admin1,
			postalCode: place?.postal_code
		});
	}
	function formatWhen(value: unknown) {
		if (!value) return null;
		const date = new Date(String(value));
		return Number.isNaN(date.getTime())
			? null
			: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
	function confidence(value: number | null) {
		return value === null ? '—' : Math.round(value * 100) + '%';
	}
	function evidenceText(value: unknown) {
		if (typeof value !== 'string' && value && typeof value === 'object')
			return Object.entries(value as Record<string, unknown>)
				.map(([key, item]) => key.replaceAll('_', ' ') + ': ' + String(item))
				.join(' · ');
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
	function stateLabel(state: string) {
		if (state === 'identity') return 'Identity ambiguity';
		if (state === 'eligibility') return 'Eligibility ambiguity';
		if (state === 'staleness') return 'Closure / staleness';
		if (state === 'matched') return 'Already matched brand';
		if (state === 'creation_gate') return 'Failed creation gate';
		return 'Ready to create';
	}
	function historyStatusClass(status: string | null) {
		if (status === 'cancelled' || status === 'rejected') return 'bg-zinc-200 text-zinc-700';
		if (status === 'completed' || status === 'resolved' || status === 'resolved_existing')
			return 'bg-emerald-50 text-emerald-800';
		if (status === 'known_negative') return 'bg-red-50 text-red-800';
		return 'bg-amber-50 text-amber-800';
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
					One storefront dossier per normalized address. Competing identities stay separate until
					you choose the current tenant, mark the space closed or vacant, or leave it unresolved.
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
			placeholder="Filter addresses or identities"
			class="min-w-0 flex-1 rounded-md border-zinc-300 text-sm"
		/>
		<button class="rounded-md border border-zinc-300 bg-white px-4 text-sm">Search</button>
	</form>

	{#if data.reviewTab === 'manual'}
		<section class="mt-5 space-y-4">
			{#each data.dossiers as dossier}
				{@const groups = dossier.identity_groups ?? []}
				<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
					<header
						class="flex flex-wrap justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3"
					>
						<div>
							<h2 class="font-semibold text-zinc-950">
								{dossier.display_address ??
									dossier.address_input ??
									dossier.normalized_address ??
									'Unknown address'}
							</h2>
							<p class="mt-1 text-xs text-zinc-500">
								{dossier.region_key ?? 'No region'}
								{#if googleMapsCoordinatesUrl(dossier.lat ?? null, dossier.lon ?? null)}
									·
									<a
										href={googleMapsCoordinatesUrl(dossier.lat ?? null, dossier.lon ?? null) ?? '#'}
										target="_blank"
										rel="noreferrer"
										class="text-blue-700">Map</a
									>
								{/if}
							</p>
							<p class="mt-1 text-xs text-zinc-400">
								{#if formatWhen(dossier.updated_at)}Updated {formatWhen(dossier.updated_at)}{/if}
							</p>
						</div>
						<div class="text-right text-xs">
							<p class="font-medium text-zinc-800">
								{storefrontReasonLabel(dossier.review_reason)}
							</p>
							<p class="mt-1 text-zinc-500">{groups.length} identity tiles</p>
						</div>
					</header>

					<div class="grid lg:grid-cols-[1fr_19rem]">
						<section class="space-y-3 p-4">
							<h3 class="text-xs font-semibold text-zinc-500 uppercase">Identity tiles</h3>
							<p class="text-[11px] text-zinc-500">
								Same-identity observations are already merged. Provider refresh time is a
								tie-breaker, not proof of the current tenant.
							</p>
							{#each groups as group}
								<div
									class="rounded-md border p-3 {group.identity_key ===
									dossier.suggested_identity_key
										? 'border-teal-300 bg-teal-50/40'
										: 'border-zinc-200'}"
								>
									<div class="flex flex-wrap items-start justify-between gap-2">
										<div>
											<p class="text-sm font-semibold text-zinc-950">
												{group.label ?? group.identity_key}
											</p>
											<p class="mt-0.5 font-mono text-[11px] text-zinc-500">
												{group.matched_brand_slug ?? group.identity_key}
											</p>
										</div>
										<div class="flex flex-wrap items-center gap-1 text-[11px]">
											{#if group.identity_key === dossier.suggested_identity_key}
												<span class="rounded bg-teal-100 px-2 py-0.5 font-medium text-teal-800"
													>Suggested</span
												>
											{/if}
											<span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600"
												>{group.current_count ?? 0} current</span
											>
											<span class="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600"
												>{group.closed_count ?? 0} closed</span
											>
										</div>
									</div>
									<div class="mt-3 space-y-2">
										{#each group.observations ?? [] as observation}
											<div class="rounded border border-zinc-200 bg-white px-3 py-2 text-xs">
												<div class="flex flex-wrap justify-between gap-2">
													<strong>{(observation.provider ?? 'source').toUpperCase()}</strong>
													<span class="text-zinc-500"
														>{storefrontRelationshipLabel(observation.relationship)} ·
														{storefrontLifecycleLabel(observation.lifecycle_status)}</span
													>
												</div>
												<p class="mt-1">{observation.name ?? group.label}</p>
												<p class="mt-1 text-zinc-500">
													{observation.display_address ??
														observation.address ??
														'No provider address'}
												</p>
												<div class="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
													{#if observationSourceHref(observation)}
														<a
															href={observationSourceHref(observation) ?? '#'}
															target="_blank"
															rel="noreferrer"
															class="text-blue-700"
															>{observation.provider === 'fsq' ? 'FSQ PlaceMaker' : 'Source'}</a
														>
													{/if}
													{#if formatWhen(observation.last_seen_at)}
														<span>Seen {formatWhen(observation.last_seen_at)}</span>
													{/if}
													{#if formatWhen(observation.provider_refreshed_at)}
														<span
															>Refresh {formatWhen(observation.provider_refreshed_at)} (tie-break only)</span
														>
													{/if}
												</div>
											</div>
										{/each}
									</div>
									<form
										method="POST"
										action="?/resolveDossier"
										use:enhance={enhanceAction}
										class="mt-3"
									>
										<input type="hidden" name="dossier_id" value={dossier.id} />
										<input type="hidden" name="filter_tab" value="manual" />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<input
											type="hidden"
											name="resolution"
											value={STOREFRONT_RESOLUTIONS.selectIdentity}
										/>
										<input type="hidden" name="selected_identity_key" value={group.identity_key} />
										<button
											class="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white"
											>Select as current</button
										>
									</form>
								</div>
							{/each}
							{#if groups.length === 0}
								<p class="text-xs text-zinc-500">No identity tiles on this storefront.</p>
							{/if}
						</section>

						<aside
							class="space-y-4 border-t border-zinc-200 bg-zinc-50 p-4 lg:border-t-0 lg:border-l"
						>
							<p class="text-[11px] font-medium text-zinc-500 uppercase">Storefront decision</p>
							<form
								method="POST"
								action="?/resolveDossier"
								use:enhance={enhanceAction}
								class="space-y-2"
							>
								<input type="hidden" name="dossier_id" value={dossier.id} />
								<input type="hidden" name="filter_tab" value="manual" />
								<input type="hidden" name="filter_q" value={searchTerm} />
								<input
									type="hidden"
									name="resolution"
									value={STOREFRONT_RESOLUTIONS.closedOrVacant}
								/>
								<input
									name="note"
									placeholder="Closed / vacant note"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<button
									class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
									>Mark storefront closed/vacant</button
								>
							</form>
							<form
								method="POST"
								action="?/resolveDossier"
								use:enhance={enhanceAction}
								class="space-y-2 border-t border-zinc-200 pt-4"
							>
								<input type="hidden" name="dossier_id" value={dossier.id} />
								<input type="hidden" name="filter_tab" value="manual" />
								<input type="hidden" name="filter_q" value={searchTerm} />
								<input
									type="hidden"
									name="resolution"
									value={STOREFRONT_RESOLUTIONS.keepUnresolved}
								/>
								<input
									name="note"
									placeholder="Why this should stay unresolved"
									class="w-full rounded-md border-zinc-300 text-xs"
								/>
								<button
									class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
									>Keep unresolved</button
								>
							</form>
						</aside>
					</div>
				</article>
			{/each}
			{#if data.dossiers.length === 0}
				<div
					class="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center text-sm text-zinc-500"
				>
					No storefront dossiers need review.
				</div>
			{/if}
			{#if !searchTerm.trim() && (data.dossierPage > 1 || data.dossierHasMore)}
				<nav class="flex justify-between text-sm" aria-label="Storefront pages">
					{#if data.dossierPage > 1}
						<a
							href={reviewUrl('manual', data.dossierPage - 1)}
							class="text-zinc-700 hover:text-zinc-950">Previous</a
						>
					{:else}
						<span></span>
					{/if}
					{#if data.dossierHasMore}
						<a
							href={reviewUrl('manual', data.dossierPage + 1)}
							class="text-zinc-700 hover:text-zinc-950">Next</a
						>
					{/if}
				</nav>
			{/if}
		</section>
	{:else if data.reviewTab === 'history'}
		<section class="mt-5">
			{#if data.history.length}
				<div class="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
					<table class="min-w-full text-left text-sm">
						<thead
							class="border-b border-zinc-200 bg-zinc-50 text-xs font-medium tracking-normal text-zinc-500 uppercase"
						>
							<tr>
								<th class="w-10 px-3 py-2.5"><span class="sr-only">Details</span></th>
								<th class="px-4 py-2.5">When</th>
								<th class="px-4 py-2.5">Candidate</th>
								<th class="px-4 py-2.5">Kind</th>
								<th class="px-4 py-2.5">Result</th>
								<th class="px-4 py-2.5">Decision</th>
							</tr>
						</thead>
						<tbody>
							{#each data.history as row}
								<tr
									class="border-b border-zinc-100 {expandedHistoryId === row.id
										? 'bg-zinc-50'
										: ''}"
								>
									<td class="px-3 py-2.5">
										<button
											type="button"
											class="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
											aria-expanded={expandedHistoryId === row.id}
											aria-label={expandedHistoryId === row.id
												? `Hide review details for ${row.canonical_name}`
												: `Show review details for ${row.canonical_name}`}
											on:click={() =>
												(expandedHistoryId = expandedHistoryId === row.id ? null : row.id)}
										>
											<svg
												class="h-4 w-4 transition-transform {expandedHistoryId === row.id
													? 'rotate-90'
													: ''}"
												viewBox="0 0 20 20"
												fill="currentColor"
												aria-hidden="true"
											>
												<path
													fill-rule="evenodd"
													d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 1 1 1.06-1.06l4.24 4.24a.75.75 0 0 1 0 1.06l-4.24 4.24a.75.75 0 0 1-1.08 0Z"
													clip-rule="evenodd"
												/>
											</svg>
										</button>
									</td>
									<td class="px-4 py-2.5 whitespace-nowrap text-zinc-600">
										{formatWhen(row.activity_at) ?? '—'}
									</td>
									<td class="px-4 py-2.5">
										<p class="font-medium text-zinc-950">{row.canonical_name}</p>
										{#if row.display_address}
											<p class="mt-0.5 text-xs text-zinc-700">{row.display_address}</p>
										{/if}
										<p class="mt-0.5 text-xs text-zinc-500">
											{row.region_key ?? 'No region'} · {(row.route_class ?? 'no route').replaceAll(
												'_',
												' '
											)}
											{#if row.matched_brand_slug}
												· {row.matched_brand_slug}
											{/if}
										</p>
									</td>
									<td class="px-4 py-2.5 text-zinc-600"
										>{(row.kind ?? 'review').replaceAll('_', ' ')}</td
									>
									<td class="px-4 py-2.5">
										<span
											class="rounded px-2 py-0.5 text-xs font-medium {historyStatusClass(
												row.status
											)}">{(row.status ?? 'unknown').replaceAll('_', ' ')}</span
										>
									</td>
									<td class="px-4 py-2.5 text-zinc-700">
										{(row.decision ?? '—').toString().replaceAll('_', ' ')}
										{#if row.model}
											<p class="mt-0.5 text-xs text-zinc-400">{row.model}</p>
										{/if}
									</td>
								</tr>
								{#if expandedHistoryId === row.id}
									<tr class="border-b border-zinc-200 bg-zinc-50">
										<td colspan="6" class="px-5 py-4 text-xs text-zinc-600">
											<p>
												Candidate status: {(row.process_status ?? 'unknown').replaceAll('_', ' ')}
											</p>
											{#if row.display_address}
												<p class="mt-1">{row.display_address}</p>
											{/if}
											{#if row.error_text}
												<p class="mt-2 text-red-700">{row.error_text}</p>
											{/if}
											{#if row.evidence}
												<pre
													class="mt-3 max-h-64 overflow-auto text-[11px] whitespace-pre-wrap">{JSON.stringify(
														row.evidence,
														null,
														2
													)}</pre>
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div
					class="rounded-lg border border-zinc-200 bg-white px-6 py-14 text-center text-sm text-zinc-500"
				>
					No completed or cancelled reviews yet.
				</div>
			{/if}
		</section>
	{:else}
		<section class="mt-5 space-y-4">
			{#each data.candidates as candidate}
				{@const observations = data.observationsByCandidate[candidate.id] ?? []}
				{@const review = data.latestReviewByCandidate[candidate.id]}
				{@const actions = reviewActionFlags(candidate, review)}
				{@const suggestions = optionsFor(candidate)}
				{@const canAct = [
					'pending',
					'needs_exception_resolution',
					'needs_manual_review',
					'ready_for_enrichment'
				].includes(candidate.process_status)}
				<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
					<header
						class="flex flex-wrap justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3"
					>
						<div>
							<h2 class="font-semibold text-zinc-950">
								{candidate.canonical_name ?? 'Unnamed POI'}
							</h2>
							<p class="mt-1 text-xs text-zinc-500">
								{candidateAddress(candidate, observations) ?? 'Address unavailable'} · {candidate.region_key ??
									'No region'}
							</p>
							<p class="mt-1 text-xs text-zinc-400">
								{#if formatWhen(candidate.updated_at)}
									Updated {formatWhen(candidate.updated_at)}
								{/if}
								{#if formatWhen(candidate.created_at) && candidate.created_at !== candidate.updated_at}
									· Created {formatWhen(candidate.created_at)}
								{/if}
								{#if googleMapsCoordinatesUrl(candidate.lat, candidate.lon)}
									·
									<a
										href={googleMapsCoordinatesUrl(candidate.lat, candidate.lon) ?? '#'}
										target="_blank"
										rel="noreferrer"
										class="text-blue-700">Map</a
									>
								{/if}
							</p>
						</div>
						<div class="text-right text-xs">
							<p class="font-medium text-zinc-800">
								{candidate.process_status.replaceAll('_', ' ')}
							</p>
							<p class="mt-1 text-zinc-500">
								{candidate.route_class?.replaceAll('_', ' ') ?? 'No route'}
							</p>
							<p class="mt-1 text-zinc-400">{stateLabel(actions.state)}</p>
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
											{#if observationSourceHref(observation)}<a
													href={observationSourceHref(observation) ?? '#'}
													target="_blank"
													rel="noreferrer"
													class="text-blue-700"
													>{observation.provider === 'fsq' ? 'FSQ PlaceMaker' : 'Source'}</a
												>{/if}
										</div>
										<p class="mt-1">{observation.observed_name ?? candidate.canonical_name}</p>
										<p class="mt-1 text-zinc-500">
											{observationAddress(observation) ?? 'No provider address'}
										</p>
										<p class="mt-1 font-mono text-[11px] break-all text-zinc-500">
											{observation.provider_record_id}
										</p>
										{#if formatWhen(observation.last_seen_at)}
											<p class="mt-1 text-zinc-400">Seen {formatWhen(observation.last_seen_at)}</p>
										{/if}
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
										{review.review_kind} · {review.decision ?? review.status}
									</p>
									<p class="mt-1 text-blue-700">
										{review.model ?? 'deterministic'} · {confidence(review.confidence)}
									</p>
									{#each review.evidence ?? [] as item}<p class="mt-2">
											{evidenceText(item)}
										</p>{/each}
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
								<p class="text-[11px] font-medium text-zinc-500 uppercase">
									{stateLabel(actions.state)}
								</p>
								{#if actions.showConfirmEligible}
									<form
										method="POST"
										action="?/confirmEligible"
										use:enhance={enhanceAction}
										class="space-y-2"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<input
											name="note"
											placeholder="Eligibility note"
											class="w-full rounded-md border-zinc-300 text-xs"
										/>
										<button
											class="w-full rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
											>Confirm eligible</button
										>
									</form>
								{/if}

								{#if actions.showConfirmCurrent}
									<form
										method="POST"
										action="?/confirmCurrent"
										use:enhance={enhanceAction}
										class="space-y-2"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<button
											class="w-full rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white"
											>Confirm current</button
										>
									</form>
								{/if}

								{#if actions.showAttach}
									<form
										method="POST"
										action="?/merge"
										use:enhance={enhanceAction}
										class="space-y-2 {actions.showConfirmEligible || actions.showConfirmCurrent
											? 'border-t border-zinc-200 pt-4'
											: ''}"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<span class="text-[11px] text-zinc-600">Attach / confirm existing brand</span>
										<input
											name="brand_slug"
											list={'brands-' + candidate.id}
											value={review?.proposed_brand_slug ?? candidate.matched_brand_slug ?? ''}
											required
											placeholder="Brand slug"
											class="w-full rounded-md border-zinc-300 font-mono text-xs"
										/>
										<datalist id={'brands-' + candidate.id}
											>{#each suggestions as brand}<option value={brand.slug}
													>{brand.display}</option
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
								{/if}

								{#if actions.showCreate}
									<form
										method="POST"
										action="?/approve"
										use:enhance={enhanceAction}
										class="space-y-2 {actions.showAttach ||
										actions.showConfirmEligible ||
										actions.showConfirmCurrent
											? 'border-t border-zinc-200 pt-4'
											: ''}"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<input
											name="force_display"
											value={candidate.canonical_name ?? ''}
											placeholder="Brand display"
											disabled={!actions.createEnabled}
											class="w-full rounded-md border-zinc-300 text-xs disabled:bg-zinc-100"
										/>
										<input
											name="note"
											placeholder="Approval note"
											disabled={!actions.createEnabled}
											class="w-full rounded-md border-zinc-300 text-xs disabled:bg-zinc-100"
										/>
										<button
											disabled={!actions.createEnabled}
											class="w-full rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
											>Create new brand</button
										>
										{#if !actions.createEnabled}
											<p class="text-[11px] leading-4 text-zinc-500">
												Create stays disabled until {actions.blockedCreateReasons.join(', ')} pass.
											</p>
										{/if}
									</form>
								{/if}

								{#if actions.showRejectClosed}
									<form
										method="POST"
										action="?/rejectClosed"
										use:enhance={enhanceAction}
										class="space-y-2 border-t border-zinc-200 pt-4"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<input
											name="note"
											placeholder="Closed / replaced evidence"
											class="w-full rounded-md border-zinc-300 text-xs"
										/>
										<button
											class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
											>Reject as closed</button
										>
									</form>
								{:else if actions.showReject}
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
								{/if}

								{#if actions.showReturnToReview}
									<form
										method="POST"
										action="?/returnToReview"
										use:enhance={enhanceAction}
										class="space-y-2 border-t border-zinc-200 pt-4"
									>
										<input type="hidden" name="candidate_id" value={candidate.id} />
										<input type="hidden" name="filter_tab" value={data.reviewTab} />
										<input type="hidden" name="filter_q" value={searchTerm} />
										<button
											class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold"
											>Return to review</button
										>
									</form>
								{/if}
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
	{/if}
</main>
