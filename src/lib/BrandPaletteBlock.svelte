<script lang="ts">
	import {
		topicCoverageClass,
		topicCoverageLabel,
		type BrandPalette
	} from '$lib/enrichment-dossier';

	export let palette: BrandPalette | null;
</script>

<div class="mt-2.5 border-l border-zinc-200 pl-3">
	<div class="flex items-center justify-between gap-3">
		<p class="text-xs font-medium text-zinc-800">Color scheme</p>
		{#if palette}
			<span class="rounded px-2 py-0.5 text-xs font-medium {topicCoverageClass(palette.coverage)}">
				{topicCoverageLabel(palette.coverage)}
			</span>
		{:else}
			<span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600"
				>not captured</span
			>
		{/if}
	</div>
	{#if !palette}
		<p class="mt-1 text-xs leading-5 text-zinc-500">
			This run predates color-scheme capture. Rerun enrichment to populate a palette under visual
			identity.
		</p>
	{:else if palette.colors.length}
		<ul class="mt-2 space-y-1.5">
			{#each palette.colors as color}
				<li class="flex items-center gap-2">
					<span
						class="h-4 w-4 shrink-0 rounded border border-zinc-200"
						style={color.approx_hex
							? `background-color: ${color.approx_hex}`
							: 'background-color: #e4e4e7'}
						title={color.approx_hex ?? color.name}
					></span>
					<p class="min-w-0 text-xs leading-5 text-zinc-700">
						<span class="font-medium text-zinc-800">{color.name}</span>
						<span class="text-zinc-500">
							· {color.role}{color.approx_hex ? ` · ${color.approx_hex}` : ''}
						</span>
					</p>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-1 text-xs leading-5 text-zinc-500">
			No stable color scheme was established from sourced visual identity.
		</p>
	{/if}
</div>
