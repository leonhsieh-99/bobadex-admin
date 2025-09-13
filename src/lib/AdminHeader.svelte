<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { toasts } from '$lib/toast';
  import { base } from '$app/paths';

  // active link helpers
  const navBase = 'px-3 py-2 rounded';
  const idle = navBase + ' hover:bg-gray-100';
  const active = navBase + ' bg-gray-900 text-white';
  $: path = $page.url.pathname;
  const is = (href: string) =>
    href === '/admin' ? path === '/admin' : (path === href || path.startsWith(href + '/'));

  // --- Typeahead state ---
  let q = '';
  let open = false;
  let loading = false;
  let activeIndex = 0;
  let results: Array<{ slug: string; display: string }> = [];
  let box: HTMLDivElement | null = null;
  let inputEl: HTMLInputElement | null = null;
  let debounceId: ReturnType<typeof setTimeout> | null = null;

  // map server redirect codes -> toast appearance + default text
  const map: Record<string, { kind: 'success'|'error'|'info'; text: string }> = {
    created_new:       { kind: 'success', text: 'Created new brand' },
    merged_existing:   { kind: 'success', text: 'Merged into existing brand' },
    merged:            { kind: 'success', text: 'Merged' },
    rejected:          { kind: 'info',    text: 'Candidate rejected' },
    approve_failed:    { kind: 'error',   text: 'Approve failed' },
    reject_failed:     { kind: 'error',   text: 'Reject failed' },
    merge_failed:      { kind: 'error',   text: 'Merge failed' },
  };

  let lastKey = '';

  function scheduleSearch(term: string) {
    if (!browser) return;
    if (debounceId) clearTimeout(debounceId);
    debounceId = setTimeout(() => runSearch(term), 200);
  }

  async function runSearch(term: string) {
    const needle = term.trim();
    if (needle.length < 2) { results = []; open = false; return; }
    loading = true;

    try {
      const url = `${base}/admin/_api/brand-search?q=${encodeURIComponent(needle)}`;
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(await r.text());
      results = await r.json();
      open = results.length > 0;
      activeIndex = 0;
    } catch (err) {
      console.error('brand-search fetch failed', err);
    } finally {
      loading = false;
    }
  }

  // Close on outside click
  function onClickOutside(e: MouseEvent) {
    if (!box) return;
    if (!box.contains(e.target as Node)) open = false;
  }

  function handle(url: URL) {
    const toastCode = url.searchParams.get('toast');
    const rawMsg    = url.searchParams.get('msg');
    const key = `${toastCode}|${rawMsg ?? ''}`;
    if (!toastCode || key === lastKey) return;
    lastKey = key;

    const cfg = map[toastCode] ?? { kind: 'info', text: toastCode };
    const msg = rawMsg ?? cfg.text;
    toasts[cfg.kind](msg, 4000);

    if (browser) {
      const sp = new URLSearchParams(url.search);
      sp.delete('toast');
      sp.delete('msg');
      const clean = `${url.pathname}${sp.toString() ? `?${sp}` : ''}${url.hash}`;
      history.replaceState({}, '', clean);
    }
  }

  onMount(() => {
    // prove we mounted on /admin/*
    console.log('[AdminHeader] mounted');
    if (browser) handle(new URL(window.location.href));
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  });

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') open = false;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, results.length - 1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); }
    if (e.key === 'Enter') {
      const r = results[activeIndex];
      if (r) {
        q = r.slug;
        open = false;
        inputEl?.select();
      }
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<header class="sticky top-0 z-40 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
  <div class="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold">Bobadex Admin</h1>

    <!-- Typeahead -->
    <div class="relative w-[28rem] max-w-[60vw]" bind:this={box}>
      <div class="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" class="opacity-60">
          <path fill="currentColor" d="m21 20.3l-4.6-4.6a7.5 7.5 0 1 0-1.4 1.4L20.3 21zM5 10.5A5.5 5.5 0 1 1 10.5 16A5.5 5.5 0 0 1 5 10.5"/>
        </svg>
        <input
          class="w-full bg-transparent outline-none text-sm"
          placeholder="Quick search brands… (name or slug)"
          bind:this={inputEl}
          bind:value={q}
          on:input={(e) => scheduleSearch((e.target as HTMLInputElement).value)}
          on:focus={() => (open = results.length > 0)}
        />
        {#if loading}
          <span class="text-xs text-gray-500">Searching…</span>
        {/if}
      </div>

      {#if open}
        <div class="absolute left-0 right-0 mt-1 rounded-xl border bg-white shadow-lg overflow-hidden">
          {#if results.length === 0}
            <div class="px-3 py-2 text-sm text-gray-500">No results</div>
          {:else}
            <ul role="listbox" aria-label="Brand results" class="max-h-80 overflow-auto">
              {#each results as r, i}
                <li
                  class="px-3 py-2 text-sm flex items-center justify-between {i===activeIndex ? 'bg-gray-50' : ''}"
                  aria-selected={i === activeIndex}
                  role="option"
                  on:mouseenter={() => (activeIndex = i)}
                >
                  <button
                    type="button"
                    class="flex-1 text-left flex items-center gap-2 hover:bg-gray-50 rounded px-1 py-1"
                    on:click={() => { q = r.slug; open = false; inputEl?.select(); }}
                  >
                    <span class="font-medium">{r.display}</span>
                    <span class="text-xs text-gray-500">({r.slug})</span>
                  </button>

                  <a
                    class="ml-3 text-xs text-blue-600 underline whitespace-nowrap"
                    href={`/admin/brands?slug=${encodeURIComponent(r.slug)}`}
                    on:click={(e) => e.stopPropagation()}
                  >
                    open
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <nav class="flex gap-2">
      <a href="/admin"          class={is('/admin') ? active : idle}>Dashboard</a>
      <a href="/admin/brands"   class={is('/admin/brands') ? active : idle}>Brands</a>
      <a href="/admin/reports"  class={is('/admin/reports') ? active : idle}>Reports</a>
      <a href="/admin/imports"  class={is('/admin/imports') ? active : idle}>Imports</a>
    </nav>
  </div>
</header>
