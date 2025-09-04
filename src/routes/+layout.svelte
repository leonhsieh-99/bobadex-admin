<script lang="ts">
    import '../app.css';
    import Toaster from '$lib/Toaster.svelte';
    import { navigating } from '$app/stores';
  </script>
  
  <Toaster />
  <slot />

{#if $navigating}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div class="flex flex-col items-center gap-3">
      <div class="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white"></div>
      <p class="text-white/90 text-sm">Updating…</p>
    </div>
  </div>
{/if}