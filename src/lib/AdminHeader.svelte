<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { toasts } from '$lib/toast';
  import { base } from '$app/paths';
  import { createClient } from '@supabase/supabase-js';
  import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
  import { tick } from 'svelte';

  const navLink = 'px-3 py-2 rounded hover:bg-gray-100';

  function withBase(p: string) {
    return (base && base !== '/') ? `${base}${p}` : p;
  }

  // --- Typeahead state ---
  let q = '';
  let open = false;
  let loading = false;
  let activeIndex = 0;
  let results: Array<{ slug: string; display: string }> = [];
  let box: HTMLDivElement | null = null;
  let inputEl: HTMLInputElement | null = null;
  let debounceId: ReturnType<typeof setTimeout> | null = null;

  // actions-menu state (tracks which row index is open)
  let menuFor: number | null = null;
  let menuEl: HTMLUListElement | null = null;

  // supabase (for re-generate icon)
  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: true }
  });

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
      menuFor = null; // close any open menu when new results arrive
    } catch (err) {
      console.error('brand-search fetch failed', err);
    } finally {
      loading = false;
    }
  }

  // Close on outside click
  function onClickOutside(e: MouseEvent) {
    if (!box) return;
    if (!box.contains(e.target as Node)) {
      open = false;
      menuFor = null;
    }
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
    console.log('[AdminHeader] mounted');
    if (browser) handle(new URL(window.location.href));
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  });

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { open = false; menuFor = null; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, results.length - 1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); }
    if (e.key === 'Enter') {
      const r = results[activeIndex];
      if (r) {
        q = r.slug;
        open = false;
        menuFor = null;
        inputEl?.select();
      }
    }
  }

  // ==== actions ====

  async function requestDelete(slug: string) {
    try {
      const r = await fetch(withBase('/admin/_api/brand-delete-request'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'request failed');
      toasts.success('Delete request filed');
    } catch (e: any) {
      console.error(e);
      toasts.error(e?.message ?? 'Delete request failed');
    } finally {
      menuFor = null;
    }
  }

  async function regenerateIcon(slug: string, prompt: string) {
    try {
      const { data, error } = await supabase.functions.invoke('generate-icon', {
        body: { slug, prompt }
      });
      if (error || !(data as any)?.path) throw new Error(error?.message ?? 'generation failed');
      toasts.success('Icon generated');
    } catch (e: any) {
      console.error(e);
      toasts.error(e?.message ?? 'Icon generation failed');
    } finally {
      menuFor = null;
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<header class="sticky top-0 z-40 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
  <!-- padding: px-5 (was px-4) -->
  <div class="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-3">
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
                  class="px-3 py-2 text-sm flex items-center justify-between gap-2 {i===activeIndex ? 'bg-gray-50' : ''}"
                  aria-selected={i === activeIndex}
                  role="option"
                  on:mouseenter={() => (activeIndex = i)}
                >
                  <button
                    type="button"
                    class="flex-1 text-left flex items-center gap-2 hover:bg-gray-50 rounded px-1 py-1"
                    on:click={() => { q = r.slug; open = false; menuFor = null; inputEl?.select(); }}
                  >
                    <span class="font-medium">{r.display}</span>
                    <span class="text-xs text-gray-500">({r.slug})</span>
                  </button>

                  <!-- open link -->
                  <a
                    class="text-xs text-blue-600 underline whitespace-nowrap"
                    href={withBase(`/admin/brands?slug=${encodeURIComponent(r.slug)}`)}
                    on:click={(e) => e.stopPropagation()}
                  >
                    open
                  </a>

                  <!-- actions menu trigger + popup -->
                  <div class="relative">
                    <button
                      type="button"
                      class="ml-1 rounded p-1 hover:bg-gray-100"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === i}
                      aria-controls={"menu-" + i}
                      on:click={(e) => { e.stopPropagation(); menuFor = (menuFor === i ? null : i); tick().then(() => menuEl?.focus()); }}
                    >
                      <!-- kebab -->
                      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M12 8a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4a2 2 0 0 0 0 4m0 6a2 2 0 1 0 0-4a2 2 0 0 0 0 4"/>
                      </svg>
                      <span class="sr-only">Actions for {r.display}</span>
                    </button>

                    {#if menuFor === i}
                      <!-- Make the container focusable (tabindex="-1") and give it role="menu" -->
                      <ul
                        id={"menu-" + i}
                        role="menu"
                        tabindex="-1"
                        class="absolute right-0 mt-1 w-44 rounded-lg border bg-white shadow-md z-10 overflow-hidden"
                        bind:this={menuEl}
                        on:keydown={(e) => {
                          const items = Array.from(menuEl?.querySelectorAll('[role="menuitem"]') ?? []) as HTMLButtonElement[];
                          const idx = items.indexOf(document.activeElement as HTMLButtonElement);
                          if (e.key === 'Escape') { e.preventDefault(); menuFor = null; (e.currentTarget as HTMLElement).blur(); }
                          else if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] ?? items[0])?.focus(); }
                          else if (e.key === 'ArrowUp')   { e.preventDefault(); (items[idx - 1] ?? items[items.length - 1])?.focus(); }
                          else if (e.key === 'Tab')       { menuFor = null; } // close on tab out
                        }}
                        on:click={(e) => e.stopPropagation()}
                      >
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                            on:click={() => { requestDelete(r.slug); }}
                            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); requestDelete(r.slug); } }}
                          >
                            Request delete
                          </button>
                        </li>
                        <li role="none">
                          <button
                            type="button"
                            role="menuitem"
                            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                            on:click={() => { regenerateIcon(r.slug, r.display); }}
                            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); regenerateIcon(r.slug, r.display); } }}
                          >
                            Re-generate icon
                          </button>
                        </li>
                      </ul>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <nav class="flex gap-2">
      <a href={withBase('/admin')}         class={navLink}>Dashboard</a>
      <a href={withBase('/admin/brands')}  class={navLink}>Brands</a>
      <a href={withBase('/admin/reports')} class={navLink}>Reports</a>
      <a href={withBase('/admin/imports')} class={navLink}>Imports</a>
    </nav>
  </div>
</header>
