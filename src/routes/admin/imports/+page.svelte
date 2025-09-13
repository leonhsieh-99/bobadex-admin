<!-- src/routes/admin/imports/+page.svelte -->
<script lang="ts">
  export let data: {
    jobs: Array<{
      id: string;
      source: string | null;
      status: 'queued'|'running'|'succeeded'|'failed';
      created_at: string;
      stats: Record<string, number> | null;
      note: string | null;
      error_text: string | null;
    }>;
    candidates: Array<{
      id: string;
      name: string;
      lat: number | null;
      lon: number | null;
      tags: Record<string, string> | null;
      match_brand_slug: string | null;
      match_score: number | null;
      blocked_brand: boolean;
      blocked_reason: string | null;
      staging_id: string | null;
      created_at: string;
    }>;
    candStatus: 'pending'|'approved'|'rejected'|'merged';
    q: string;
  };

  // Build a friendly location label from OSM tags, or fall back to coords
  function locLabel(c: { lat:number|null; lon:number|null; tags:Record<string,any>|null }) {
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
  function osmLink(c: { lat:number|null; lon:number|null }) {
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return null;
    return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}`;
  }

  const defaultParams = JSON.stringify({
    bbox: [32.4, -124.5, 42.1, -114.1],
    timeout: 180,
    filters: [
      { k: 'cuisine', op: '~', v: '^(bubble_tea|milk_tea)$' },
      { k: 'amenity', op: '=', v: 'cafe', nameRegex: '(\\btea\\b|\\bcha\\b|\\bbubble\\b|\\bboba\\b)', i: true }
    ],
    out: 'center'
  }, null, 2);
</script>

<main class="mx-auto max-w-6xl px-4 py-6 space-y-8">
  <h1 class="text-2xl font-bold">OSM Imports</h1>

  <!-- Queue form -->
  <section class="rounded-xl border p-4 space-y-3">
    <h2 class="font-semibold">Start OSM Import (CA)</h2>

    <form method="POST" action="/admin/imports/_api/queue" class="space-y-2">
      <label for="params" class="block text-xs text-gray-600">Overpass params (JSON)</label>
      <textarea
        id="params"
        name="params"
        class="w-full h-40 border rounded-lg px-3 py-2 font-mono text-sm"
        spellcheck="false"
      >{defaultParams}</textarea>

      <div class="flex items-center gap-2">
        <input name="note" class="border rounded px-3 py-2 text-sm flex-1" placeholder="Note (optional)" />
        <button type="submit" class="px-4 py-2 bg-gray-900 text-white rounded-lg">Queue</button>
      </div>
    </form>
  </section>

  <!-- Jobs -->
  <section class="rounded-xl border overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2 text-left">Created</th>
          <th class="px-4 py-2 text-left">Status</th>
          <th class="px-4 py-2 text-left">Note</th>
          <th class="px-4 py-2 text-left">Stats</th>
          <th class="px-4 py-2 text-left">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y">
        {#each data.jobs as r}
          <tr>
            <td class="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
            <td class="px-4 py-2">
              {#if r.status === 'running'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-100 text-blue-800">running</span>
              {:else if r.status === 'succeeded'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800">succeeded</span>
              {:else if r.status === 'failed'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-red-100 text-red-800">failed</span>
              {:else}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800">{r.status}</span>
              {/if}
            </td>
            <td class="px-4 py-2">{r.note ?? '—'}</td>
            <td class="px-4 py-2">
              {#if r.stats}
                <div class="flex flex-wrap gap-1">
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800"
                    title="Total elements seen">seen {r.stats.candidates ?? 0}</span>
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800"
                    title="New rows inserted">+{r.stats.created ?? 0}</span>
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-100 text-blue-800"
                    title="Existing rows refreshed">upd {r.stats.updated ?? 0}</span>
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-amber-100 text-amber-800"
                    title="Duplicates / rejected">skip {r.stats.skipped ?? 0}</span>
                  <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-red-100 text-red-800"
                    title="Errors">err {r.stats.errors ?? 0}</span>
                </div>
              {:else}
                —
              {/if}

              {#if r.status === 'failed' && r.error_text}
                <div class="mt-1 text-xs text-red-600 line-clamp-2">{r.error_text}</div>
              {/if}
            </td>
            <td class="px-4 py-2">
              <div class="flex items-center gap-2">
                <form method="POST" action="/admin/imports/process" class="m-0">
                  <input type="hidden" name="job_id" value={r.id} />
                  <button
                    class="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white disabled:opacity-50"
                    disabled={r.status === 'running'}
                    title={r.status === 'running' ? 'Already running' : 'Process this job'}
                  >
                    {r.status === 'running' ? 'Processing…' : 'Process'}
                  </button>
                </form>

                <form method="POST" action="/admin/imports/_api/dequeue" class="m-0">
                  <input type="hidden" name="job_id" value={r.id} />
                  <button class="px-2 py-1 text-xs rounded bg-red-600 text-white">Delete</button>
                </form>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <!-- Candidates -->
  <section class="rounded-xl border bg-white">
    <!-- Header / Controls (outside the list) -->
    <div class="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-3">
        <h2 class="font-semibold text-lg">Candidates</h2>
        <span class="text-xs rounded-full bg-gray-100 px-2 py-1 text-gray-700">{data.candidates.length}</span>
      </div>

      <form method="GET" class="w-full md:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
        <!-- Segmented status pills -->
        <div class="inline-flex rounded-full border bg-gray-50 p-1 text-xs">
          <label class="cursor-pointer">
            <input type="radio" class="peer sr-only" name="status" value="pending"  checked={data.candStatus==='pending'} />
            <span class="px-3 py-1 rounded-full peer-checked:bg-white peer-checked:shadow peer-checked:border peer-checked:border-gray-200">Pending</span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" class="peer sr-only" name="status" value="approved" checked={data.candStatus==='approved'} />
            <span class="px-3 py-1 rounded-full peer-checked:bg-white peer-checked:shadow peer-checked:border peer-checked:border-gray-200">Approved</span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" class="peer sr-only" name="status" value="rejected" checked={data.candStatus==='rejected'} />
            <span class="px-3 py-1 rounded-full peer-checked:bg-white peer-checked:shadow peer-checked:border peer-checked:border-gray-200">Rejected</span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" class="peer sr-only" name="status" value="merged"   checked={data.candStatus==='merged'} />
            <span class="px-3 py-1 rounded-full peer-checked:bg-white peer-checked:shadow peer-checked:border peer-checked:border-gray-200">Merged</span>
          </label>
        </div>

        <!-- Search -->
        <div class="relative flex-1 sm:w-72">
          <svg class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387-1.414 1.414-4.387-4.387zM14 8a6 6 0 11-12 0 6 6 0 0112 0z" clip-rule="evenodd"/>
          </svg>
          <input
            name="q"
            class="w-full rounded-lg border px-9 py-2 text-sm placeholder:text-gray-400"
            placeholder="Search name…"
            value={data.q}
          />
        </div>

        <button class="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm">Apply</button>
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
                    <h3 class="text-sm font-medium truncate">{c.name}</h3>

                    {#if c.match_brand_slug}
                      <span class="text-[11px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">
                        match {c.match_brand_slug} ({(c.match_score ?? 0).toFixed(2)})
                      </span>
                    {:else}
                      <span class="text-[11px] rounded-full bg-amber-100 text-amber-700 px-2 py-0.5">new brand?</span>
                    {/if}

                    {#if c.blocked_brand}
                      <span class="text-[11px] rounded-full bg-red-100 text-red-700 px-2 py-0.5">blocked</span>
                    {/if}

                    {#if c.staging_id}
                      <span class="text-[11px] rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5">pending staging</span>
                    {/if}
                  </div>

                  <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                    <span class="truncate">{locLabel(c)}</span>
                    {#if osmLink(c)}
                      <a class="underline text-blue-600 hover:text-blue-800" target="_blank" rel="noreferrer" href={osmLink(c)}>map</a>
                    {/if}
                  </div>

                  {#if c.tags && Object.keys(c.tags).length}
                    <div class="mt-2 grid gap-1.5 text-[11px] text-gray-700 sm:grid-cols-2 lg:grid-cols-3">
                      {#each Object.entries(c.tags).slice(0,6) as [k,v]}
                        <div class="truncate">
                          <span class="font-medium text-gray-500">{k}:</span> {String(v)}
                        </div>
                      {/each}
                      {#if Object.keys(c.tags).length > 6}
                        <div class="text-gray-500">… and {Object.keys(c.tags).length - 6} more</div>
                      {/if}
                    </div>
                  {/if}
                </div>

                <div class="text-[11px] text-gray-500 whitespace-nowrap">
                  {new Date(c.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            <!-- RIGHT: actions -->
            <div class="mt-3 md:mt-0 md:w-[560px] md:shrink-0">
              <div class="space-y-2">
                <!-- APPROVE -->
                <form method="POST" action="?/approve" class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center overflow-x-auto">
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
                  <button class="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs">Approve</button>
                </form>

                <!-- MERGE -->
                <form method="POST" action="?/merge" class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center overflow-x-auto">
                  <input type="hidden" name="candidate_id" value={c.id} />
                  <input
                    name="brand_slug"
                    required
                    class="w-full rounded-lg border px-3 py-2 text-xs"
                    placeholder="brand_slug"
                    value={c.match_brand_slug ?? ''}
                  />
                  <input
                    name="note"
                    class="w-full rounded-lg border px-3 py-2 text-xs"
                    placeholder="note (optional)"
                  />
                  <button class="h-9 px-3 rounded-lg bg-amber-600 text-white text-xs">Merge</button>
                </form>

                <!-- REJECT -->
                <form method="POST" action="?/reject" class="grid gap-2 sm:grid-cols-[1fr_auto] items-center overflow-x-auto">
                  <input type="hidden" name="candidate_id" value={c.id} />
                  <input
                    name="note"
                    class="w-full rounded-lg border px-3 py-2 text-xs"
                    placeholder="reason / note (optional)"
                  />
                  <button class="h-9 px-3 rounded-lg bg-gray-200 text-gray-900 text-xs">Reject</button>
                </form>
              </div>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>
</main>
