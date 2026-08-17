<script lang="ts">
	type GeoPlaceResult = {
		place_id: string;
		level: 'country' | 'admin1' | 'metro' | 'city';
		name: string;
		code: string | null;
		display_name: string;
		country_code: string | null;
		country_name: string | null;
		admin1_code: string | null;
		admin1_name: string | null;
		metro_code: string | null;
		metro_name: string | null;
	};

	export let level: GeoPlaceResult['level'];
	export let value = '';
	export let selectedId: string | null = null;
	export let canonicalName = '';
	export let countryCode: string | null = null;
	export let admin1Code: string | null = null;
	export let autoSelectExact = false;
	export let contextKey = '';
	export let onselect: (place: GeoPlaceResult) => void;
	export let onclear: () => void;

	let query = value;
	let results: GeoPlaceResult[] = [];
	let open = false;
	let loading = false;
	let searchError = '';
	let timer: ReturnType<typeof setTimeout> | null = null;
	let requestSequence = 0;
	let activeIndex = -1;
	let lastExternalValue = value;
	let lastAutoResolveKey = '';

	$: if (value !== lastExternalValue) {
		lastExternalValue = value;
		query = value;
	}

	$: {
		const exactName = canonicalName.trim() || value.trim();
		const autoResolveKey = [
			contextKey,
			level,
			exactName.toLocaleLowerCase(),
			countryCode ?? '',
			admin1Code ?? ''
		].join('|');
		if (
			autoSelectExact &&
			!selectedId &&
			exactName.length >= 2 &&
			autoResolveKey !== lastAutoResolveKey
		) {
			lastAutoResolveKey = autoResolveKey;
			void resolveExact(exactName, autoResolveKey);
		}
	}

	function scheduleSearch() {
		if (timer) clearTimeout(timer);
		if (selectedId && query !== value) onclear();
		if (query.trim().length < 2) {
			results = [];
			open = false;
			return;
		}
		timer = setTimeout(search, 180);
	}

	async function search() {
		const sequence = ++requestSequence;
		loading = true;
		searchError = '';
		try {
			const params = new URLSearchParams({ q: query.trim(), level });
			const response = await fetch(`/admin/enrichment/place-search?${params}`);
			if (!response.ok) throw new Error(await response.text());
			const body = (await response.json()) as { places?: GeoPlaceResult[] };
			if (sequence !== requestSequence) return;
			results = body.places ?? [];
			activeIndex = results.length ? 0 : -1;
			open = true;
		} catch {
			if (sequence === requestSequence) {
				results = [];
				searchError = 'Canonical place search is temporarily unavailable.';
				open = true;
			}
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}

	async function resolveExact(exactName: string, autoResolveKey: string) {
		const sequence = ++requestSequence;
		loading = true;
		searchError = '';
		try {
			const params = new URLSearchParams({ q: exactName, level });
			const response = await fetch(`/admin/enrichment/place-search?${params}`);
			if (!response.ok) {
				searchError = 'Canonical place search is temporarily unavailable.';
				return;
			}
			const body = (await response.json()) as { places?: GeoPlaceResult[] };
			if (sequence !== requestSequence || autoResolveKey !== lastAutoResolveKey) return;

			const normalizedName = exactName.trim().toLocaleLowerCase();
			const matches = (body.places ?? []).filter((place) => {
				if (place.name.trim().toLocaleLowerCase() !== normalizedName) return false;
				if (countryCode && place.country_code !== countryCode) return false;
				if (admin1Code && place.admin1_code !== admin1Code) return false;
				return true;
			});
			const canonicalMatches = matches.filter((place) => {
				if (place.level === 'country' && countryCode) return place.code === countryCode;
				if (place.level === 'admin1' && admin1Code) return place.code === admin1Code;
				if (place.level === 'city' && admin1Code) {
					return place.code?.startsWith(`${admin1Code}/city/`) ?? false;
				}
				return false;
			});
			if (canonicalMatches.length === 1) choose(canonicalMatches[0]);
			else if (matches.length === 1) choose(matches[0]);
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}

	function choose(place: GeoPlaceResult) {
		query = place.display_name;
		open = false;
		results = [];
		onselect(place);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open || results.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = (activeIndex + 1) % results.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = (activeIndex - 1 + results.length) % results.length;
		} else if (event.key === 'Enter' && activeIndex >= 0) {
			event.preventDefault();
			choose(results[activeIndex]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="relative">
	<input
		bind:value={query}
		oninput={scheduleSearch}
		onfocus={() => results.length && (open = true)}
		onkeydown={handleKeydown}
		placeholder={level === 'admin1'
			? 'Search state or province'
			: level === 'metro'
				? 'Search metro area'
				: `Search ${level}`}
		aria-label="Canonical market place"
		aria-autocomplete="list"
		aria-expanded={open}
		class="block h-9 w-full rounded border-zinc-300 text-sm"
	/>
	{#if loading}
		<span class="pointer-events-none absolute top-2.5 right-3 text-xs text-zinc-400">…</span>
	{/if}
	{#if open}
		<div
			class="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded border border-zinc-200 bg-white py-1 shadow-lg"
			role="listbox"
		>
			{#each results as place, index}
				<button
					type="button"
					onmousedown={(event) => event.preventDefault()}
					onclick={() => choose(place)}
					class="block w-full px-3 py-2 text-left {index === activeIndex
						? 'bg-blue-50'
						: 'hover:bg-zinc-50'}"
					role="option"
					aria-selected={index === activeIndex}
				>
					<span class="block text-sm font-medium text-zinc-900">{place.display_name}</span>
					<span class="block text-xs text-zinc-500">{place.code ?? place.level}</span>
				</button>
			{/each}
			{#if searchError && !loading}
				<p class="px-3 py-3 text-sm text-red-700">{searchError}</p>
			{:else if results.length === 0 && !loading}
				<p class="px-3 py-3 text-sm text-zinc-500">No canonical places found.</p>
			{/if}
		</div>
	{/if}
</div>
