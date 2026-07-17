<!-- src/routes/admin/reports/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import ReportsTable from './ReportsTable.svelte';
  import ReviewTabs from '$lib/ReviewTabs.svelte';

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

  // ===== Types kept in the page =====
  type ImageSubject = {
    type: 'image';
    id: string;
    user_id: string | null;
    bucket: string;     // 'media-uploads'
    path: string;       // image_path
    uploader?: {
      id: string;
      username: string | null;
      display_name: string | null;
      bio: string | null;
      email: string | null;
      profile_image_path: string | null;
    };
  };

  type UserSubject = {
    type: 'user';
    id: string;
    username: string | null;
    name: string | null;                // display_name from server
    email: string | null;
    bio: string | null;
    profile_image_path: string | null;
  };

  type Subject = ImageSubject | UserSubject;

  // ===== Page state (subjects, loading, expand) =====
  let subjects: Map<string, Subject> = new Map();   // report_id -> subject
  let loadingIds: Set<string> = new Set();          // report_ids currently fetching
  let expanded: Set<string> = new Set();

  // ===== Helpers kept in the page =====
  const SB_HOST = 'https://vsiuyynrooqzcstzyeir.supabase.co';

  function renderImage(bucket: string, path: string, w: number, h: number, resize = 'cover', quality = 80) {
    return `${SB_HOST}/storage/v1/render/image/public/${bucket}/${path}?width=${w}&height=${h}&resize=${resize}&quality=${quality}`;
  }

  function avatarSrc(avatar_url?: string | null, size = 64) {
    if (!avatar_url) return null;
    if (/^https?:\/\//i.test(avatar_url)) return avatar_url; // absolute already
    return renderImage('media-uploads', avatar_url, size, size, 'cover', 80);
  }

  function toggleDetails(r: { id: string; content_type: string; content_id: string }) {
    if (expanded.has(r.id)) {
      expanded.delete(r.id);
    } else {
      expanded.add(r.id);
      // lazy load only when opening / not already loading
      if (!subjects.has(r.id) && !loadingIds.has(r.id)) loadOne(r);
    }
    expanded = new Set(expanded); // trigger reactivity
  }

  async function loadOne(r: { id: string; content_type: string; content_id: string }) {
    if (subjects.has(r.id) || loadingIds.has(r.id)) return;

    loadingIds.add(r.id);
    loadingIds = new Set(loadingIds);

    try {
      const res = await fetch(
        `/admin/reports/subject?p_content_type=${encodeURIComponent(r.content_type)}&p_content_id=${encodeURIComponent(r.content_id)}`
      );
      if (res.ok) {
        const j = (await res.json()) as Subject | null;
        if (j) {
          subjects.set(r.id, j);
          subjects = new Map(subjects); // trigger reactivity
        }
      }
    } finally {
      loadingIds.delete(r.id);
      loadingIds = new Set(loadingIds);
    }
  }

  // Optional: preload everything on mount (you can remove if you prefer lazy only)
  onMount(() => {
    // data.reports.forEach((r) => loadOne(r));
  });

  // Derived groups
  $: pending   = data.reports.filter((r) => r.status === 'pending');
  $: accepted  = data.reports.filter((r) => r.status === 'accepted');
  $: rejected  = data.reports.filter((r) => r.status === 'rejected');
  $: dismissed = data.reports.filter((r) => r.status === 'dismissed');
</script>

<main class="mx-auto max-w-6xl px-4 py-6 space-y-6">
  <h1 class="text-2xl font-bold">Reports</h1>
  <ReviewTabs active="reports" />

  <!-- Pending (always visible) -->
  <div class="rounded-xl border overflow-hidden">
    <div class="flex items-center justify-between px-4 py-3 bg-amber-50 border-b">
      <h2 class="font-semibold">Pending</h2>
      <span class="text-xs rounded-full bg-white px-2 py-0.5 text-amber-800 border border-amber-200">{pending.length}</span>
    </div>

    {#if pending.length === 0}
      <div class="px-4 py-6 text-sm text-gray-500">No pending reports 🎉</div>
    {:else}
      <ReportsTable
        rows={pending}
        {expanded}
        {subjects}
        {loadingIds}
        on:toggle-details={(e) => toggleDetails(e.detail)}
      >
        <!-- IMAGE details slot -->
        <svelte:fragment slot="image" let:subj let:r>
          <div class="flex items-start gap-4">
            <!-- Reported image -->
            <img
              alt=""
              class="h-28 w-28 rounded object-cover border"
              src={renderImage(subj.bucket, subj.path, 224, 224)}
              width="112" height="112" loading="lazy"
            />
        
            <!-- Uploader card -->
            <div class="flex-1 flex items-start gap-3">
              {#if subj.uploader?.profile_image_path && avatarSrc(subj.uploader.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.uploader.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}
        
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">
                    {subj.uploader?.display_name ?? subj.uploader?.username ?? 'Unknown user'}
                  </div>
                  {#if subj.uploader?.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.uploader.username}</div>
                  {/if}
                </div>
        
                <div class="text-xs text-gray-500 truncate">{subj.uploader?.email ?? '—'}</div>
                {#if subj.uploader?.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.uploader.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.uploader?.id ?? subj.user_id ?? '—'}</div>
        
                <!-- Action: delete image -->
                <form method="POST" action="?/deleteImage" class="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="media_id"  value={subj.id} />
                  <input type="hidden" name="report_id" value={r.id} />
                  <label class="sr-only" for={"delnote-"+r.id}>Note</label>
                  <input id={"delnote-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                  <button class="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete image</button>
                </form>
              </div>
            </div>
          </div>
        </svelte:fragment>
        

        <!-- USER details slot -->
        <svelte:fragment slot="user" let:subj let:r>
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 min-w-0">
              {#if subj.profile_image_path && avatarSrc(subj.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">{subj.name ?? subj.username ?? 'Unknown user'}</div>
                  {#if subj.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.username}</div>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 truncate">{subj.email ?? '—'}</div>
                {#if subj.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.id}</div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <form method="POST" action="?/banUser" class="flex items-center gap-2">
                <input type="hidden" name="user_id" value={subj.id} />
                <input type="hidden" name="report_id" value={r.id} />
                <label class="sr-only" for={"banreason-"+r.id}>Reason</label>
                <input id={"banreason-"+r.id} name="reason" class="border rounded px-2 py-1 text-xs" placeholder="reason" />
                <button class="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700">Ban</button>
              </form>
              <form method="POST" action="?/unbanUser">
                <input type="hidden" name="user_id" value={subj.id} />
                <button class="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Unban</button>
              </form>
            </div>
          </div>
        </svelte:fragment>
      </ReportsTable>
    {/if}
  </div>

  <!-- Accepted -->
  <details class="rounded-xl border overflow-hidden group" open={false}>
    <summary class="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-gray-50">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold">Accepted</h3>
        <span class="text-xs rounded-full bg-white px-2 py-0.5 text-gray-700 border">{accepted.length}</span>
      </div>
      <span class="text-xs text-gray-500 group-open:hidden">Show</span>
      <span class="text-xs text-gray-500 hidden group-open:inline">Hide</span>
    </summary>

    {#if accepted.length === 0}
      <div class="px-4 py-4 text-sm text-gray-500">None</div>
    {:else}
      <ReportsTable
        rows={accepted}
        {expanded}
        {subjects}
        {loadingIds}
        readonly
        on:toggle-details={(e) => toggleDetails(e.detail)}
      >
        <!-- IMAGE details slot -->
        <svelte:fragment slot="image" let:subj let:r>
          <div class="flex items-start gap-4">
            <!-- Reported image -->
            <img
              alt=""
              class="h-28 w-28 rounded object-cover border"
              src={renderImage(subj.bucket, subj.path, 224, 224)}
              width="112" height="112" loading="lazy"
            />

            <!-- Uploader card -->
            <div class="flex-1 flex items-start gap-3">
              {#if subj.uploader?.profile_image_path && avatarSrc(subj.uploader.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.uploader.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">
                    {subj.uploader?.display_name ?? subj.uploader?.username ?? 'Unknown user'}
                  </div>
                  {#if subj.uploader?.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.uploader.username}</div>
                  {/if}
                </div>

                <div class="text-xs text-gray-500 truncate">{subj.uploader?.email ?? '—'}</div>
                {#if subj.uploader?.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.uploader.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.uploader?.id ?? subj.user_id ?? '—'}</div>

                <!-- Action: delete image -->
                <form method="POST" action="?/deleteImage" class="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="media_id"  value={subj.id} />
                  <input type="hidden" name="report_id" value={r.id} />
                  <label class="sr-only" for={"delnote-"+r.id}>Note</label>
                  <input id={"delnote-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                  <button class="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete image</button>
                </form>
              </div>
            </div>
          </div>
        </svelte:fragment>

        <!-- USER details slot -->
        <svelte:fragment slot="user" let:subj let:r>
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 min-w-0">
              {#if subj.profile_image_path && avatarSrc(subj.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">{subj.name ?? subj.username ?? 'Unknown user'}</div>
                  {#if subj.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.username}</div>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 truncate">{subj.email ?? '—'}</div>
                {#if subj.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.id}</div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <form method="POST" action="?/banUser" class="flex items-center gap-2">
                <input type="hidden" name="user_id" value={subj.id} />
                <input type="hidden" name="report_id" value={r.id} />
                <label class="sr-only" for={"banreason-"+r.id}>Reason</label>
                <input id={"banreason-"+r.id} name="reason" class="border rounded px-2 py-1 text-xs" placeholder="reason" />
                <button class="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700">Ban</button>
              </form>
              <form method="POST" action="?/unbanUser">
                <input type="hidden" name="user_id" value={subj.id} />
                <button class="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Unban</button>
              </form>
            </div>
          </div>
        </svelte:fragment>
      </ReportsTable>
    {/if}
  </details>

  <!-- Rejected -->
  <details class="rounded-xl border overflow-hidden group" open={false}>
    <summary class="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-gray-50">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold">Rejected</h3>
        <span class="text-xs rounded-full bg-white px-2 py-0.5 text-gray-700 border">{rejected.length}</span>
      </div>
      <span class="text-xs text-gray-500 group-open:hidden">Show</span>
      <span class="text-xs text-gray-500 hidden group-open:inline">Hide</span>
    </summary>

    {#if rejected.length === 0}
      <div class="px-4 py-4 text-sm text-gray-500">None</div>
    {:else}
      <ReportsTable
        rows={rejected}
        {expanded}
        {subjects}
        {loadingIds}
        readonly
        on:toggle-details={(e) => toggleDetails(e.detail)}
      >
        <!-- IMAGE details slot -->
       <svelte:fragment slot="image" let:subj let:r>
          <div class="flex items-start gap-4">
            <!-- Reported image -->
            <img
              alt=""
              class="h-28 w-28 rounded object-cover border"
              src={renderImage(subj.bucket, subj.path, 224, 224)}
              width="112" height="112" loading="lazy"
            />

            <!-- Uploader card -->
            <div class="flex-1 flex items-start gap-3">
              {#if subj.uploader?.profile_image_path && avatarSrc(subj.uploader.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.uploader.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">
                    {subj.uploader?.display_name ?? subj.uploader?.username ?? 'Unknown user'}
                  </div>
                  {#if subj.uploader?.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.uploader.username}</div>
                  {/if}
                </div>

                <div class="text-xs text-gray-500 truncate">{subj.uploader?.email ?? '—'}</div>
                {#if subj.uploader?.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.uploader.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.uploader?.id ?? subj.user_id ?? '—'}</div>

                <!-- Action: delete image -->
                <form method="POST" action="?/deleteImage" class="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="media_id"  value={subj.id} />
                  <input type="hidden" name="report_id" value={r.id} />
                  <label class="sr-only" for={"delnote-"+r.id}>Note</label>
                  <input id={"delnote-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                  <button class="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete image</button>
                </form>
              </div>
            </div>
          </div>
        </svelte:fragment>

                <!-- USER details slot -->
        <svelte:fragment slot="user" let:subj let:r>
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3 min-w-0">
              {#if subj.profile_image_path && avatarSrc(subj.profile_image_path)}
                <img
                  alt=""
                  class="h-10 w-10 rounded-full border object-cover"
                  src={avatarSrc(subj.profile_image_path, 64)!}
                  width="40" height="40" loading="lazy"
                />
              {:else}
                <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
              {/if}

              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <div class="font-medium truncate">{subj.name ?? subj.username ?? 'Unknown user'}</div>
                  {#if subj.username}
                    <div class="text-xs text-gray-500 truncate">@{subj.username}</div>
                  {/if}
                </div>
                <div class="text-xs text-gray-500 truncate">{subj.email ?? '—'}</div>
                {#if subj.bio}
                  <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.bio}</div>
                {/if}
                <div class="text-[11px] text-gray-400 break-all">ID: {subj.id}</div>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <form method="POST" action="?/banUser" class="flex items-center gap-2">
                <input type="hidden" name="user_id" value={subj.id} />
                <input type="hidden" name="report_id" value={r.id} />
                <label class="sr-only" for={"banreason-"+r.id}>Reason</label>
                <input id={"banreason-"+r.id} name="reason" class="border rounded px-2 py-1 text-xs" placeholder="reason" />
                <button class="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700">Ban</button>
              </form>
              <form method="POST" action="?/unbanUser">
                <input type="hidden" name="user_id" value={subj.id} />
                <button class="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Unban</button>
              </form>
            </div>
          </div>
        </svelte:fragment>
      </ReportsTable>
    {/if}
  </details>

  <!-- Dismissed -->
  <details class="rounded-xl border overflow-hidden group" open={false}>
    <summary class="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-gray-50">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold">Dismissed</h3>
        <span class="text-xs rounded-full bg-white px-2 py-0.5 text-gray-700 border">{dismissed.length}</span>
      </div>
      <span class="text-xs text-gray-500 group-open:hidden">Show</span>
      <span class="text-xs text-gray-500 hidden group-open:inline">Hide</span>
    </summary>

    {#if dismissed.length === 0}
      <div class="px-4 py-4 text-sm text-gray-500">None</div>
    {:else}
      <ReportsTable
        rows={dismissed}
        {expanded}
        {subjects}
        {loadingIds}
        readonly
        on:toggle-details={(e) => toggleDetails(e.detail)}
      >
        <!-- IMAGE details slot -->
       <svelte:fragment slot="image" let:subj let:r>
        <div class="flex items-start gap-4">
          <!-- Reported image -->
          <img
            alt=""
            class="h-28 w-28 rounded object-cover border"
            src={renderImage(subj.bucket, subj.path, 224, 224)}
            width="112" height="112" loading="lazy"
          />

          <!-- Uploader card -->
          <div class="flex-1 flex items-start gap-3">
            {#if subj.uploader?.profile_image_path && avatarSrc(subj.uploader.profile_image_path)}
              <img
                alt=""
                class="h-10 w-10 rounded-full border object-cover"
                src={avatarSrc(subj.uploader.profile_image_path, 64)!}
                width="40" height="40" loading="lazy"
              />
            {:else}
              <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
            {/if}

            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate">
                  {subj.uploader?.display_name ?? subj.uploader?.username ?? 'Unknown user'}
                </div>
                {#if subj.uploader?.username}
                  <div class="text-xs text-gray-500 truncate">@{subj.uploader.username}</div>
                {/if}
              </div>

              <div class="text-xs text-gray-500 truncate">{subj.uploader?.email ?? '—'}</div>
              {#if subj.uploader?.bio}
                <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.uploader.bio}</div>
              {/if}
              <div class="text-[11px] text-gray-400 break-all">ID: {subj.uploader?.id ?? subj.user_id ?? '—'}</div>

              <!-- Action: delete image -->
              <form method="POST" action="?/deleteImage" class="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="media_id"  value={subj.id} />
                <input type="hidden" name="report_id" value={r.id} />
                <label class="sr-only" for={"delnote-"+r.id}>Note</label>
                <input id={"delnote-"+r.id} name="note" class="border rounded px-2 py-1 text-xs" placeholder="note (optional)" />
                <button class="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete image</button>
              </form>
            </div>
          </div>
        </div>
      </svelte:fragment>

              <!-- USER details slot -->
      <svelte:fragment slot="user" let:subj let:r>
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3 min-w-0">
            {#if subj.profile_image_path && avatarSrc(subj.profile_image_path)}
              <img
                alt=""
                class="h-10 w-10 rounded-full border object-cover"
                src={avatarSrc(subj.profile_image_path, 64)!}
                width="40" height="40" loading="lazy"
              />
            {:else}
              <div class="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600">?</div>
            {/if}

            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate">{subj.name ?? subj.username ?? 'Unknown user'}</div>
                {#if subj.username}
                  <div class="text-xs text-gray-500 truncate">@{subj.username}</div>
                {/if}
              </div>
              <div class="text-xs text-gray-500 truncate">{subj.email ?? '—'}</div>
              {#if subj.bio}
                <div class="mt-1 text-xs text-gray-600 line-clamp-2">{subj.bio}</div>
              {/if}
              <div class="text-[11px] text-gray-400 break-all">ID: {subj.id}</div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <form method="POST" action="?/banUser" class="flex items-center gap-2">
              <input type="hidden" name="user_id" value={subj.id} />
              <input type="hidden" name="report_id" value={r.id} />
              <label class="sr-only" for={"banreason-"+r.id}>Reason</label>
              <input id={"banreason-"+r.id} name="reason" class="border rounded px-2 py-1 text-xs" placeholder="reason" />
              <button class="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700">Ban</button>
            </form>
            <form method="POST" action="?/unbanUser">
              <input type="hidden" name="user_id" value={subj.id} />
              <button class="px-3 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300">Unban</button>
            </form>
          </div>
        </div>
      </svelte:fragment>
      </ReportsTable>
    {/if}
  </details>
</main>
