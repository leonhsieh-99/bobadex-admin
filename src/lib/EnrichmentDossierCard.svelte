<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		approvalStatusClass,
		approvalStatusLabel,
		automaticGeography,
		canonicalResearchLocations,
		dossierResearchTopics,
		flagDescription,
		flagSourceUrls,
		identityLabel,
		percent,
		publicSummaryValue,
		relativeDate,
		researchRoute,
		researchRouteLabel,
		researchTopicRows,
		statusClasses,
		topicCoverageClass,
		topicCoverageLabel,
		type EnrichmentDossierView
	} from '$lib/enrichment-dossier';
	import { coordinatesLabel, googleMapsCoordinatesUrl } from '$lib/maps';

	export let dossier: EnrichmentDossierView;
	export let pendingAction = '';
	export let flagAction: string | null = null;
	export let flagEnhance: any = null;
	export let onPublish: (() => void) | null = null;
	export let onRerun: (() => void) | null = null;
	export let onReset: (() => void) | null = null;
	export let onMerge: (() => void) | null = null;
	export let onMarkClosed: (() => void) | null = null;
	export let onDelete: (() => void) | null = null;

	function applyFlagEnhance(node: HTMLFormElement) {
		return enhance(node, flagEnhance as never);
	}

	$: showFooter = Boolean(onPublish || onRerun || onReset || onMerge || onMarkClosed || onDelete);
</script>

