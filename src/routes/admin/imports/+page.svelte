<!-- src/routes/admin/imports/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type OsmCandidateStatus =
		| 'pending'
		| 'merged'
		| 'approved'
		| 'needs_review'
		| 'blocked'
		| 'rejected';
	type CandidateStatusFilter = 'all' | OsmCandidateStatus;

	export let data: {
		jobs: Array<{
			id: string;
			source: string | null;
			status: 'running' | 'succeeded' | 'failed';
			created_at: string;
			stats: Record<string, number> | null;
			note: string | null;
			error_text: string | null;
		}>;
		candidates: Array<{
			id: string;
			name: string | null;
			lat: number | null;
			lon: number | null;
			tags: Record<string, string> | null;
			matched_brand_slug: string | null;
			match_score: number | null;
			blocked_brand: boolean;
			blocked_reason: string | null;
			staging_id: string | null;
			process_status: OsmCandidateStatus;
			created_at: string;
		}>;
		stagingRows: Array<{
			id: string;
			suggested_name: string;
			normalized_name: string | null;
			location: string | null;
			status: string;
			source: string;
			duplicates: number | null;
			created_at: string;
			approved_slug: string | null;
		}>;
		regionCodes: Array<{
			code: string;
			country_code: string;
			region_name: string;
		}>;
		candidateStatuses: OsmCandidateStatus[];
		candStatus: CandidateStatusFilter;
		q: string;
	};

	const candidateStatusLabels: Record<CandidateStatusFilter, string> = {
		all: 'All',
		pending: 'Pending',
		needs_review: 'Needs review',
		blocked: 'Blocked',
		approved: 'Approved',
		merged: 'Merged',
		rejected: 'Rejected'
	};

	// Build a friendly location label from OSM tags, or fall back to coords
	function locLabel(c: {
		lat: number | null;
		lon: number | null;
		tags: Record<string, any> | null;
	}) {
		const t = c.tags ?? {};
		// Prefer addr:* (street number & street), then city/town/village
		const no = t['addr:housenumber'] || '';
		const street = t['addr:street'] || '';
		const city = t['addr:city'] || t.city || t.town || t.village || '';

		if (street || no) return `${no ? no + ' ' : ''}${street}${city ? ', ' + city : ''}`;
		if (city) return city;
		if (typeof c.lat === 'number' && typeof c.lon === 'number') {
			return `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
		}
		return '';
	}

	// Link to a map for quick verification (OSM link)
	function osmLink(c: { lat: number | null; lon: number | null }) {
		if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return null;
		return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}`;
	}

	const defaultParams = JSON.stringify(
		{
			bbox: [32.4, -124.5, 42.1, -114.1],
			timeout: 180,
			filters: [
				{ k: 'cuisine', op: '~', v: '^(bubble_tea|milk_tea)$' },
				{
					k: 'amenity',
					op: '=',
					v: 'cafe',
					nameRegex: '(\\btea\\b|\\bcha\\b|\\bbubble\\b|\\bboba\\b)',
					i: true
				}
			],
			out: 'center'
		},
		null,
		2
	);

	let selectedRegionCode =
		data.regionCodes.find((r) => r.code === 'US-CA')?.code ?? data.regionCodes[0]?.code ?? 'US-CA';
	let jobsContainer: HTMLDivElement | null = null;
	let visibleJobsCount = 25;
	let searchTerm = data.q;
	let lastSyncedQ = data.q;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	$: visibleJobs = data.jobs.slice(0, visibleJobsCount);
	$: if (data.q !== lastSyncedQ) {
		searchTerm = data.q;
		lastSyncedQ = data.q;
	}

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

	$: selectedRegion = data.regionCodes.find((r) => r.code === selectedRegionCode);

	function candidateUrl(status = data.candStatus, q = searchTerm) {
		const params = new URLSearchParams();
		params.set('status', status);
		const trimmed = q.trim();
		if (trimmed) params.set('q', trimmed);
		return `/admin/imports?${params.toString()}`;
	}

	function applyCandidateFilters(status = data.candStatus, q = searchTerm, replaceState = false) {
		return goto(candidateUrl(status, q), {
			keepFocus: true,
			noScroll: true,
			replaceState
		});
	}

	function scheduleCandidateSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = null;
			void applyCandidateFilters(data.candStatus, searchTerm, true);
		}, 250);
	}
