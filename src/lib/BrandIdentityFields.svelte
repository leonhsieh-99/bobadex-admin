<script lang="ts">
	type IdentityAlias = {
		id: number | null;
		display: string;
		normalized_name: string;
		match_mode: string;
	};

	export let slug: string;
	export let display: string;
	export let website: string;
	export let wikidata: string;
	export let aliases: IdentityAlias[];

	let aliasDraft = '';

	function normalize(value: string) {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');
	}

	function regularAliases() {
		const canonical = normalize(display);
		return aliases.filter((alias) => normalize(alias.display) !== canonical);
	}

	function aliasCount() {
		const normalizedAliases = aliases.map((alias) => normalize(alias.display)).filter(Boolean);
		const canonical = normalize(display);
		if (canonical) normalizedAliases.push(canonical);
		return normalizedAliases.filter((value, index) => normalizedAliases.indexOf(value) === index)
			.length;
	}

	function addAlias() {
		const value = aliasDraft.trim();
		const normalized = normalize(value);
		if (
			!normalized ||
			normalized === normalize(display) ||
			aliases.some((alias) => normalize(alias.display) === normalized)
		)
			return;
		aliases = [
			...aliases,
			{ id: null, display: value, normalized_name: normalized, match_mode: 'exact' }
		];
		aliasDraft = '';
	}

	function removeAlias(alias: IdentityAlias) {
		aliases = aliases.filter((item) => item !== alias);
	}
</script>

<input
	type="hidden"
	name="identity_aliases"
	value={JSON.stringify(aliases.map((alias) => alias.display))}
/>

<section>
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div>
			<h4 class="text-sm font-semibold text-zinc-950">Identity</h4>
			<p class="mt-1 text-xs text-zinc-500">The slug remains unchanged: {slug}</p>
		</div>
		<span class="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
			{aliasCount()} alias{aliasCount() === 1 ? '' : 'es'}
		</span>
	</div>

	<div class="mt-4 grid gap-4 md:grid-cols-2">
		<label class="md:col-span-2">
			<span class="text-xs font-medium text-zinc-600">Canonical display name</span>
			<input
				name="identity_display"
				bind:value={display}
				required
				class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
			/>
			<span class="mt-1 block text-xs text-zinc-500">
				The previous name remains below as an alias until you remove it.
			</span>
		</label>

		<label>
			<span class="text-xs font-medium text-zinc-600">Official website</span>
			<input
				name="identity_website"
				bind:value={website}
				type="url"
				placeholder="https://…"
				class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
			/>
		</label>

		<label>
			<span class="text-xs font-medium text-zinc-600">Wikidata entity</span>
			<input
				name="identity_wikidata"
				bind:value={wikidata}
				placeholder="Q12345"
				class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
			/>
		</label>
	</div>

	<div class="mt-5 border-t border-zinc-200 pt-5">
		<div class="flex items-center justify-between gap-3">
			<h5 class="text-xs font-semibold text-zinc-600 uppercase">Current aliases</h5>
			<span class="text-xs text-zinc-500">Removal is applied when you confirm.</span>
		</div>

		<div class="mt-2 flex flex-wrap gap-2">
			{#if display.trim()}
				<div
					class="inline-flex min-h-8 max-w-full items-center gap-1 rounded border border-zinc-200 bg-zinc-50 py-1 pr-2 pl-2"
				>
					<span class="truncate text-xs font-medium text-zinc-700">{display.trim()}</span>
					<span class="px-1 text-[10px] font-semibold text-zinc-400 uppercase">Canonical</span>
				</div>
			{/if}
			{#each regularAliases() as alias (alias.id ?? `new-${alias.normalized_name}`)}
				<div
					class="inline-flex min-h-8 max-w-full items-center gap-1 rounded border border-zinc-200 bg-zinc-50 py-1 pr-1 pl-2"
				>
					<span class="truncate text-xs font-medium text-zinc-700">{alias.display}</span>
					<button
						type="button"
						onclick={() => removeAlias(alias)}
						class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-700"
						title={`Remove ${alias.display}`}
						aria-label={`Remove alias ${alias.display}`}
					>
						<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" aria-hidden="true">
							<path
								d="M6 6l12 12M18 6 6 18"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</div>
			{/each}
			{#if regularAliases().length === 0}
				<p class="self-center text-sm text-zinc-500">No additional aliases.</p>
			{/if}
		</div>

		<div class="mt-3 flex gap-2">
			<label class="min-w-0 flex-1">
				<span class="sr-only">Add alias</span>
				<input
					bind:value={aliasDraft}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addAlias();
						}
					}}
					placeholder="Add alias"
					class="block h-10 w-full rounded border-zinc-300 text-sm"
				/>
			</label>
			<button
				type="button"
				onclick={addAlias}
				disabled={!aliasDraft.trim()}
				class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
				title="Add alias"
				aria-label="Add alias"
			>
				<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" aria-hidden="true">
					<path
						d="M12 5v14M5 12h14"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
	</div>
</section>
