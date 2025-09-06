<!-- src/routes/admin/reports/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';

  export let data: {
    reports: Array<{
      id: string;
      reported_by: string;
      content_type: 'image' | 'user';
      content_id: string;
      reason: string;
      message: string | null;
      status: 'pending' | 'accepted' | 'rejected' | 'dismissed';
      created_at: string;
      resolved_by?: string | null;
      resolved_at?: string | null;
      resolution_note?: string | null;
    }>;
  };

  type ImageSubject = {
    type: 'image';
    id: string;
    user_id: string | null;
    bucket: string;
    path: string;
    uploader?: { id: string; name?: string | null; email?: string | null; avatar_url?: string | null };
  };

  type UserSubject = {
    type: 'user';
    email: string | null;
    id: string;
    name: string;
    avatar_url?: string | null;
  };

  type Subject = ImageSubject | UserSubject;

  let subjects: Map<string, Subject> = new Map();   // report_id -> subject
  let loadingIds: Set<string> = new Set();          // report_ids currently fetching

  let expanded: Set<string> = new Set();

  const SB_HOST = 'https://vsiuyynrooqzcstzyeir.supabase.co';

  function renderImage(bucket: string, path: string, w: number, h: number, resize = 'cover', quality = 80) {
    return `${SB_HOST}/storage/v1/render/image/public/${bucket}/${path}?width=${w}&height=${h}&resize=${resize}&quality=${quality}`;
  }

  async function preloadAll() {
    data.reports.forEach((r) => loadOne(r));
  }

  function toggleDetails(r: { id: string; content_type: string; content_id: string }) {
    if (expanded.has(r.id)) {
      expanded.delete(r.id);
      // reassign Set to trigger reactivity
      expanded = new Set(expanded);
    } else {
      expanded.add(r.id);
      expanded = new Set(expanded);
      // lazy fetch if we don't have it yet and not currently loading
      if (!subjects.has(r.id) && !loadingIds.has(r.id)) loadOne(r);
    }
  }

  function avatarSrc(avatar_url?: string | null, size = 64) {
    if (!avatar_url) return null;
    if (/^https?:\/\//i.test(avatar_url)) return avatar_url; // already absolute
    // If your avatars live in another bucket, change 'media-uploads' accordingly
    return renderImage('media-uploads', avatar_url, size, size, 'cover', 80);
  }

  async function loadOne(r: { id: string; content_type: string; content_id: string }) {
    if (subjects.has(r.id) || loadingIds.has(r.id)) return;

    // mark loading (reassign Set to trigger reactivity)
    loadingIds.add(r.id);
    loadingIds = new Set(loadingIds);

    try {
      const res = await fetch(
        `/admin/reports/subject?p_content_type=${encodeURIComponent(r.content_type)}&p_content_id=${encodeURIComponent(
          r.content_id
        )}`
      );
      if (res.ok) {
        const j = (await res.json()) as Subject | null;
        if (j) {
          subjects.set(r.id, j);
          subjects = new Map(subjects); // <-- reassign to trigger Svelte reactivity
        }
      }
    } finally {
      loadingIds.delete(r.id);
      loadingIds = new Set(loadingIds); // <-- reassign again
    }
  }

  onMount(preloadAll);
</script>

<main class="mx-auto max-w-6xl px-4 py-6 space-y-6">
  <h1 class="text-2xl font-bold">Reports</h1>

  <section class="rounded-xl border overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2 text-left">When</th>
          <th class="px-4 py-2 text-left">Type</th>
          <th class="px-4 py-2 text-left">Reason</th>
          <th class="px-4 py-2 text-left">Message</th>
          <th class="px-4 py-2 text-left">Status</th>
          <th class="px-4 py-2"></th>
          <th class="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody class="divide-y">
        {#each data.reports as r}
          <!-- Main row -->
          <tr>
            <td class="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
            <td class="px-4 py-2">
              {r.content_type}
              <div class="text-xs text-gray-500 break-all">{r.content_id}</div>
            </td>
            <td class="px-4 py-2">{r.reason}</td>
            <td class="px-4 py-2">{r.message ?? '—'}</td>
            <td class="px-4 py-2">
              {#if r.status === 'pending'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-amber-100 text-amber-800">pending</span>
              {:else if r.status === 'accepted'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800">accepted</span>
              {:else if r.status === 'dismissed'}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-800">dismissed</span>
              {:else}
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-red-100 text-red-800">rejected</span>
              {/if}
            </td>
            <td class="px-4 py-2">
              {#if r.status === 'pending'}
                <form method="POST" action="?/resolve" class="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <label class="sr-only" for={"status-"+r.id}>Status</label>
                  <select id={"status-"+r.id} name="status" class="border rounded px-2 py-1 text-xs">
                    <option value="accepted">Accept</option>
                    <option value="rejected">Reject</option>
                    <option value="dismissed">Dismiss</option>
                  </select>
                  <label class="sr-only" for={"note-"+r.id}>Note</label>
                  <input id={"note-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                  <button class="px-3 py-1 text-xs rounded bg-gray-900 text-white">Submit</button>
                </form>
              {:else}
                <div class="text-xs text-gray-500">{r.resolution_note}</div>
              {/if}
            </td>
            <td class="px-4 py-2 text-right">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                aria-expanded={expanded.has(r.id)}
                aria-controls={"details-"+r.id}
                on:click={() => toggleDetails(r)}
              >
                <svg
                  class="h-3.5 w-3.5 transition-transform"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  style={`transform: rotate(${expanded.has(r.id) ? 90 : 0}deg);`}
                  aria-hidden="true"
                >
                  <path fill-rule="evenodd"
                    d="M6.293 7.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3A1 1 0 016 13.293L8.293 11 6 8.707a1 1 0 010-1.414z"
                    clip-rule="evenodd" />
                </svg>
                <span>{expanded.has(r.id) ? 'Hide' : 'Details'}</span>
              </button>
            </td>
          </tr>

          <!-- Details row (always visible) -->
          {#if expanded.has(r.id)}
            <tr class="bg-gray-50">
              <td colspan="6" class="px-4 py-3">
                {#if loadingIds.has(r.id)}
                  <div class="text-sm text-gray-600">Loading…</div>
                {:else}
                  {@const subj = subjects.get(r.id)}
                  {#if subj && subj.type === 'image'}
                    {@const s = subj as ImageSubject}
                    <div class="flex items-start gap-4">
                      <!-- Reported image -->
                      <img
                        alt=""
                        class="h-28 w-28 rounded object-cover border"
                        src={renderImage(s.bucket, s.path, 224, 224)}
                        width="112"
                        height="112"
                        loading="lazy"
                      />

                      <!-- Uploader card -->
                      <div class="flex-1 flex items-start gap-3">
                        {#if s.uploader?.avatar_url && avatarSrc(s.uploader.avatar_url)}
                          <img
                            alt=""
                            class="h-10 w-10 rounded-full border object-cover"
                            src={avatarSrc(s.uploader.avatar_url, 64)!}
                            width="40"
                            height="40"
                            loading="lazy"
                          />
                        {:else}
                          <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
                        {/if}

                        <div class="min-w-0">
                          <div class="font-medium truncate">{s.uploader?.name ?? 'Unknown user'}</div>
                          <div class="text-xs text-gray-500 truncate">{s.uploader?.email ?? '—'}</div>
                          <div class="text-xs text-gray-400 break-all">ID: {s.uploader?.id ?? s.user_id ?? '—'}</div>

                          <!-- Action: delete image -->
                          <form method="POST" action="?/deleteImage" class="mt-2 flex flex-wrap items-center gap-2">
                            <input type="hidden" name="media_id"  value={s.id} />
                            <input type="hidden" name="report_id" value={r.id} />
                            <label class="sr-only" for={"delnote-"+r.id}>Note</label>
                            <input id={"delnote-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                            <button class="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete image</button>
                          </form>
                        </div>
                      </div>
                    </div>

                  {:else if subj && subj.type === 'user'}
                    {@const s = subj as UserSubject}
                    <div class="flex items-start justify-between gap-4">
                      <div class="flex items-start gap-3 min-w-0">
                        {#if s.avatar_url && avatarSrc(s.avatar_url)}
                          <img
                            alt=""
                            class="h-10 w-10 rounded-full border object-cover"
                            src={avatarSrc(s.avatar_url, 64)!}
                            width="40"
                            height="40"
                            loading="lazy"
                          />
                        {:else}
                          <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
                        {/if}

                        <div class="min-w-0">
                          <div class="font-medium truncate">{s.name}</div>
                          <div class="text-xs text-gray-500 truncate">{s.email ?? '—'}</div>
                          <div class="text-xs text-gray-400 break-all">ID: {s.id}</div>
                        </div>
                      </div>

                      <div class="flex items-center gap-2">
                        <form method="POST" action="?/banUser" class="flex items-center gap-2">
                          <input type="hidden" name="user_id" value={s.id} />
                          <input type="hidden" name="report_id" value={r.id} />
                          <label class="sr-only" for={"banreason-"+r.id}>Reason</label>
                          <input id={"banreason-"+r.id} name="reason" class="border rounded px-2 py-1 text-xs" placeholder="reason" />
                          <button class="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700">Ban</button>
                        </form>
                        <form method="POST" action="?/unbanUser">
                          <input type="hidden" name="user_id" value={s.id} />
                          <button class="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Unban</button>
                        </form>
                      </div>
                    </div>

                  {:else}
                    <div class="text-sm text-gray-600">No preview available.</div>
                  {/if}
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>
</main>
