<!-- src/routes/admin/brands/+page.svelte -->
<script lang="ts">
    import { enhance } from '$app/forms';
    export let data: {
      pending: Array<{ id: number; suggested_name: string; slug: string | null; created_at: string }>;
    };
  </script>
  
  <h2 class="text-xl font-semibold mb-3">Pending Brands</h2>
  
  {#if data.pending.length === 0}
    <p>No pending brands 🎉</p>
  {:else}
    <ul class="space-y-4">
      {#each data.pending as b}
        <li class="border p-3 rounded">
          <div class="font-medium">{b.suggested_name}</div>
          <div class="text-xs text-gray-600">ID {b.id} • {new Date(b.created_at).toLocaleString()}</div>
  
          <form method="post" use:enhance class="mt-2 flex flex-wrap gap-2 items-center">
            <input type="hidden" name="id" value={b.id} />
  
            <input name="force_slug" class="border px-2 py-1 rounded" placeholder="force slug (optional)" />
            <label class="inline-flex items-center gap-1">
              <input type="checkbox" name="generate_icon" />
              <span class="text-sm">generate icon</span>
            </label>
  
            <button formaction="?/verify" class="bg-green-600 text-white px-3 py-1 rounded">Verify</button>
  
            <input name="reason" class="border px-2 py-1 rounded" placeholder="reason (optional)" />
            <button formaction="?/reject" class="bg-red-600 text-white px-3 py-1 rounded">Reject</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
  