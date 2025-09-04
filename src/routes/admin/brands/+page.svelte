<!-- src/routes/admin/brands/+page.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { toasts } from '$lib/toast';
  import { writable } from 'svelte/store';

  export let data: {
    pending: Array<{ id: string; suggested_name: string; slug: string | null; created_at: string }>;
  };

  // track which rows are mid-submit
  const submitting = writable(new Set<string>());

  function markSubmitting(id: string, on: boolean) {
    submitting.update((s) => {
      const next = new Set(s);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  // show toasts based on query params (guarded from SSR)
  $: if (browser) {
    const toast = $page.url.searchParams.get('toast');
    const msg = $page.url.searchParams.get('msg');
    if (toast) {
      if (toast === 'verified') toasts.success('Brand verified');
      else if (toast === 'rejected') toasts.success('Brand rejected');
      else if (toast === 'verify_failed') toasts.error(msg ?? 'Verify failed');
      else if (toast === 'reject_failed') toasts.error(msg ?? 'Reject failed');
      history.replaceState(null, '', '/admin/brands');
    }
  }
</script>

<h2 class="mb-3 text-xl font-semibold">Pending Brands</h2>

{#if data.pending.length === 0}
  <p>No pending brands 🎉</p>
{:else}
  <ul class="space-y-4">
    {#each data.pending as b}
      <li class="rounded border p-3">
        <div class="font-medium">{b.suggested_name}</div>
        <div class="text-xs text-gray-600">ID {b.id} • {new Date(b.created_at).toLocaleString()}</div>

        <form
          method="post"
          class="mt-2 flex flex-wrap items-center gap-2"
          on:submit={(e) => {
            // mark this row as busy until the redirect/navigation completes
            const form = e.currentTarget as HTMLFormElement;
            const id = (form.querySelector('input[name="id"]') as HTMLInputElement)?.value;
            if (id) markSubmitting(id, true);
          }}
        >
          <input type="hidden" name="id" value={b.id} />

          <label class="inline-flex items-center gap-2">
            <span class="text-sm text-gray-700">Force slug</span>
            <input name="force_slug" class="rounded border px-2 py-1" placeholder="(optional)" />
          </label>

          <button
            formaction="?/verify"
            class="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={$submitting.has(b.id)}
            aria-busy={$submitting.has(b.id)}
          >
            {$submitting.has(b.id) ? 'Verifying…' : 'Verify'}
          </button>

          <label class="inline-flex items-center gap-2">
            <span class="text-sm text-gray-700">Reason</span>
            <input name="reason" class="rounded border px-2 py-1" placeholder="(optional)" />
          </label>

          <button
            formaction="?/reject"
            class="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50"
            disabled={$submitting.has(b.id)}
            aria-busy={$submitting.has(b.id)}
          >
            {$submitting.has(b.id) ? 'Rejecting…' : 'Reject'}
          </button>
        </form>
      </li>
    {/each}
  </ul>
{/if}
