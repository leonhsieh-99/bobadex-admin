<script lang="ts">
	import {
		brandMatchPolicies,
		brandMatchPolicyDescription,
		brandMatchPolicyLabel,
		type BrandMatchPolicy
	} from '$lib/brand-match-policy';

	export let value: BrandMatchPolicy;
	export let name = 'identity_match_policy';
	export let label = 'Match policy';
	export let recommendation: BrandMatchPolicy | null = null;
	export let disabled = false;
</script>

<label class="block">
	<span class="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-600">
		{label}
		{#if recommendation}
			<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
				Recommended: {brandMatchPolicyLabel(recommendation)}
			</span>
		{/if}
	</span>
	<select
		{name}
		bind:value
		{disabled}
		required
		class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm disabled:bg-zinc-100 disabled:text-zinc-500"
	>
		{#each brandMatchPolicies as policy}
			<option value={policy}>{brandMatchPolicyLabel(policy)}</option>
		{/each}
	</select>
	<span class="mt-1 block text-xs text-zinc-500">{brandMatchPolicyDescription(value)}</span>
</label>
