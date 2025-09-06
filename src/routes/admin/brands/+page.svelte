<!-- src/routes/admin/brands/+page.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { page as pageStore } from '$app/stores';
  import { toasts } from '$lib/toast';
  import { writable, get } from 'svelte/store';
  import { createClient } from '@supabase/supabase-js';
  import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

  export let data: {
    pending: Array<{ id: string; suggested_name: string; created_at: string }>;
    iconless: Array<{ slug: string; display: string; icon_path: string | null; created_at: string }>;
  };

  const submitting = writable(new Set<string>());

  function markSubmitting(id: string, on: boolean) {
    submitting.update((s) => {
      const next = new Set(s);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  // Batch state
  const batchRunning = writable(false);
  const progress = writable<Record<string, 'idle' | 'ok' | 'err' | 'run'>>({});
  const doneCount = writable(0);

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: true }
  });

  async function generateOne(slug: string, prompt: string) {
    progress.update((p) => ({ ...p, [slug]: 'run' }));
    const { data: res, error } = await supabase.functions.invoke('generate-icon', {
      body: { slug, prompt }
    });
    if (error || !(res as any)?.path) {
      progress.update((p) => ({ ...p, [slug]: 'err' }));
      return false;
    }
    progress.update((p) => ({ ...p, [slug]: 'ok' }));
    doneCount.update((n) => n + 1);
    return true;
  }

  async function runBatch(limit = 50) {
    if (get(batchRunning)) return;
    batchRunning.set(true);
    doneCount.set(0);
    const items = data.iconless.slice(0, limit);
    progress.set(Object.fromEntries(items.map((b) => [b.slug, 'idle'] as const)));
    for (const b of items) {
      if (!get(batchRunning)) break;
      await generateOne(b.slug, b.display);
    }
    batchRunning.set(false);
    toasts.success('Batch icon generation finished');
  }

  $: if (browser) {
    const $page = $pageStore;
    const toast = $page.url.searchParams.get('toast');
    const msg = $page.url.searchParams.get('msg');
    const slug = $page.url.searchParams.get('slug');
    const display = $page.url.searchParams.get('display');

    if (toast) {
      if (toast === 'verified') {
        toasts.success('Brand verified');
        if (slug && display) {
          generateOne(slug, display); // auto-start icon gen
        }
      } else if (toast === 'rejected') {
        toasts.success('Brand rejected');
      } else if (toast === 'verify_failed') {
        toasts.error(msg ?? 'Verify failed');
      } else if (toast === 'reject_failed') {
        toasts.error(msg ?? 'Reject failed');
      }
      history.replaceState(null, '', '/admin/brands');
    }
  }
</script>


<!-- src/routes/admin/brands/+page.svelte -->
<section class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
  <!-- Pending Brands -->
  <div class="rounded-2xl border bg-white p-6 flex flex-col">
    <h2 class="mb-4 text-lg font-semibold">Pending Brands</h2>

    {#if data.pending.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center text-center text-sm text-gray-500 py-10">
        <p>No brand submissions awaiting review.</p>
      </div>
    {:else}
      <ul class="divide-y">
        {#each data.pending as b}
          <li class="py-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="text-sm font-medium text-gray-900">{b.suggested_name}</div>
                <div class="mt-0.5 text-xs text-gray-500">
                  <span class="rounded bg-gray-100 px-1.5 py-0.5">ID</span>
                  <code class="ml-1">{b.id}</code>
                  <span class="mx-2 text-gray-400">•</span>
                  {new Date(b.created_at).toLocaleString()}
                </div>
              </div>

              <!-- actions -->
              <form
                method="post"
                class="mt-1 flex flex-wrap items-center gap-2"
                on:submit={(e) => {
                  const form = e.currentTarget as HTMLFormElement;
                  const id = (form.querySelector('input[name="id"]') as HTMLInputElement)?.value;
                  if (id) markSubmitting(id, true);
                }}
              >
                <input type="hidden" name="id" value={b.id} />

                <label class="inline-flex items-center gap-2">
                  <span class="text-xs text-gray-700">Force display</span>
                  <input
                    name="force_display"
                    class="rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                    placeholder="(optional)"
                  />
                </label>

                <button
                  formaction="?/verify"
                  class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  disabled={$submitting.has(b.id)}
                  aria-busy={$submitting.has(b.id)}
                >
                  {$submitting.has(b.id) ? 'Verifying…' : 'Verify'}
                </button>

                <label class="inline-flex items-center gap-2">
                  <span class="text-xs text-gray-700">Reason</span>
                  <input
                    name="reason"
                    class="rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                    placeholder="(optional)"
                  />
                </label>

                <button
                  formaction="?/reject"
                  class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={$submitting.has(b.id)}
                  aria-busy={$submitting.has(b.id)}
                >
                  {$submitting.has(b.id) ? 'Rejecting…' : 'Reject'}
                </button>
              </form>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Brands needing icons -->
  <div class="rounded-2xl border bg-white p-6 flex flex-col">
    <h2 class="mb-4 text-lg font-semibold">Brands Needing Icons</h2>

    {#if data.iconless.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center text-center text-sm text-gray-500 py-10">
        <p>All set — every brand has an icon.</p>
      </div>
    {:else}
      <div class="mb-3 flex items-center gap-3">
        <button
          class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          on:click={() => runBatch(50)}
          disabled={$batchRunning}
        >
          {$batchRunning ? 'Generating…' : 'Generate batch (50)'}
        </button>
        <span class="text-xs text-gray-600">
          {$doneCount}/{data.iconless.length} completed
        </span>
      </div>

      <ul class="divide-y">
        {#each data.iconless as b}
          <li class="py-3 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-900 truncate">{b.display}</div>
              <div class="text-xs text-gray-500">slug: <code>{b.slug}</code></div>
            </div>
            <div class="flex items-center gap-2">
              {#if $progress[b.slug] === 'ok'}
                <span class="text-xs text-emerald-700">Done</span>
              {:else if $progress[b.slug] === 'err'}
                <span class="text-xs text-red-600">Failed</span>
              {:else if $progress[b.slug] === 'run'}
                <span class="text-xs text-gray-600">Working…</span>
              {/if}
              <button
                class="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                on:click={() => generateOne(b.slug, b.display)}
                disabled={$batchRunning || $progress[b.slug] === 'run'}
              >
                Generate
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
