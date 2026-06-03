<!-- src/routes/admin/+page.svelte -->
<script lang="ts">
  type Counts = {
    pending_brands: number;
    pending_icons: number;
    pending_reports: number;
    running_osm_jobs: number;
    queued_osm_jobs: number;
    pending_candidates: number;
  };

  export let data: {
    counts: Counts;
    recent: {
      jobs: Array<{ id: string; status: 'queued'|'running'|'succeeded'|'failed'; source: string | null; created_at: string; note?: string | null }>;
      brands: Array<{ id: string; suggested_name: string; created_at: string }>;
      reports: Array<{ id: string; created_at: string; category?: string | null; status: string }>;
    };
  };
</script>

<main class="mx-auto max-w-6xl px-4 py-6 space-y-8">
  <!-- KPI cards -->
  <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
    <a href="/admin/brands"  class="rounded-xl border p-4 hover:bg-gray-50">
      <div class="text-xs text-gray-500">Pending brands</div>
      <div class="mt-1 text-3xl font-semibold">{data.counts.pending_brands}</div>
    </a>
    <a href="/admin/brands" class="rounded-xl border p-4 hover:bg-gray-50">
      <div class="text-xs text-gray-500">Brand icons pending</div>
      <div class="mt-1 text-3xl font-semibold">{data.counts.pending_icons}</div>
    </a>
    <a href="/admin/reports" class="rounded-xl border p-4 hover:bg-gray-50">
      <div class="text-xs text-gray-500">Pending reports</div>
      <div class="mt-1 text-3xl font-semibold">{data.counts.pending_reports}</div>
    </a>
    <a href="/admin/imports" class="rounded-xl border p-4 hover:bg-gray-50">
      <div class="text-xs text-gray-500">OSM jobs (queued)</div>
      <div class="mt-1 text-3xl font-semibold">{data.counts.queued_osm_jobs}</div>
    </a>
    <a href="/admin/imports" class="rounded-xl border p-4 hover:bg-gray-50">
      <div class="text-xs text-gray-500">OSM candidates pending</div>
      <div class="mt-1 text-3xl font-semibold">{data.counts.pending_candidates}</div>
    </a>
  </section>

  <!-- Recent -->
  <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div class="rounded-xl border overflow-hidden">
      <div class="p-4 flex items-center justify-between">
        <h2 class="font-semibold">Recent OSM Jobs</h2>
        <a href="/admin/imports" class="text-sm text-gray-600 hover:underline">View all</a>
      </div>
      <table class="w-full text-sm">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-2 text-left">Created</th>
            <th class="px-4 py-2 text-left">Source</th>
            <th class="px-4 py-2 text-left">Status</th>
            <th class="px-4 py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each data.recent.jobs as j}
            <tr>
              <td class="px-4 py-2">{new Date(j.created_at).toLocaleString()}</td>
              <td class="px-4 py-2">{j.source ?? '—'}</td>
              <td class="px-4 py-2">
                {#if j.status === 'running'}
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-100 text-blue-800">running</span>
                {:else if j.status === 'succeeded'}
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800">succeeded</span>
                {:else if j.status === 'failed'}
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-red-100 text-red-800">failed</span>
                {:else}
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800">{j.status}</span>
                {/if}
              </td>
              <td class="px-4 py-2">{j.note ?? '—'}</td>
            </tr>
          {/each}
          {#if data.recent.jobs.length === 0}
            <tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">No jobs yet</td></tr>
          {/if}
        </tbody>
      </table>
    </div>

    <div class="rounded-xl border">
      <div class="p-4">
        <h2 class="font-semibold">What needs attention</h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
        <div class="p-4">
          <div class="mb-2 text-sm font-medium">Pending Brands</div>
          <ul class="space-y-2">
            {#each data.recent.brands as b}
              <li class="text-sm flex items-center justify-between">
                <span class="truncate">{b.suggested_name}</span>
                <a class="ml-2 text-xs text-gray-600 hover:underline" href="/admin/brands">open</a>
              </li>
            {/each}
            {#if data.recent.brands.length === 0}
              <li class="text-sm text-gray-500">Nothing pending</li>
            {/if}
          </ul>
        </div>
        <div class="p-4">
          <div class="mb-2 text-sm font-medium">Pending Reports</div>
          <ul class="space-y-2">
            {#each data.recent.reports as r}
              <li class="text-sm flex items-center justify-between">
                <span class="truncate">{r.category ?? 'report'}</span>
                <a class="ml-2 text-xs text-gray-600 hover:underline" href="/admin/reports">open</a>
              </li>
            {/each}
            {#if data.recent.reports.length === 0}
              <li class="text-sm text-gray-500">Nothing pending</li>
            {/if}
          </ul>
        </div>
      </div>
    </div>
  </section>
</main>