</script>

<main class="mx-auto max-w-6xl space-y-8 px-4 py-6">
	<h1 class="text-2xl font-bold">OSM Imports</h1>

	<!-- Queue form -->
	<section class="space-y-3 rounded-xl border p-4">
		<h2 class="font-semibold">Start OSM Import</h2>

		<form method="POST" action="/admin/imports/_api/queue" class="space-y-2">
			<label for="region_key" class="block text-xs text-gray-600">Region key</label>
			<select
				id="region_key"
				name="region_key"
				class="w-full rounded border px-3 py-2 text-sm"
				bind:value={selectedRegionCode}
			>
				{#each data.regionCodes as rc}
					<option value={rc.code}>{rc.region_name} ({rc.country_code})</option>
				{/each}
			</select>
			{#if selectedRegion}
				<p class="text-xs text-gray-500">
					{selectedRegion.code} · {selectedRegion.region_name}, {selectedRegion.country_code}
				</p>
			{/if}

			<label for="params" class="block text-xs text-gray-600"
				>Params (JSON; must include bbox:[south,west,north,east])</label
			>
			<textarea
				id="params"
				name="params"
				class="h-40 w-full rounded-lg border px-3 py-2 font-mono text-sm"
				spellcheck="false">{defaultParams}</textarea
			>

			<div class="flex items-center gap-2">
				<input
					name="note"
					class="flex-1 rounded border px-3 py-2 text-sm"
					placeholder="Note (optional)"
				/>
				<button type="submit" class="rounded-lg bg-gray-900 px-4 py-2 text-white">Queue</button>
			</div>
		</form>
	</section>

	<!-- Jobs -->
	<section class="overflow-hidden rounded-xl border">
		<div class="max-h-[22rem] overflow-y-auto" bind:this={jobsContainer} on:scroll={onJobsScroll}>
			<table class="w-full text-sm">
				<thead class="sticky top-0 z-10 bg-gray-50">
					<tr>
						<th class="px-4 py-2 text-left">Created</th>
						<th class="px-4 py-2 text-left">Status</th>
						<th class="px-4 py-2 text-left">Note</th>
						<th class="px-4 py-2 text-left">Stats</th>
						<th class="px-4 py-2 text-left">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each visibleJobs as r}
						<tr>
							<td class="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
							<td class="px-4 py-2">
								{#if r.status === 'running'}
									<span
										class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
										>running</span
									>
								{:else if r.status === 'succeeded'}
									<span
										class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
										>succeeded</span
									>
								{:else if r.status === 'failed'}
									<span
										class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800"
										>failed</span
									>
								{:else}
									<span
										class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800"
										>{r.status}</span
									>
								{/if}
							</td>
							<td class="px-4 py-2">{r.note ?? '—'}</td>
							<td class="px-4 py-2">
								{#if r.stats}
									<div class="flex flex-wrap gap-1">
										<span
											class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800"
											title="Total elements seen">seen {r.stats.total_elements ?? 0}</span
										>
										<span
											class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
											title="New or updated candidates">+{r.stats.inserted_or_updated ?? 0}</span
										>
										<span
											class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
											title="Unchanged rows">upd {r.stats.unchanged ?? 0}</span
										>
										<span
											class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
											title="Skipped elements">skip {r.stats.skipped ?? 0}</span
										>
									</div>
								{:else}
									—
								{/if}

								{#if r.status === 'failed' && r.error_text}
									<div class="mt-1 line-clamp-2 text-xs text-red-600">{r.error_text}</div>
								{/if}
							</td>
							<td class="px-4 py-2">
								<div class="flex items-center gap-2">
									<form method="POST" action="/admin/imports/process" class="m-0">
										<input type="hidden" name="job_id" value={r.id} />
										<button
											class="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
											disabled={r.status === 'running'}
											title={r.status === 'running' ? 'Already running' : 'Process this job'}
										>
											{r.status === 'running' ? 'Processing…' : 'Process'}
										</button>
									</form>

									<form method="POST" action="/admin/imports/_api/dequeue" class="m-0">
										<input type="hidden" name="job_id" value={r.id} />
										<button class="rounded bg-red-600 px-2 py-1 text-xs text-white">Delete</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if visibleJobsCount < data.jobs.length}
				<div class="border-t bg-white px-4 py-2 text-xs text-gray-500">
					Loading more jobs as you scroll... ({visibleJobsCount}/{data.jobs.length})
				</div>
			{/if}
		</div>
	</section>

	<!-- Candidates -->
	<section class="rounded-xl border bg-white">
		<!-- Header / Controls (outside the list) -->
		<div class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
			<div class="flex items-center gap-3">
				<h2 class="text-lg font-semibold">Candidates</h2>
				<span class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
					>{data.candidates.length}</span
				>
			</div>

			<form
				method="GET"
				class="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto"
				on:submit|preventDefault={() => applyCandidateFilters(data.candStatus, searchTerm)}
			>
				<!-- Segmented status pills -->
				<div class="flex flex-wrap gap-1 rounded-lg border bg-gray-50 p-1 text-xs">
					<label class="cursor-pointer">
						<input
							type="radio"
							class="peer sr-only"
							name="status"
							value="all"
							checked={data.candStatus === 'all'}
							on:change={() => applyCandidateFilters('all', searchTerm)}
						/>
						<span
							class="inline-flex rounded-md px-3 py-1 peer-checked:border peer-checked:border-gray-200 peer-checked:bg-white peer-checked:shadow"
							>{candidateStatusLabels.all}</span
						>
					</label>
					{#each data.candidateStatuses as status}
						<label class="cursor-pointer">
							<input
								type="radio"
								class="peer sr-only"
								name="status"
								value={status}
								checked={data.candStatus === status}
								on:change={() => applyCandidateFilters(status, searchTerm)}
							/>
							<span
								class="inline-flex rounded-md px-3 py-1 peer-checked:border peer-checked:border-gray-200 peer-checked:bg-white peer-checked:shadow"
								>{candidateStatusLabels[status]}</span
							>
						</label>
					{/each}
				</div>

				<!-- Search -->
				<div class="relative flex-1 sm:w-72">
					<svg
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387-1.414 1.414-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z"
							clip-rule="evenodd"
						/>
					</svg>
					<input
						name="q"
						class="w-full rounded-lg border px-9 py-2 text-sm placeholder:text-gray-400"
						placeholder="Search name…"
						bind:value={searchTerm}
						on:input={scheduleCandidateSearch}
					/>
				</div>

				<button class="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">Apply</button>
			</form>
		</div>

		<!-- List -->
		<div class="divide-y">
			{#each data.candidates as c}
				<article class="p-4">
					<!-- TRUE side-by-side on md+ -->
					<div class="md:flex md:items-start md:gap-4">
						<!-- LEFT: info -->
						<div class="min-w-0 md:flex-1">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<h3 class="truncate text-sm font-medium">{c.name}</h3>

										{#if c.matched_brand_slug}
											<span
												class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
											>
												match {c.matched_brand_slug} ({(c.match_score ?? 0).toFixed(2)})
											</span>
										{:else}
											<span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700"
												>new brand?</span
											>
										{/if}

										{#if c.blocked_brand}
											<span class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-red-700"
												>blocked</span
											>
										{/if}

										{#if c.staging_id}
											<span
												class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700"
												>pending staging</span
											>
										{/if}
									</div>

									<div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
										<span class="truncate">{locLabel(c)}</span>
										{#if osmLink(c)}
											<a
												class="text-blue-600 underline hover:text-blue-800"
												target="_blank"
												rel="noreferrer"
												href={osmLink(c)}>map</a
											>
										{/if}
									</div>

									{#if c.tags && Object.keys(c.tags).length}
										<div
											class="mt-2 grid gap-1.5 text-[11px] text-gray-700 sm:grid-cols-2 lg:grid-cols-3"
										>
											{#each Object.entries(c.tags).slice(0, 6) as [k, v]}
												<div class="truncate">
													<span class="font-medium text-gray-500">{k}:</span>
													{String(v)}
												</div>
											{/each}
											{#if Object.keys(c.tags).length > 6}
												<div class="text-gray-500">… and {Object.keys(c.tags).length - 6} more</div>
											{/if}
										</div>
									{/if}
								</div>

								<div class="text-[11px] whitespace-nowrap text-gray-500">
									{new Date(c.created_at).toLocaleString()}
								</div>
							</div>
						</div>

						<!-- RIGHT: actions -->
						<div class="mt-3 md:mt-0 md:w-[560px] md:shrink-0">
							<div class="space-y-2">
								<!-- APPROVE -->
								<form
									method="POST"
									action="?/approve"
									class="grid items-center gap-2 overflow-x-auto sm:grid-cols-[1fr_1fr_auto]"
								>
									<input type="hidden" name="candidate_id" value={c.id} />
									<input
										name="force_display"
										class="w-full rounded-lg border px-3 py-2 text-xs"
										placeholder={`Force display (e.g. ${c.name})`}
									/>
									<input
										name="note"
										class="w-full rounded-lg border px-3 py-2 text-xs"
										placeholder="note (optional)"
									/>
									<button class="h-9 rounded-lg bg-blue-600 px-3 text-xs text-white">Approve</button
									>
								</form>

								<!-- MERGE -->
								<form
									method="POST"
									action="?/merge"
									class="grid items-center gap-2 overflow-x-auto sm:grid-cols-[1fr_1fr_auto]"
								>
									<input type="hidden" name="candidate_id" value={c.id} />
									<input
										name="brand_slug"
										required
										class="w-full rounded-lg border px-3 py-2 text-xs"
										placeholder="brand_slug"
										value={c.matched_brand_slug ?? ''}
									/>
									<input
										name="note"
										class="w-full rounded-lg border px-3 py-2 text-xs"
										placeholder="note (optional)"
									/>
									<button class="h-9 rounded-lg bg-amber-600 px-3 text-xs text-white">Merge</button>
								</form>

								<!-- REJECT -->
								<form
									method="POST"
									action="?/reject"
									class="grid items-center gap-2 overflow-x-auto sm:grid-cols-[1fr_auto]"
								>
									<input type="hidden" name="candidate_id" value={c.id} />
									<input
										name="note"
										class="w-full rounded-lg border px-3 py-2 text-xs"
										placeholder="reason / note (optional)"
									/>
									<button class="h-9 rounded-lg bg-gray-200 px-3 text-xs text-gray-900"
										>Reject</button
									>
								</form>
							</div>
						</div>
					</div>
				</article>
			{/each}
			{#if data.candidates.length === 0}
				<div class="px-4 py-10 text-center">
					<p class="text-sm font-medium text-gray-900">No OSM candidates match this view.</p>
					<p class="mt-1 text-sm text-gray-500">
						Try the All filter or clear the search term if candidates were imported under another
						status.
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- Staging Rows -->
	<section class="rounded-xl border bg-white">
		<div class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
			<div class="flex items-center gap-3">
				<h2 class="text-lg font-semibold">Staging Rows</h2>
				<span class="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
					>{data.stagingRows.length}</span
				>
			</div>
		</div>

		<div class="divide-y">
			{#each data.stagingRows as s}
				<article class="p-4">
					<div class="md:flex md:items-start md:justify-between md:gap-4">
						<div class="min-w-0 md:flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-sm font-medium">{s.suggested_name}</h3>
								<span class="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700"
									>{s.status}</span
								>
								{#if s.duplicates && s.duplicates > 1}
									<span
										class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
										title="Duplicate count">dupes {s.duplicates}</span
									>
								{/if}
							</div>

							<div class="mt-1 truncate text-[11px] text-gray-600">
								{s.location ?? '—'}
							</div>
							{#if s.normalized_name}
								<div class="mt-1 truncate text-[11px] text-gray-500">
									normalized: {s.normalized_name}
								</div>
							{/if}
							{#if s.approved_slug}
								<div class="mt-1 truncate text-[11px] text-gray-500">
									approved: {s.approved_slug}
								</div>
							{/if}
						</div>

						<div class="mt-2 text-[11px] whitespace-nowrap text-gray-500 md:mt-0 md:shrink-0">
							{new Date(s.created_at).toLocaleString()}
						</div>
					</div>
				</article>
			{/each}
		</div>
	</section>
</main>
