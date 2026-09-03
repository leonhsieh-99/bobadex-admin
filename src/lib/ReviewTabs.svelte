<script lang="ts">
	import { page } from '$app/stores';

	export let active: 'candidates' | 'submissions' | 'reports';

	const tabs = [
		{ id: 'candidates', label: 'Storefronts', href: '/admin/reviews' },
		{ id: 'submissions', label: 'Brand submissions', href: '/admin/brands' },
		{ id: 'reports', label: 'Reports', href: '/admin/reports' }
	] as const;
</script>

<nav class="flex gap-1 overflow-x-auto border-b border-gray-200" aria-label="Review sources">
	{#each tabs as tab}
		<a
			class={`shrink-0 border-b-2 px-3 py-2 text-sm ${active === tab.id ? 'border-gray-950 font-semibold text-gray-950' : 'border-transparent text-gray-600 hover:text-gray-950'}`}
			href={tab.href}
		>
			{tab.label}
			{#if tab.id === 'candidates' && ($page.data.manualReviewCount ?? 0) > 0}
				<span class="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{$page.data.manualReviewCount}</span>
			{/if}
		</a>
	{/each}
</nav>
