<script lang="ts">
    export let data: {
      jobs: Array<{
        id: string;
        source?: string | null;        // or source_params if you changed schema
        status: 'queued'|'running'|'succeeded'|'failed';
        created_at: string;
        stats?: any;
        note?: string | null;
      }>;
      candidates: Array<{
        id: string;
        name: string;
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
  
    // A starter JSON users can edit before submitting the "queue" form.
    const defaultParams = JSON.stringify({
      bbox: [32.4, -124.5, 42.1, -114.1],
      timeout: 180,
      filters: [
        { k: "cuisine", op: "~", v: "^(bubble_tea|milk_tea)$" },
        { k: "amenity", op: "=", v: "cafe", nameRegex: "(\\btea\\b|\\bcha\\b|\\bbubble\\b|\\bboba\\b)", i: true }
      ],
      out: "center"
    }, null, 2);
  </script>
  
  <main class="mx-auto max-w-6xl px-4 py-6 space-y-8">
    <h1 class="text-2xl font-bold">OSM Imports</h1>
  
    <!-- Start OSM Import -->
    <section class="rounded-xl border p-4 space-y-3">
      <h2 class="font-semibold">Start OSM Import (CA)</h2>
      <form method="POST" action="?/queue" class="space-y-2">
        <label for="params" class="block text-xs text-gray-600">Overpass params (JSON)</label>
        <textarea
          name="params"
          class="w-full h-40 border rounded-lg px-3 py-2 font-mono text-sm"
          spellcheck="false"
        >{defaultParams}</textarea>
        <div class="flex items-center gap-2">
          <input name="note" class="border rounded px-3 py-2 text-sm flex-1" placeholder="Note (optional)" />
          <button class="px-4 py-2 bg-gray-900 text-white rounded-lg">Queue</button>
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
              <td class="px-4 py-2">{r.stats ? JSON.stringify(r.stats) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  
    <!-- Candidates -->
    <section class="rounded-xl border">
      <div class="p-4 flex items-center justify-between gap-2">
        <h2 class="font-semibold">Candidates</h2>
  
        <!-- GET filter form: server load reads `status` and `q` from the URL -->
        <form method="GET" class="flex items-center gap-2">
          <select name="status" class="border rounded px-2 py-1 text-sm" value={data.candStatus}>
            <option value="pending" selected={data.candStatus==='pending'}>Pending</option>
            <option value="approved" selected={data.candStatus==='approved'}>Approved</option>
            <option value="rejected" selected={data.candStatus==='rejected'}>Rejected</option>
            <option value="merged" selected={data.candStatus==='merged'}>Merged</option>
          </select>
          <input
            name="q"
            class="border rounded px-2 py-1 text-sm"
            placeholder="Search name…"
            value={data.q}
          />
          <button class="px-3 py-1 text-sm rounded bg-gray-900 text-white">Apply</button>
        </form>
      </div>
  
      <div class="divide-y">
        {#each data.candidates as c}
          <div class="p-3 flex items-start justify-between">
            <div class="space-y-1">
              <div class="font-medium">{c.name}</div>
              <div class="flex flex-wrap gap-2">
                {#if c.match_brand_slug}
                  <span class="text-xs rounded bg-emerald-100 text-emerald-800 px-2 py-0.5">
                    match {c.match_brand_slug} ({(c.match_score ?? 0).toFixed(2)})
                  </span>
                {:else}
                  <span class="text-xs rounded bg-amber-100 text-amber-800 px-2 py-0.5">new brand?</span>
                {/if}
                {#if c.blocked_brand}
                  <span class="text-xs rounded bg-red-100 text-red-800 px-2 py-0.5">
                    blocked{c.blocked_reason ? `: ${c.blocked_reason}` : ''}
                  </span>
                {/if}
                {#if c.staging_id}
                  <span class="text-xs rounded bg-indigo-100 text-indigo-800 px-2 py-0.5">pending staging</span>
                {/if}
              </div>
              <div class="text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</div>
            </div>
  
            <div class="flex items-center gap-2">
              {#if c.match_brand_slug}
                <!-- Attach alias -->
                <form method="POST" action="?/attach-alias" class="flex gap-2">
                  <input type="hidden" name="candidate_id" value={c.id} />
                  <input type="hidden" name="brand_slug" value={c.match_brand_slug} />
                  <input type="hidden" name="alias" value={c.name} />
                  <button class="px-3 py-1 text-xs rounded bg-emerald-600 text-white">Attach alias</button>
                </form>
              {:else}
                <!-- Create brand -->
                <form method="POST" action="?/create-brand" class="flex gap-2">
                  <input type="hidden" name="candidate_id" value={c.id} />
                  <input type="hidden" name="name" value={c.name} />
                  <button class="px-3 py-1 text-xs rounded bg-blue-600 text-white">Create brand</button>
                </form>
              {/if}
  
              <!-- Reject -->
              <form method="POST" action="?/reject">
                <input type="hidden" name="candidate_id" value={c.id} />
                <input type="hidden" name="note" value="not relevant" />
                <button class="px-3 py-1 text-xs rounded bg-gray-200">Reject</button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    </section>
  </main>
  