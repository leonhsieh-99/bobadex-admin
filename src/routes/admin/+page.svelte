<script lang="ts">
	type JobStatus = string;

	export let data: {
		metrics: {
			reviewQueue: number;
			needsReview: number;
			exceptions: number;
			activeJobs: number;
			failedJobs: number;
			pendingIntake: number;
			pendingBrands: number;
			pendingReports: number;
			brandCount: number;
			newBrands: number;
			totalCandidates: number;
			enrichmentQueue: number;
			failedEnrichmentJobs: number;
			dossiersNeedingReview: number;
			publishedProfiles: number;
			dueRefreshes: number;
			openIntegrityFlags: number;
			missingCrons: number | null;
		};
		pipeline: {
			candidateStatusCounts: Record<string, number>;
			shardCounts: Record<string, number>;
		};
		latestImport: {
			id: string;
			status: JobStatus;
			scope_label: string;
			region_key: string | null;
			created_at: string;
			started_at: string | null;
			finished_at: string | null;
			error_text: string | null;
			providers: string[];
			completedShards: number;
			shardTotal: number;
		} | null;
		recentImports: Array<{
			id: string;
			status: JobStatus;
			scope_label: string;
			region_key: string | null;
			created_at: string;
		}>;
		reviewCandidates: Array<{
			id: string;
			canonical_name: string | null;
			process_status: string;
			region_key: string | null;
			updated_at: string;
		}>;
		stagingRows: Array<{
			id: string;
			suggested_name: string;
			status: string;
			source: string | null;
			created_at: string | null;
		}>;
		reportRows: Array<{
			id: string;
			content_type: string;
			reason: string | null;
			status: string;
			created_at: string;
		}>;
		sourceErrors: string[];
	};

	const number = new Intl.NumberFormat('en-US');

	function relativeDate(value: string | null) {
		if (!value) return 'Unknown';
		const elapsed = Date.now() - new Date(value).getTime();
		const minutes = Math.max(0, Math.floor(elapsed / 60000));
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function statusClasses(status: string) {
		if (status === 'succeeded' || status === 'reviewed') return 'bg-emerald-50 text-emerald-700';
		if (status === 'failed' || status === 'blocked') return 'bg-red-50 text-red-700';
		if (status === 'running' || status === 'processing') return 'bg-blue-50 text-blue-700';
		return 'bg-zinc-100 text-zinc-700';
	}

	$: importProgress = data.latestImport?.shardTotal
		? Math.round((data.latestImport.completedShards / data.latestImport.shardTotal) * 100)
		: 0;
	$: resolved =
		(data.pipeline.candidateStatusCounts.resolved ?? 0) +
		(data.pipeline.candidateStatusCounts.resolved_existing ?? 0);
</script>

<svelte:head><title>Dashboard | Bobadex Admin</title></svelte:head>

<main class="mx-auto max-w-6xl space-y-8 px-5 py-7 sm:py-9">
	<header class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
		<div>
			<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">Operations</p>
			<h2 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Dashboard</h2>
			<p class="mt-2 max-w-2xl text-sm text-zinc-600">
				Pipeline health, review workload, and incoming admin requests.
			</p>
		</div>
		<div class="flex gap-2">
			<a
				href="/admin/imports"
				class="inline-flex items-center rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
			>Manage imports</a>
			<a
				href="/admin/reviews"
				class="inline-flex items-center rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
			>Open review queue</a>
		</div>
	</header>

	{#if data.sourceErrors.length}
		<div class="flex items-start justify-between gap-4 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			<div>
				<p class="font-medium">Some dashboard sources could not be loaded</p>
				<p class="mt-0.5 text-amber-800">{data.sourceErrors.join(', ')}. Other metrics are still current.</p>
			</div>
		</div>
	{/if}

	<section aria-label="Key metrics" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<a href="/admin/reviews" class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm font-medium text-zinc-600">Review queue</span>
				<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
			</div>
			<p class="mt-3 text-3xl font-semibold text-zinc-950">{number.format(data.metrics.reviewQueue)}</p>
			<p class="mt-1 text-xs text-zinc-500">{data.metrics.needsReview} manual · {data.metrics.exceptions} exceptions</p>
		</a>

		<a href="/admin/imports" class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm font-medium text-zinc-600">Import jobs</span>
				<span class="h-2.5 w-2.5 rounded-full {data.metrics.failedJobs ? 'bg-red-500' : data.metrics.activeJobs ? 'bg-blue-500' : 'bg-emerald-500'}"></span>
			</div>
			<p class="mt-3 text-3xl font-semibold text-zinc-950">{number.format(data.metrics.activeJobs)}</p>
			<p class="mt-1 text-xs {data.metrics.failedJobs ? 'text-red-600' : 'text-zinc-500'}">{data.metrics.failedJobs ? `${data.metrics.failedJobs} failed job needs attention` : 'No failed jobs'}</p>
		</a>

		<a href="/admin/brands" class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm font-medium text-zinc-600">Incoming requests</span>
				<span class="h-2.5 w-2.5 rounded-full bg-sky-500"></span>
			</div>
			<p class="mt-3 text-3xl font-semibold text-zinc-950">{number.format(data.metrics.pendingIntake)}</p>
			<p class="mt-1 text-xs text-zinc-500">{data.metrics.pendingBrands} brands · {data.metrics.pendingReports} reports</p>
		</a>

		<div class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm font-medium text-zinc-600">Brand catalog</span>
				<span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
			</div>
			<p class="mt-3 text-3xl font-semibold text-zinc-950">{number.format(data.metrics.brandCount)}</p>
			<p class="mt-1 text-xs text-zinc-500">+{data.metrics.newBrands} in the last 7 days</p>
		</div>
	</section>

	<section>
		<div class="mb-3 flex items-end justify-between gap-4">
			<div>
				<h3 class="text-lg font-semibold text-zinc-950">Brand enrichment</h3>
				<p class="mt-1 text-sm text-zinc-500">Research queue health, publication coverage, and evidence quality.</p>
			</div>
			<a href="/admin/enrichment" class="text-sm font-medium text-zinc-700 hover:text-zinc-950">Manage enrichment</a>
		</div>
		<div class="grid border-y border-zinc-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
			{#each [
				['Queue depth', data.metrics.enrichmentQueue, 'text-zinc-950'],
				['Failed jobs', data.metrics.failedEnrichmentJobs, data.metrics.failedEnrichmentJobs ? 'text-red-700' : 'text-zinc-950'],
				['Dossiers', data.metrics.dossiersNeedingReview, data.metrics.dossiersNeedingReview ? 'text-amber-700' : 'text-zinc-950'],
				['Published', data.metrics.publishedProfiles, 'text-emerald-700'],
				['Due refreshes', data.metrics.dueRefreshes, 'text-zinc-950'],
				['Open flags', data.metrics.openIntegrityFlags, data.metrics.openIntegrityFlags ? 'text-red-700' : 'text-zinc-950']
			] as metric}
				<a href="/admin/enrichment" class="border-b border-zinc-200 px-4 py-5 last:border-b-0 hover:bg-zinc-50 sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(2n)]:border-r lg:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(3n)]:border-r xl:last:border-r-0">
					<p class="text-xs font-medium text-zinc-500">{metric[0]}</p>
					<p class="mt-2 text-2xl font-semibold {metric[2]}">{number.format(Number(metric[1]))}</p>
				</a>
			{/each}
		</div>
	</section>

	<section>
		<div class="mb-3">
			<h3 class="text-lg font-semibold text-zinc-950">What needs attention</h3>
			<p class="mt-1 text-sm text-zinc-500">Work waiting on an admin decision or a failed pipeline step.</p>
		</div>
		<div class="divide-y divide-zinc-200 border-y border-zinc-200">
			<a href="/admin/reviews?tab=manual" class="flex items-center justify-between gap-4 px-1 py-3 hover:bg-zinc-50"><span class="text-sm text-zinc-700">POI exceptions and manual reviews</span><strong class="tabular-nums text-zinc-950">{data.metrics.reviewQueue}</strong></a>
			<a href="/admin/enrichment" class="flex items-center justify-between gap-4 px-1 py-3 hover:bg-zinc-50"><span class="text-sm text-zinc-700">Brand dossiers</span><strong class="tabular-nums text-zinc-950">{data.metrics.dossiersNeedingReview}</strong></a>
			<a href="/admin/imports" class="flex items-center justify-between gap-4 px-1 py-3 hover:bg-zinc-50"><span class="text-sm text-zinc-700">Failed pipeline jobs</span><strong class="tabular-nums {data.metrics.failedJobs + data.metrics.failedEnrichmentJobs ? 'text-red-700' : 'text-zinc-950'}">{data.metrics.failedJobs + data.metrics.failedEnrichmentJobs}</strong></a>
			<a href="/admin/brands" class="flex items-center justify-between gap-4 px-1 py-3 hover:bg-zinc-50"><span class="text-sm text-zinc-700">Brand submissions and reports</span><strong class="tabular-nums text-zinc-950">{data.metrics.pendingIntake}</strong></a>
			<a href="/admin/imports#automation" class="flex items-center justify-between gap-4 px-1 py-3 hover:bg-zinc-50"><span class="text-sm text-zinc-700">Missing worker schedules</span>{#if data.metrics.missingCrons == null}<span class="text-xs font-medium text-zinc-500">Status unavailable</span>{:else}<strong class="tabular-nums {data.metrics.missingCrons ? 'text-amber-700' : 'text-zinc-950'}">{data.metrics.missingCrons}</strong>{/if}</a>
		</div>
	</section>

	<section>
		<div class="mb-4 flex items-end justify-between">
			<div>
				<h3 class="text-lg font-semibold text-zinc-950">Pipeline overview</h3>
				<p class="mt-1 text-sm text-zinc-500">Where the current candidate set stands.</p>
			</div>
			<span class="text-sm tabular-nums text-zinc-500">{number.format(data.metrics.totalCandidates)} total candidates</span>
		</div>

		<div class="grid border-y border-zinc-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
			<div class="border-b border-zinc-200 py-5 lg:border-b-0 lg:pr-6">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-zinc-900">1. Ingest</p>
					<span class="rounded px-2 py-1 text-xs font-medium {statusClasses(data.latestImport?.status ?? 'idle')}">{data.latestImport?.status ?? 'No run'}</span>
				</div>
					<p class="mt-3 text-2xl font-semibold text-zinc-950">{data.latestImport?.scope_label ?? 'No region'}</p>
				{#if data.latestImport}
					<div class="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
						<div class="h-full bg-emerald-500" style={`width: ${Math.min(importProgress, 100)}%`}></div>
					</div>
					<p class="mt-2 text-xs text-zinc-500">{data.latestImport.completedShards} of {data.latestImport.shardTotal} shards · started {relativeDate(data.latestImport.started_at ?? data.latestImport.created_at)}</p>
				{:else}
					<p class="mt-2 text-sm text-zinc-500">Start a region import to populate the pipeline.</p>
				{/if}
			</div>

			<div class="border-b border-zinc-200 py-5 lg:border-b-0 lg:px-6">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-zinc-900">2. Candidate resolution</p>
					<span class="text-xs text-zinc-500">current dataset</span>
				</div>
				<p class="mt-3 text-2xl font-semibold text-zinc-950">{number.format(resolved)} resolved</p>
				<div class="mt-4 grid grid-cols-3 gap-2 text-xs">
					<div><p class="font-semibold text-zinc-900">{data.pipeline.candidateStatusCounts.ready_for_enrichment ?? 0}</p><p class="text-zinc-500">ready</p></div>
					<div><p class="font-semibold text-zinc-900">{data.metrics.reviewQueue}</p><p class="text-zinc-500">exceptions</p></div>
					<div><p class="font-semibold text-red-700">{data.pipeline.candidateStatusCounts.known_negative ?? 0}</p><p class="text-zinc-500">negatives</p></div>
				</div>
			</div>

			<div class="py-5 lg:pl-6">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-zinc-900">3. Provider shards</p>
					<a href="/admin/imports" class="text-xs font-medium text-zinc-600 hover:text-zinc-950">Manage</a>
				</div>
				<p class="mt-3 text-2xl font-semibold text-zinc-950">{number.format(data.pipeline.shardCounts.succeeded ?? 0)} succeeded</p>
				<div class="mt-4 grid grid-cols-3 gap-2 text-xs">
					<div><p class="font-semibold text-zinc-900">{data.pipeline.shardCounts.queued ?? 0}</p><p class="text-zinc-500">queued</p></div>
					<div><p class="font-semibold text-blue-700">{data.pipeline.shardCounts.processing ?? 0}</p><p class="text-zinc-500">processing</p></div>
					<div><p class="font-semibold text-red-700">{data.pipeline.shardCounts.failed ?? 0}</p><p class="text-zinc-500">failed</p></div>
				</div>
			</div>
		</div>
	</section>

	<section class="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
		<div>
			<div class="mb-3 flex items-center justify-between">
				<div>
					<h3 class="text-lg font-semibold text-zinc-950">Priority review</h3>
					<p class="mt-1 text-sm text-zinc-500">Newest candidates waiting for a decision.</p>
				</div>
				<a href="/admin/reviews" class="text-sm font-medium text-zinc-700 hover:text-zinc-950">View all</a>
			</div>
			<div class="overflow-hidden rounded-lg border border-zinc-200 bg-white">
				{#each data.reviewCandidates as candidate}
					<a href={`/admin/reviews?tab=manual&q=${encodeURIComponent(candidate.canonical_name ?? '')}`} class="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3 last:border-b-0 hover:bg-zinc-50">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-zinc-900">{candidate.canonical_name ?? 'Unnamed candidate'}</p>
							<p class="mt-0.5 text-xs text-zinc-500">{candidate.region_key ?? 'Unknown region'} · {relativeDate(candidate.updated_at)}</p>
						</div>
						<span class="rounded px-2 py-1 text-xs font-medium {statusClasses(candidate.process_status)}">{candidate.process_status.replaceAll('_', ' ')}</span>
					</a>
				{/each}
				{#if data.reviewCandidates.length === 0}
					<div class="px-4 py-10 text-center text-sm text-zinc-500">The candidate queue is clear.</div>
				{/if}
			</div>
		</div>

		<div>
			<div class="mb-3 flex items-center justify-between">
				<div>
					<h3 class="text-lg font-semibold text-zinc-950">Recent imports</h3>
					<p class="mt-1 text-sm text-zinc-500">Latest region-level runs.</p>
				</div>
				<a href="/admin/imports" class="text-sm font-medium text-zinc-700 hover:text-zinc-950">Details</a>
			</div>
			<div class="overflow-hidden rounded-lg border border-zinc-200 bg-white">
				{#each data.recentImports as job}
					<div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0">
						<div>
							<p class="text-sm font-medium text-zinc-900">{job.scope_label}</p>
							<p class="mt-0.5 text-xs text-zinc-500">{relativeDate(job.created_at)}</p>
						</div>
						<span class="rounded px-2 py-1 text-xs font-medium {statusClasses(job.status)}">{job.status.replace('_', ' ')}</span>
					</div>
				{/each}
				{#if data.recentImports.length === 0}
					<div class="px-4 py-10 text-center text-sm text-zinc-500">No region imports yet.</div>
				{/if}
			</div>
		</div>
	</section>

	<section>
		<div class="mb-3 flex items-center justify-between">
			<div>
				<h3 class="text-lg font-semibold text-zinc-950">Incoming admin work</h3>
				<p class="mt-1 text-sm text-zinc-500">Requests originating outside the POI pipeline.</p>
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<a href="/admin/brands" class="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-zinc-900">Brand submissions</p>
					<span class="text-2xl font-semibold text-zinc-950">{data.metrics.pendingBrands}</span>
				</div>
				<p class="mt-3 truncate text-sm text-zinc-500">{data.stagingRows[0]?.suggested_name ?? 'No pending submissions'}</p>
			</a>
			<a href="/admin/reports" class="rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-300">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-zinc-900">User reports</p>
					<span class="text-2xl font-semibold text-zinc-950">{data.metrics.pendingReports}</span>
				</div>
				<p class="mt-3 truncate text-sm text-zinc-500">{data.reportRows[0] ? `${data.reportRows[0].content_type}: ${data.reportRows[0].reason ?? 'No reason supplied'}` : 'No pending reports'}</p>
			</a>
		</div>
	</section>
</main>
