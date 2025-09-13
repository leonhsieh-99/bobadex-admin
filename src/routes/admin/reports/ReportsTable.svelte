<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let rows: Array<{
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
  }> = [];

  export let expanded: Set<string>;
  export let subjects: Map<string, any>;
  export let loadingIds: Set<string>;
  export let readonly = false;

  // NOTE: kebab-case event name
  const dispatch = createEventDispatcher<{ 'toggle-details': { id: string; content_type: string; content_id: string } }>();

  const badge = (s: string) =>
    s === 'pending'   ? 'bg-amber-100 text-amber-800'   :
    s === 'accepted'  ? 'bg-emerald-100 text-emerald-800':
    s === 'dismissed' ? 'bg-gray-100 text-gray-800'     :
                        'bg-red-100 text-red-800';
</script>
  
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
      {#each rows as r}
        <tr>
          <td class="px-4 py-2">{new Date(r.created_at).toLocaleString()}</td>
          <td class="px-4 py-2">
            {r.content_type}
            <div class="text-xs text-gray-500 break-all">{r.content_id}</div>
          </td>
          <td class="px-4 py-2">{r.reason}</td>
          <td class="px-4 py-2">{r.message ?? '—'}</td>
          <td class="px-4 py-2">
            <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${badge(r.status)}`}>{r.status}</span>
          </td>
          <td class="px-4 py-2">
            {#if !readonly && r.status === 'pending'}
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
              <div class="text-xs text-gray-500">{r.resolution_note ?? '—'}</div>
            {/if}
          </td>
          <td class="px-4 py-2 text-right">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
              aria-expanded={expanded.has(r.id)}
              aria-controls={"details-"+r.id}
              on:click={() => dispatch('toggle-details', { id: r.id, content_type: r.content_type, content_id: r.content_id })}
            >
              <!-- caret svg ... -->
              <span>{expanded.has(r.id) ? 'Hide' : 'Details'}</span>
            </button>          
          </td>
        </tr>
  
        {#if expanded.has(r.id)}
          <tr class="bg-gray-50">
            <td colspan="7" class="px-4 py-3">
              {#if loadingIds.has(r.id)}
                <div class="text-sm text-gray-600">Loading…</div>
              {:else}
                {@const subj = subjects.get(r.id)}
                {#if subj && subj.type === 'image'}
                  <slot name="image" {subj} {r} />
                {:else if subj && subj.type === 'user'}
                  <slot name="user" {subj} {r} />
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
  