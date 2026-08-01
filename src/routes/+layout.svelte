<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import Toaster from '$lib/Toaster.svelte';
	import AdminHeader from '$lib/AdminHeader.svelte';
	import { navigating } from '$app/stores';
</script>

{#if $page.url.pathname.startsWith('/admin')}
	<AdminHeader
		reviewCount={$page.data.manualReviewCount ?? 0}
		enrichmentCount={$page.data.enrichmentReviewCount ?? 0}
		imageCount={$page.data.imageReviewCount ?? 0}
	/>
{/if}

<slot />
<Toaster />

{#if $navigating}
	<div class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-blue-100" aria-label="Loading">
		<div class="h-full w-1/2 animate-pulse bg-blue-600"></div>
	</div>
{/if}
