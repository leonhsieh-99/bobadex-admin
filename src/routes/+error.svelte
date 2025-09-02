<!-- src/routes/+error.svelte -->
<script lang="ts">
  export let status: number;
  export let error: App.Error;
</script>

<svelte:head>
  <title>{status} — {status === 403 ? 'Forbidden' : 'Error'}</title>
</svelte:head>

<div class="min-h-screen grid place-items-center p-6">
  <div class="max-w-md w-full border rounded-xl p-6">
    <h1 class="text-2xl font-semibold mb-2">{status}</h1>
    <p class="mb-4">
      {#if status === 403}
        You don’t have permission to view this page.
      {:else}
        {error?.message ?? 'Something went wrong.'}
      {/if}
    </p>
    <a class="underline" href={status === 403 ? '/login' : '/'}>Go back</a>
  </div>
</div>
