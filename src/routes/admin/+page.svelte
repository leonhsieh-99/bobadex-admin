<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabaseClient';

  type Job = {
    id: string; source: string | null;
    status: 'queued'|'running'|'succeeded'|'failed';
    created_at: string; stats?: any;
  };
  type Candidate = {
    id: string; name: string;
    match_brand_slug: string | null; match_score: number | null;
    blocked_brand: boolean; blocked_reason: string | null;
    staging_id: string | null; tags: Record<string, any> | null;
    created_at: string;
  };

  let jobs: Job[] = [];
  let candidates: Candidate[] = [];
  let candStatus: 'pending'|'approved'|'rejected'|'merged' = 'pending';
  let candSearch = '';
  let overpassParams = '{"bbox":[32.4,-124.5,42.1,-114.1]}';

  function safeJson(s: string) { try { return JSON.parse(s); } catch { return null; } }

  async function queueJob() {
    const params = safeJson(overpassParams) ?? {};
    const { error } = await supabase.from('osm_import_jobs')
      .insert({ source: 'overpass', params }).select('id').single();
    if (error) return alert(error.message);
    await refreshJobs();
  }

  async function refreshJobs() {
    const { data, error } = await supabase.from('osm_import_jobs')
      .select('*').order('created_at', { ascending: false }).limit(10);
    if (!error && data) jobs = data as Job[];
  }

  async function refreshCandidates() {
    let q = supabase.from('osm_candidates')
      .select('id,name,match_brand_slug,match_score,blocked_brand,blocked_reason,staging_id,tags,created_at')
      .eq('status', candStatus)
      .order('created_at', { ascending: false })
      .limit(100);
    if (candSearch) q = q.ilike('name', `%${candSearch}%`);
    const { data, error } = await q;
    if (!error && data) candidates = data as Candidate[];
  }

  async function attachAlias(candidateId: string, brandSlug: string, aliasText: string) {
    const { error: e1 } = await supabase.rpc('add_brand_alias', { p_brand_slug: brandSlug, p_name: aliasText });
    if (e1) return alert('Alias failed: ' + e1.message);
    const { error: e2 } = await supabase.rpc('osm_resolve_candidate', {
      p_id: candidateId, p_status: 'merged', p_note: 'alias attached', p_brand_slug: brandSlug
    });
    if (e2) return alert('Resolve failed: ' + e2.message);
    await refreshCandidates();
  }

  async function createBrandFromCandidate(c: Candidate) {
    const { data: stage, error: sErr } = await supabase
      .from('brand_staging').insert({ suggested_name: c.name, source: 'osm' })
      .select('id').single();
    if (sErr) return alert('Staging failed: ' + sErr.message);

    const { data: rows, error: aErr } = await supabase.rpc('approve_brand', {
      p_staging_id: stage.id, p_force_slug: null, p_generate_icon: true
    });
    if (aErr) return alert('Approve failed: ' + aErr.message);
    const created = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!created) return alert('Approve returned no result');

    await attachAlias(c.id, created.brand_slug, c.name);
  }

  async function rejectCandidate(id: string, note = 'not relevant') {
    const { error } = await supabase.rpc('osm_resolve_candidate', { p_id: id, p_status: 'rejected', p_note: note });
    if (error) return alert(error.message);
    await refreshCandidates();
  }

  onMount(async () => {
    await refreshJobs();
    await refreshCandidates();
  });
</script>

<main class="mx-auto max-w-6xl px-4 py-6 space-y-6">
  <!-- Start OSM Import -->
  <section class="rounded-xl border p-4">
    <h2 class="font-semibold mb-2">Start OSM Import (CA)</h2>
    <form class="flex gap-2" on:submit|preventDefault={queueJob}>
      <input
        class="flex-1 border rounded-lg px-3 py-2 text-sm"
        bind:value={overpassParams}
        placeholder={'Overpass params JSON, e.g. {\"bbox\":[32.4,-124.5,42.1,-114.1]}'}
      />
      <button class="px-4 py-2 bg-gray-900 text-white rounded-lg">Queue</button>
    </form>
  </section>

  <!-- Jobs -->
  <section class="rounded-xl border overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2 text-left">Created</th>
          <th class="px-4 py-2 text-left">Source</th>
          <th class="px-4 py-2 text-left">Status</th>
          <th class="px-4 py-2 text-left">Stats</th>
        </tr>
      </thead>
      <tbody class="divide-y">
        {#each jobs as r}
          <tr>
            <td class="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
            <td class="px-4 py-2">{r.source ?? '-'}</td>
            <td class="px-4 py-2">
              {#if r.status === 'running'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">running</span>
              {:else if r.status === 'succeeded'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">succeeded</span>
              {:else if r.status === 'failed'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">failed</span>
              {:else}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">{r.status}</span>
              {/if}
            </td>
            <td class="px-4 py-2">{r.stats ? JSON.stringify(r.stats) : '-'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <!-- Candidates -->
  <section class="rounded-xl border">
    <div class="p-4 flex items-center justify-between gap-2">
      <h2 class="font-semibold">Candidates</h2>
      <div class="flex gap-2">
        <select bind:value={candStatus} class="border rounded px-2 py-1 text-sm" on:change={refreshCandidates}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="merged">Merged</option>
        </select>
        <input
          class="border rounded px-2 py-1 text-sm"
          placeholder="Search name…"
          bind:value={candSearch}
          on:input={refreshCandidates}
        />
      </div>
    </div>

    <div class="divide-y">
      {#each candidates as c}
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
              <button
                class="px-3 py-1 text-xs rounded bg-emerald-600 text-white"
                on:click={() => attachAlias(c.id, c.match_brand_slug!, c.name)}
              >Attach alias</button>
            {:else}
              <button
                class="px-3 py-1 text-xs rounded bg-blue-600 text-white"
                on:click={() => createBrandFromCandidate(c)}
              >Create brand</button>
            {/if}
            <button
              class="px-3 py-1 text-xs rounded bg-gray-200"
              on:click={() => rejectCandidate(c.id, 'not relevant')}
            >Reject</button>
          </div>
        </div>
      {/each}
    </div>
  </section>
</main>