<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
	<header
		class="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
	>
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<h4 class="text-base font-semibold break-all text-zinc-950">
					{dossier.identity.display}
				</h4>
				<code class="text-xs text-zinc-500">{dossier.brand_slug}</code>
				<span class="rounded px-2 py-1 text-xs font-medium {approvalStatusClass(dossier.approval_status)}"
					>{approvalStatusLabel(dossier.approval_status)}</span
				>
				{#if dossier.integrityFlags.length}<span
						class="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
						>{dossier.integrityFlags.length} open flag{dossier.integrityFlags.length === 1
							? ''
							: 's'}</span
					>{/if}
				{#if dossier.activeJob}
					<span class="rounded px-2 py-1 text-xs font-medium {statusClasses(dossier.activeJob.status)}">
						{dossier.activeJob.status === 'running' ? 'Enrichment running' : 'Enrichment queued'}
					</span>
				{/if}
			</div>
			<p class="mt-1 text-xs text-zinc-500">
				Updated {relativeDate(dossier.updated_at)}{dossier.run?.researcher_version
					? ` · ${dossier.run.researcher_version}`
					: dossier.run?.model
						? ` · ${dossier.run.model}`
						: ''}
			</p>
		</div>
		<div class="grid grid-cols-3 gap-4 text-right text-xs sm:grid-cols-5">
			<div>
				<p class="font-semibold text-zinc-900">{percent(dossier.metrics.overallConfidence)}</p>
				<p class="text-zinc-500">overall</p>
			</div>
			<div>
				<p class="font-semibold text-zinc-900">{identityLabel(dossier)}</p>
				<p class="text-zinc-500">identity evidence</p>
			</div>
			<div>
				<p class="font-semibold text-zinc-900">{percent(dossier.metrics.citationCoverage)}</p>
				<p class="text-zinc-500">coverage</p>
			</div>
			<div>
				<p class="font-semibold text-zinc-900">{dossier.metrics.credibleSources ?? '—'}</p>
				<p class="text-zinc-500">credible</p>
			</div>
			<div>
				<p class="font-semibold text-zinc-900">{dossier.metrics.independentSources ?? '—'}</p>
				<p class="text-zinc-500">independent</p>
			</div>
		</div>
	</header>

	<div class="grid gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
		<div class="min-w-0 space-y-6">
			<section>
				<h5 class="text-xs font-semibold text-zinc-500 uppercase">Admin diagnostic summary</h5>
				<p class="mt-2 text-sm leading-6 whitespace-pre-wrap text-zinc-700">
					{dossier.run?.customer_summary_draft ??
						dossier.customer_summary ??
						'No draft summary was produced.'}
				</p>
			</section>

			<section class="border-t border-zinc-200 pt-5">
				<h5 class="text-xs font-semibold text-zinc-500 uppercase">User-facing summary</h5>
				<p class="mt-2 text-sm leading-6 text-zinc-700">
					{publicSummaryValue(dossier) || 'No consumer summary was produced.'}
				</p>
			</section>

			<section class="border-t border-zinc-200 pt-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h5 class="text-xs font-semibold text-zinc-500 uppercase">Research coverage</h5>
					<span class="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
						{researchRouteLabel(researchRoute(dossier))}
					</span>
				</div>
				{#if researchRoute(dossier) === 'local_identity'}
					<div class="mt-3 border-l-2 border-blue-300 bg-blue-50 px-3 py-2">
						<p class="text-xs font-semibold text-blue-900">Canonical research anchor</p>
						{#each canonicalResearchLocations(dossier) as location}
							<p class="mt-1 text-xs leading-5 text-blue-900">
								{location.label}{location.address && location.address !== location.label
									? ` · ${location.address}`
									: ''}
							</p>
						{:else}
							<p class="mt-1 text-xs text-blue-800">No canonical location was captured.</p>
						{/each}
					</div>
				{/if}
				<div class="mt-3 divide-y divide-zinc-200 border-y border-zinc-200">
					{#each researchTopicRows as row}
						{@const topic = dossierResearchTopics(dossier)[row.key]}
						<div class="py-3">
							<div class="flex items-center justify-between gap-3">
								<p class="text-sm font-medium text-zinc-900">{row.label}</p>
								<span
									class="rounded px-2 py-0.5 text-xs font-medium {topicCoverageClass(
										topic?.coverage
									)}"
								>
									{topicCoverageLabel(topic?.coverage)}
								</span>
							</div>
							<p class="mt-1 text-xs leading-5 text-zinc-600">
								{topic?.summary || 'No supported finding was produced for this topic.'}
							</p>
						</div>
					{/each}
				</div>
			</section>
		</div>

		<aside class="space-y-5">
			<section>
				<div class="flex items-center justify-between gap-3">
					<h5 class="text-xs font-semibold text-zinc-500 uppercase">Automatic geography</h5>
					<span class="text-xs text-zinc-500">{automaticGeography(dossier).length}</span>
				</div>
				<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
					{#each automaticGeography(dossier) as location}
						<div class="py-2.5">
							<p class="text-xs font-medium text-zinc-800">{location.label}</p>
							<p class="mt-0.5 text-xs text-zinc-500">
								{location.confidence ?? 'derived'}{location.provider ? ` · ${location.provider}` : ''}
							</p>
						</div>
					{/each}
					{#if automaticGeography(dossier).length === 0}
						<p class="py-3 text-sm text-zinc-500">This run predates automatic place resolution.</p>
					{/if}
				</div>
			</section>

			<section>
				<div class="flex items-center justify-between gap-3">
					<h5 class="text-xs font-semibold text-zinc-500 uppercase">Locations</h5>
					<span class="text-xs text-zinc-500">{dossier.physicalLocations.length}</span>
				</div>
				<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
					{#each dossier.physicalLocations as location}
						<div class="py-2.5">
							<p class="font-mono text-[10px] text-zinc-400">Location {location.id.slice(0, 8)}</p>
							<p class="mt-0.5 truncate text-xs font-medium text-zinc-800">
								{[location.city, location.county, location.region].filter(Boolean).join(', ') ||
									'Unresolved place'}
							</p>
							{#if googleMapsCoordinatesUrl(location.lat, location.lon)}
								<a
									href={googleMapsCoordinatesUrl(location.lat, location.lon) ?? '#'}
									target="_blank"
									rel="noreferrer"
									class="mt-0.5 inline-block font-mono text-xs text-blue-700 hover:underline"
									>{coordinatesLabel(location.lat, location.lon)}</a
								>
							{:else}
								<p class="mt-0.5 text-xs text-zinc-500">Coordinates unavailable</p>
							{/if}
							{#if location.evidence.length}
								<div class="mt-1.5 flex flex-wrap gap-1.5">
									{#each location.evidence as evidence}
										<span
											class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600"
											>{evidence.osm_id
												? `OSM ${evidence.osm_type ?? 'node'} ${evidence.osm_id}`
												: `Manual · ${evidence.verification_status ?? 'unverified'}`}</span
										>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
					{#if dossier.physicalLocations.length === 0}
						<p class="py-3 text-sm text-zinc-500">No confirmed locations.</p>
					{/if}
				</div>
			</section>

			<section>
				<h5 class="text-xs font-semibold text-zinc-500 uppercase">Review reasons</h5>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each dossier.review_reasons ?? [] as reason}<span
							class="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
							>{reason.replaceAll('_', ' ')}</span
						>{/each}{#if !dossier.review_reasons?.length}<span class="text-sm text-zinc-500"
							>No reason supplied.</span
						>{/if}
				</div>
			</section>

			{#if dossier.integrityFlags.length}
				<section>
					<h5 class="text-xs font-semibold text-red-700 uppercase">Integrity flags</h5>
					<div class="mt-2 space-y-2">
						{#each dossier.integrityFlags as flag}
							<div class="border-l-2 border-red-400 bg-red-50 px-3 py-2">
								<p class="text-sm font-medium text-red-900">{flag.title}</p>
								{#if flagDescription(flag.details)}<p class="mt-1 text-xs text-red-800">
										{flagDescription(flag.details)}
									</p>{/if}
								{#if flagSourceUrls(flag.details).length}
									<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
										{#each flagSourceUrls(flag.details) as url}
											<a
												href={url}
												target="_blank"
												rel="noreferrer"
												class="text-xs text-red-800 underline hover:text-red-950">Source</a
											>
										{/each}
									</div>
								{/if}
								{#if flag.recommended_action}
									<p class="mt-1 text-xs font-medium text-red-900">{flag.recommended_action}</p>
								{/if}
								{#if flagAction && flagEnhance}
									<form
										method="post"
										action={flagAction}
										use:applyFlagEnhance
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
										>
										<button
											name="resolution"
											value="dismissed"
											disabled={Boolean(pendingAction)}
											class="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
											>Dismiss</button
										>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section>
				<h5 class="text-xs font-semibold text-zinc-500 uppercase">Published profile</h5>
				{#if dossier.profile}
					<div class="mt-2 border-l-2 border-emerald-400 pl-3">
						<p class="text-sm leading-6 text-zinc-700">
							{dossier.profile.summary ?? 'Published without a summary.'}
						</p>
						<p class="mt-1 text-xs text-zinc-500">
							{dossier.profile.publication_method ?? 'Unknown method'} · {percent(
								dossier.profile.summary_confidence
							)}
						</p>
					</div>
				{:else}
					<p class="mt-2 text-sm text-zinc-500">No published profile.</p>
				{/if}
			</section>
		</aside>
	</div>

	{#if showFooter}
		<footer class="border-t border-zinc-200 bg-zinc-50 px-5 py-4">
			<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
				<div class="flex flex-wrap items-center gap-2">
					{#if onPublish}
						<button
							type="button"
							onclick={onPublish}
							class="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
							disabled={Boolean(pendingAction)}
						>
							Review and publish
						</button>
					{/if}
					{#if onRerun}
						<button
							type="button"
							onclick={onRerun}
							disabled={Boolean(dossier.activeJob) || Boolean(pendingAction)}
							class="rounded border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
							>{dossier.activeJob ? 'Enrichment rerun queued' : 'Rerun enrichment'}</button
						>
					{/if}
					{#if onReset}
						<button
							type="button"
							onclick={onReset}
							disabled={Boolean(pendingAction)}
							class="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
							>Reset enrichment</button
						>
					{/if}
				</div>
				<div
					class="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 lg:justify-end lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3"
				>
					{#if onMerge}
						<button
							type="button"
							onclick={onMerge}
							disabled={Boolean(pendingAction)}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
							>Merge brand</button
						>
					{/if}
					{#if onMarkClosed}
						<button
							type="button"
							onclick={onMarkClosed}
							disabled={Boolean(pendingAction)}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
							>Mark closed</button
						>
					{/if}
					{#if onDelete}
						<button
							type="button"
							onclick={onDelete}
							disabled={Boolean(pendingAction)}
							class="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
							>Delete false positive</button
						>
					{/if}
				</div>
			</div>
		</footer>
	{/if}
</article>
