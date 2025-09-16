<script lang="ts">
    import { toasts } from '$lib/toast';
    import { fly, fade } from 'svelte/transition';
  </script>
  
  <div class="fixed inset-0 pointer-events-none z-[1000]">
    <div class="absolute right-4 top-4 flex w-full max-w-sm flex-col gap-2">
      {#each $toasts as t (t.id)}
        <div
          in:fly={{ x: 24, duration: 150 }}
          out:fade={{ duration: 150 }}
          class="pointer-events-auto rounded-xl border p-3 shadow-md backdrop-blur-md
                 bg-white/90 border-zinc-200 text-zinc-900
                 dark:bg-zinc-900/90 dark:border-zinc-800 dark:text-zinc-100"
          role="status"
          aria-live="polite"
        >
          <div class="flex items-start gap-2">
            <div class="mt-0.5 h-2.5 w-2.5 rounded-full
              {t.kind === 'success' ? 'bg-emerald-500' : t.kind === 'error' ? 'bg-red-500' : 'bg-zinc-400'}"></div>
            <p class="text-sm">{t.message}</p>
          </div>
        </div>
      {/each}
    </div>
  </div>
  