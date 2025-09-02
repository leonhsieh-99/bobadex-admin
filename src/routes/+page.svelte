<!-- src/routes/+page.svelte -->
<script lang="ts">
    export let form: { message?: string } | undefined;
</script>

<form method="post" class="space-y-4 max-w-sm">
<div>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
</div>

<div>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required />
</div>

{#if form?.message}
    <p class="text-red-600">{form.message}</p>
{/if}

<button type="submit">Sign in</button>
</form>
  