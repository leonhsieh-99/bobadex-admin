<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import BrandIdentityFields from '$lib/BrandIdentityFields.svelte';
	import BrandMatchPolicyField from '$lib/BrandMatchPolicyField.svelte';
	import BrandMergeDialog from '$lib/BrandMergeDialog.svelte';
	import type { BrandMatchPolicy } from '$lib/brand-match-policy';
	import { coordinatesLabel, googleMapsCoordinatesUrl } from '$lib/maps';
	import { toasts } from '$lib/toast';
	import type { SubmitFunction } from './$types';

	type BrandStatus = 'active' | 'retired' | 'merged';
	type BrandEnrichmentMode = 'auto' | 'manual_only' | 'disabled';
	type CatalogSort = 'attention' | 'node_count' | 'display' | 'created_at';
	type CatalogSortDir = 'asc' | 'desc';
	type Brand = {
		slug: string;
		display: string;
		website: string | null;
		wikidata: string | null;
		logo_url: string | null;
		icon_path: string | null;
		created_at: string;
		status: BrandStatus;
		closed_at: string | null;
		is_demo: boolean;
		alias_count: number;
		region_codes: string[];
		shop_count: number;
		node_count: number;
		location_count: number;
		manual_location_count: number;
		location_review_count: number;
		profile_state: string;
		profile_summary: string | null;
		profile_confidence: number | null;
		dossier_status: string | null;
		refresh_after: string | null;
		open_flag_count: number;
		last_activity_at: string;
		total_count: number;
		enrichment_mode: BrandEnrichmentMode;
	};
	type Detail = {
		match_policy: BrandMatchPolicy;
		enrichment_mode: BrandEnrichmentMode;
		redirect: {
			target_slug: string;
			target_display: string;
			merged_at: string | null;
		} | null;
		aliases: IdentityAlias[];
		regions: Array<{
			region_code: string;
			source: string;
			confidence: string;
			first_seen_at: string;
			last_seen_at: string;
		}>;
		sources: Array<{ id: number; source: string; source_key: string; created_at: string }>;
		osm_locations: Array<{
			id: string;
			name: string | null;
			source: string | null;
			source_key: string | null;
			lat: number | null;
			lon: number | null;
			region_key: string | null;
			matched_brand_slug: string | null;
			process_status: string;
			observation_status: 'attached' | 'match_review' | 'unattached' | 'identity_changed';
			status_reason: string | null;
			physical_location_id: string | null;
		}>;
		physical_locations: Array<{
			id: string;
			lat: number;
			lon: number;
			physical_status: 'active' | 'needs_review' | 'retired';
			possible_match_location_id: string | null;
			geocode_status: string;
			geocode_error: string | null;
			city: string | null;
			county: string | null;
			region: string | null;
			first_seen_at: string;
			last_seen_at: string;
			evidence: Array<{
				id: string;
				source: string;
				source_key: string;
				osm_type: string | null;
				osm_id: number | null;
				lat: number;
				lon: number;
				address_input: string | null;
				source_url: string | null;
				source_note: string | null;
				verification_status: string | null;
				match_status: string;
				match_distance_m: number | null;
			}>;
		}>;
		profile: {
			summary: string;
			summary_confidence: number | null;
			publication_method: string;
			published_at: string;
		} | null;
		dossier: {
			approval_status: string;
			review_reasons: string[];
			last_researched_at: string | null;
			refresh_after: string | null;
			recommended_match_policy: BrandMatchPolicy;
		} | null;
		integrity_flags: Array<{
			id: string;
			severity: string;
			status: string;
			title: string;
			details: Record<string, unknown>;
			recommended_action: string | null;
			last_seen_at: string;
		}>;
		recent_activity: Array<{
			action: string;
			actor: string | null;
			meta: Record<string, unknown> | null;
			created_at: string;
		}>;
	};
	type OsmLocation = Detail['osm_locations'][number];
	type PhysicalLocation = Detail['physical_locations'][number];
	type LocationEvidence = PhysicalLocation['evidence'][number];
	type IdentityAlias = {
		id: number;
		normalized_name: string;
		alias_display: string | null;
		match_mode: string;
		created_at: string;
		display?: string;
	};

	export let data: {
		brands: Brand[];
		regions: Array<{ code: string; country_code: string; region_name: string }>;
		filters: {
			q: string;
			status: string;
			region: string;
			attentionOnly: boolean;
			sort: CatalogSort;
			sortDir: CatalogSortDir;
		};
		pagination: { page: number; pageSize: number; total: number; pageCount: number };
	};

	let query = data.filters.q;
	let queryTimer: ReturnType<typeof setTimeout> | null = null;
	let expandedSlug = '';
	let details: Record<string, Detail> = {};
	let detailErrors: Record<string, string> = {};
	let detailLoading = '';
	let editBrand: Brand | null = null;
	let identityDisplay = '';
	let identityWebsite = '';
	let identityWikidata = '';
	let identityNote = '';
	let identityMatchPolicy: BrandMatchPolicy = 'corroboration_required';
	let originalIdentityMatchPolicy: BrandMatchPolicy = 'corroboration_required';
	let identityEnrichmentMode: BrandEnrichmentMode = 'auto';
	let originalIdentityEnrichmentMode: BrandEnrichmentMode = 'auto';
	let identityHasAliasDraft = false;
	let identityAliases: Array<{
		id: number | null;
		display: string;
		normalized_name: string;
		match_mode: string;
	}> = [];
	let originalIdentityAliases: string[] = [];
	let identityRegions: string[] = [];
	let originalIdentityRegions: string[] = [];
	let identityRegionDraft = '';
	let identityIsChanged = false;
	let manualLocationBrand: Brand | null = null;
	let manualLocationInputKind: 'coordinates' | 'address' = 'coordinates';
	let manualLocationLat = '';
	let manualLocationLon = '';
	let manualLocationAddress = '';
	let manualLocationSourceUrl = '';
	let manualLocationNote = '';
	let manualLocationVerification: 'verified' | 'needs_review' | 'unverified' = 'verified';
	let statusBrand: Brand | null = null;
	let mergeBrand: Brand | null = null;
	let deletingBrand: Brand | null = null;
	let nodeRepair: { brand: Brand; location: OsmLocation } | null = null;
	let manualEvidenceRemoval: {
		brand: Brand;
		location: PhysicalLocation;
		evidence: LocationEvidence;
	} | null = null;
	let manualEvidenceRemovalReason = '';
	let nodeDisposition: 'remove' | 'create_brand' = 'remove';
	let nodeNewDisplay = '';
	let nodeIdentityBasis = '';
	let nodeMarket = '';
	let nodeMarketRole: 'include' | 'prefer' | 'exclude' = 'include';
	let nodeLocationObservation = '';
	let nodeLocationRole: 'include' | 'prefer' | 'exclude' = 'prefer';
	let nodeResearchUrl = '';
	let nodeUrlRole: 'include' | 'prefer' | 'exclude' = 'include';
	let nodeIdentityVerified = false;
	let nodeRepairReason = '';
	let statusNote = '';
	let deleteConfirmation = '';
	let deleteNote = '';
	let modalError = '';
	let pendingAction = '';

	const number = new Intl.NumberFormat('en-US');

	$: identityIsChanged = detectIdentityChanges(
		editBrand,
		identityDisplay,
		identityWebsite,
		identityWikidata,
		identityAliases,
		originalIdentityAliases,
		identityRegions,
		originalIdentityRegions,
		identityMatchPolicy,
		originalIdentityMatchPolicy,
		identityEnrichmentMode,
		originalIdentityEnrichmentMode
	);

	function catalogUrl(overrides: Record<string, string | number | boolean | null> = {}) {
		const values = {
			q: data.filters.q,
			status: data.filters.status,
			region: data.filters.region,
			attention: data.filters.attentionOnly,
			sort: data.filters.sort,
			dir: data.filters.sortDir,
			page: data.pagination.page,
			...overrides
		};
		const params = new URLSearchParams();
		if (String(values.q ?? '').trim()) params.set('q', String(values.q).trim());
		if (values.status) params.set('status', String(values.status));
		if (values.region) params.set('region', String(values.region));
		if (values.attention) params.set('attention', '1');
		if (values.sort && values.sort !== 'display') params.set('sort', String(values.sort));
		if (values.dir && !(values.sort === 'display' && values.dir === 'asc')) {
			params.set('dir', String(values.dir));
		}
		if (Number(values.page) > 1) params.set('page', String(values.page));
		return `/admin/brands/catalog${params.size ? `?${params}` : ''}`;
	}

	function updateFilters(overrides: Record<string, string | number | boolean | null>) {
		return goto(catalogUrl({ ...overrides, page: 1 }), { keepFocus: true, noScroll: true });
	}

	function scheduleSearch() {
		if (queryTimer) clearTimeout(queryTimer);
		queryTimer = setTimeout(() => void updateFilters({ q: query }), 250);
	}

	async function toggleDetails(slug: string) {
		if (expandedSlug === slug) {
			expandedSlug = '';
			return;
		}
		expandedSlug = slug;
		if (details[slug]) return;
		await loadBrandDetails(slug);
	}

	async function resolvePhysicalLocation(
		brandSlug: string,
		locationId: string,
		resolution: 'attach_to_suggested' | 'keep_separate'
	) {
		pendingAction = `resolveLocation:${locationId}`;
		try {
			const response = await fetch(`/admin/brands/catalog/${encodeURIComponent(brandSlug)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ location_id: locationId, resolution })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) throw new Error(payload?.message ?? 'Could not resolve the storefront match.');
			toasts.success(
				resolution === 'attach_to_suggested'
					? 'Evidence attached to the existing storefront.'
					: 'Kept as a separate storefront.'
			);
			await loadBrandDetails(brandSlug);
			await invalidateAll();
		} catch (error) {
			toasts.error(error instanceof Error ? error.message : 'Could not resolve the storefront match.');
		} finally {
			pendingAction = '';
		}
	}

	async function removeManualEvidence() {
		if (!manualEvidenceRemoval || !manualEvidenceRemovalReason.trim()) return;
		const { brand, evidence } = manualEvidenceRemoval;
		pendingAction = `removeManualEvidence:${evidence.id}`;
		modalError = '';
		try {
			const response = await fetch(`/admin/brands/catalog/${encodeURIComponent(brand.slug)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					action: 'remove_manual_evidence',
					evidence_id: evidence.id,
					reason: manualEvidenceRemovalReason.trim()
				})
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) throw new Error(payload?.message ?? 'Could not remove manual evidence.');
			toasts.success('Manual location evidence removed.');
			manualEvidenceRemoval = null;
			manualEvidenceRemovalReason = '';
			await loadBrandDetails(brand.slug);
			await invalidateAll();
		} catch (error) {
			modalError = error instanceof Error ? error.message : 'Could not remove manual evidence.';
			toasts.error(modalError);
		} finally {
			pendingAction = '';
		}
	}

	async function loadBrandDetails(slug: string) {
		detailLoading = slug;
		detailErrors = { ...detailErrors, [slug]: '' };
		try {
			const response = await fetch(`/admin/brands/catalog/${encodeURIComponent(slug)}`);
			if (!response.ok) throw new Error(await response.text());
			details = { ...details, [slug]: await response.json() };
		} catch (error) {
			detailErrors = {
				...detailErrors,
				[slug]: error instanceof Error ? error.message : 'Could not load brand details.'
			};
		} finally {
			detailLoading = '';
		}
	}

	async function copySlug(slug: string) {
		try {
			await navigator.clipboard.writeText(slug);
			toasts.success(`Copied ${slug}`);
		} catch {
			toasts.error('Could not copy slug');
		}
	}

	function actionEnhance(action: string): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = action;
			modalError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The action could not be completed.';

				if (result.type === 'success') {
					toasts.success(message);
					closeModal();
					details = {};
					expandedSlug = '';
					await invalidateAll();
					return;
				}
				modalError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function manualLocationEnhance(): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = 'createManualLocation';
			modalError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The location could not be created.';

				if (result.type === 'success') {
					const brandSlug = manualLocationBrand?.slug;
					toasts.success(message);
					closeManualLocation();
					if (brandSlug) await loadBrandDetails(brandSlug);
					return;
				}
				modalError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function openManualLocation(brand: Brand | null) {
		if (!brand) return;
		manualLocationBrand = brand;
		manualLocationInputKind = 'coordinates';
		manualLocationLat = '';
		manualLocationLon = '';
		manualLocationAddress = '';
		manualLocationSourceUrl = '';
		manualLocationNote = '';
		manualLocationVerification = 'verified';
		modalError = '';
	}

	function closeManualLocation() {
		manualLocationBrand = null;
		manualLocationLat = '';
		manualLocationLon = '';
		manualLocationAddress = '';
		manualLocationSourceUrl = '';
		manualLocationNote = '';
		modalError = '';
	}

	function closeModal() {
		editBrand = null;
		identityDisplay = '';
		identityWebsite = '';
		identityWikidata = '';
		identityNote = '';
		identityMatchPolicy = 'corroboration_required';
		originalIdentityMatchPolicy = 'corroboration_required';
		identityEnrichmentMode = 'auto';
		originalIdentityEnrichmentMode = 'auto';
		identityHasAliasDraft = false;
		identityAliases = [];
		originalIdentityAliases = [];
		identityRegions = [];
		originalIdentityRegions = [];
		identityRegionDraft = '';
		manualLocationBrand = null;
		statusBrand = null;
		mergeBrand = null;
		deletingBrand = null;
		nodeRepair = null;
		manualEvidenceRemoval = null;
		manualEvidenceRemovalReason = '';
		nodeDisposition = 'remove';
		nodeNewDisplay = '';
		nodeIdentityBasis = '';
		nodeMarket = '';
		nodeMarketRole = 'include';
		nodeLocationObservation = '';
		nodeLocationRole = 'prefer';
		nodeResearchUrl = '';
		nodeUrlRole = 'include';
		nodeIdentityVerified = false;
		nodeRepairReason = '';
		statusNote = '';
		deleteConfirmation = '';
		deleteNote = '';
		modalError = '';
	}

	function openNodeRepair(brand: Brand, location: OsmLocation) {
		nodeRepair = { brand, location };
		nodeDisposition = 'remove';
		nodeNewDisplay = location.name?.trim() || brand.display;
		nodeIdentityBasis = '';
		nodeMarket = '';
		nodeMarketRole = 'include';
		nodeLocationObservation = '';
		nodeLocationRole = 'prefer';
		nodeResearchUrl = '';
		nodeUrlRole = 'include';
		nodeIdentityVerified = false;
		nodeRepairReason = '';
		modalError = '';
	}

	function openNodeRepairForEvidence(brand: Brand, detail: Detail, evidence: LocationEvidence) {
		const candidate = detail.osm_locations.find(
			(location) =>
				location.source === evidence.source && location.source_key === evidence.source_key
		);
		if (!candidate) {
			toasts.error('The OSM candidate for this evidence could not be found.');
			return;
		}
		openNodeRepair(brand, candidate);
	}

	function openManualEvidenceRemoval(
		brand: Brand,
		location: PhysicalLocation,
		evidence: LocationEvidence
	) {
		manualEvidenceRemoval = { brand, location, evidence };
		manualEvidenceRemovalReason = '';
		modalError = '';
	}

	function openIdentityEditor(brand: Brand, detail: Detail) {
		editBrand = brand;
		identityDisplay = brand.display;
		identityWebsite = brand.website ?? '';
		identityWikidata = brand.wikidata ?? '';
		identityNote = '';
		identityAliases = detail.aliases.map((alias) => ({
			id: alias.id,
			display: alias.alias_display ?? alias.normalized_name,
			normalized_name: alias.normalized_name,
			match_mode: alias.match_mode
		}));
		originalIdentityAliases = identityAliases.map((alias) => alias.display);
		identityRegions = detail.regions.map((region) => region.region_code).sort();
		originalIdentityRegions = [...identityRegions];
		identityRegionDraft = '';
		identityMatchPolicy = detail.match_policy;
		originalIdentityMatchPolicy = detail.match_policy;
		identityEnrichmentMode = detail.enrichment_mode;
		originalIdentityEnrichmentMode = detail.enrichment_mode;
		modalError = '';
	}

	function detectIdentityChanges(
		brand: Brand | null,
		display: string,
		website: string,
		wikidata: string,
		aliases: Array<{ display: string }>,
		originalAliases: string[],
		manualRegions: string[],
		originalManualRegions: string[],
		matchPolicy: BrandMatchPolicy,
		originalMatchPolicy: BrandMatchPolicy,
		enrichmentMode: BrandEnrichmentMode,
		originalEnrichmentMode: BrandEnrichmentMode
	) {
		if (!brand) return false;
		return (
			display.trim() !== brand.display ||
			website.trim() !== (brand.website ?? '') ||
			wikidata.trim() !== (brand.wikidata ?? '') ||
			JSON.stringify([...manualRegions].sort()) !==
				JSON.stringify([...originalManualRegions].sort()) ||
			matchPolicy !== originalMatchPolicy ||
			enrichmentMode !== originalEnrichmentMode ||
			JSON.stringify(aliases.map((alias) => alias.display)) !== JSON.stringify(originalAliases)
		);
	}

	function addIdentityRegion() {
		const code = identityRegionDraft.trim();
		if (!code || identityRegions.includes(code)) return;
		identityRegions = [...identityRegions, code].sort();
		identityRegionDraft = '';
	}

	function removeIdentityRegion(code: string) {
		identityRegions = identityRegions.filter((region) => region !== code);
	}

	function regionLabel(code: string) {
		const region = data.regions.find((candidate) => candidate.code === code);
		return region ? `${region.region_name} (${region.code})` : code;
	}

	function regionSourceLabel(code: string) {
		const source = details[editBrand?.slug ?? '']?.regions.find(
			(region) => region.region_code === code
		)?.source;
		if (!source || source === 'admin.identity') return 'Admin';
		if (source.startsWith('osm')) return 'OSM';
		return 'Derived';
	}

	function relativeDate(value: string | null) {
		if (!value) return 'Unknown';
		const elapsed = Date.now() - new Date(value).getTime();
		const days = Math.max(0, Math.floor(elapsed / 86_400_000));
		if (days === 0) return 'Today';
		if (days === 1) return 'Yesterday';
		if (days < 30) return `${days}d ago`;
		return new Date(value).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function initials(display: string) {
		return display
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0])
			.join('')
			.toUpperCase();
	}

	function profileLabel(state: string) {
		return (
			{
				published: 'Published',
				refresh_due: 'Refresh due',
				needs_review: 'Needs review',
				approved: 'Approved',
				rejected: 'Rejected',
				draft: 'Draft',
				missing: 'Missing'
			}[state] ?? state.replaceAll('_', ' ')
		);
	}

	function profileClasses(state: string) {
		if (state === 'published') return 'bg-emerald-50 text-emerald-700';
		if (state === 'needs_review' || state === 'refresh_due') return 'bg-amber-50 text-amber-800';
		if (state === 'rejected') return 'bg-red-50 text-red-700';
		return 'bg-zinc-100 text-zinc-700';
	}

	function wikidataUrl(value: string) {
		return /^Q\d+$/i.test(value) ? `https://www.wikidata.org/wiki/${value}` : value;
	}
</script>

<svelte:head><title>Brand Catalog | Bobadex Admin</title></svelte:head>
<svelte:window onkeydown={(event) => event.key === 'Escape' && closeModal()} />

<main class="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6">
	<header
		class="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end"
	>
		<div>
			<p class="text-xs font-semibold text-zinc-500 uppercase">Canonical inventory</p>
			<h1 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Brands</h1>
			<p class="mt-2 max-w-2xl text-sm text-zinc-600">
				Inspect identity, footprint, publication health, and lifecycle status across the catalog.
			</p>
		</div>
		<div class="flex items-baseline gap-2">
			<strong class="text-2xl text-zinc-950">{number.format(data.pagination.total)}</strong>
			<span class="text-sm text-zinc-500">canonical brands</span>
		</div>
	</header>

	<nav
		class="flex gap-1 overflow-x-auto border-b border-zinc-200"
		aria-label="Brand administration"
	>
		<a
			href="/admin/brands/catalog"
			class="shrink-0 border-b-2 border-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-950"
			>Catalog</a
		>
		<a
			href="/admin/brands"
			class="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:text-zinc-950"
			>Submissions and requests</a
		>
		<a
			href="/admin/enrichment"
			class="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:text-zinc-950"
			>Enrichment</a
		>
		<a
			href="/admin/image-gen"
			class="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-zinc-600 hover:text-zinc-950"
			>Image Gen</a
		>
	</nav>

	<section class="sticky top-[65px] z-30 border-y border-zinc-200 bg-white/95 py-3 backdrop-blur">
		<div class="grid gap-2 md:grid-cols-[minmax(240px,1fr)_160px_200px_160px_120px_auto]">
			<label class="relative block">
				<span class="sr-only">Search brands</span>
				<svg
					class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-zinc-400"
					viewBox="0 0 24 24"
					fill="none"
					aria-hidden="true"
					><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" /><path
						d="m20 20-4-4"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/></svg
				>
				<input
					bind:value={query}
					oninput={scheduleSearch}
					placeholder="Search brand, slug, or alias"
					class="h-10 w-full rounded border-zinc-300 pr-3 pl-9 text-sm focus:border-zinc-500 focus:ring-zinc-500"
				/>
			</label>
			<select
				value={data.filters.status}
				onchange={(event) => updateFilters({ status: event.currentTarget.value })}
				class="h-10 rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
				aria-label="Brand status"
			>
				<option value="">All statuses</option>
				<option value="active">Active</option>
				<option value="retired">Retired</option>
				<option value="merged">Merged</option>
			</select>
			<select
				value={data.filters.region}
				onchange={(event) => updateFilters({ region: event.currentTarget.value })}
				class="h-10 rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
				aria-label="Brand region"
			>
				<option value="">All regions</option>
				{#each data.regions as region}<option value={region.code}
						>{region.region_name} ({region.code})</option
					>{/each}
			</select>
			<select
				value={data.filters.sort}
				onchange={(event) => updateFilters({ sort: event.currentTarget.value })}
				class="h-10 rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
				aria-label="Sort by"
			>
				<option value="node_count">OSM node count</option>
				<option value="attention">Needs attention</option>
				<option value="display">Name</option>
				<option value="created_at">Created</option>
			</select>
			<select
				value={data.filters.sortDir}
				onchange={(event) => updateFilters({ dir: event.currentTarget.value })}
				class="h-10 rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
				aria-label="Sort direction"
			>
				<option value="desc">Desc</option>
				<option value="asc">Asc</option>
			</select>
			<label
				class="inline-flex h-10 items-center gap-2 rounded border border-zinc-300 px-3 text-sm text-zinc-700"
			>
				<input
					type="checkbox"
					checked={data.filters.attentionOnly}
					onchange={(event) => updateFilters({ attention: event.currentTarget.checked })}
					class="rounded border-zinc-300 text-zinc-950 focus:ring-zinc-500"
				/>
				Needs attention
			</label>
		</div>
	</section>

	<section class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
		<div class="overflow-x-auto">
			<table class="w-full min-w-[1160px] table-fixed text-left text-sm">
				<colgroup
					><col class="w-10" /><col class="w-72" /><col class="w-28" /><col class="w-44" /><col
						class="w-24"
					/><col class="w-24" /><col class="w-36" /><col class="w-24" /><col class="w-32" /><col
						class="w-28"
					/></colgroup
				>
				<thead class="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 uppercase">
					<tr
						><th class="px-3 py-3"></th><th class="px-3 py-3 font-medium">Brand</th><th
							class="px-3 py-3 font-medium">Status</th
						><th class="px-3 py-3 font-medium">Regions</th><th class="px-3 py-3 font-medium"
							>Locations</th
						><th class="px-3 py-3 font-medium">Nodes</th><th class="px-3 py-3 font-medium"
							>Identity</th
						><th class="px-3 py-3 font-medium">Profile</th><th class="px-3 py-3 font-medium"
							>Integrity</th
						><th class="px-3 py-3 font-medium">Updated</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-100">
					{#each data.brands as brand}
						<tr class="align-middle hover:bg-zinc-50/70">
							<td class="px-3 py-3">
								<button
									type="button"
									onclick={() => toggleDetails(brand.slug)}
									class="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
									title={expandedSlug === brand.slug ? 'Collapse details' : 'Expand details'}
									aria-label={expandedSlug === brand.slug
										? `Collapse ${brand.display} details`
										: `Expand ${brand.display} details`}
									aria-expanded={expandedSlug === brand.slug}
								>
									<svg
										class="h-4 w-4 transition-transform {expandedSlug === brand.slug
											? 'rotate-90'
											: ''}"
										viewBox="0 0 24 24"
										fill="none"
										aria-hidden="true"
										><path
											d="m9 18 6-6-6-6"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										/></svg
									>
								</button>
							</td>
							<td class="px-3 py-3">
								<div class="flex min-w-0 items-center gap-3">
									<div
										class="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600"
									>
										{initials(brand.display)}
									</div>
									<div class="min-w-0">
										<p class="truncate font-semibold text-zinc-950">{brand.display}</p>
										<div class="mt-0.5 flex items-center gap-1">
											<code class="truncate text-[11px] text-zinc-500">{brand.slug}</code><button
												type="button"
												onclick={() => copySlug(brand.slug)}
												class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
												title="Copy slug"
												aria-label={`Copy ${brand.slug} slug`}
												><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"
													><rect
														x="8"
														y="8"
														width="11"
														height="11"
														rx="2"
														stroke="currentColor"
														stroke-width="2"
													/><path
														d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
														stroke="currentColor"
														stroke-width="2"
													/></svg
												></button
											>
										</div>
									</div>
								</div>
							</td>
							<td class="px-3 py-3"
								><span
									class="rounded px-2 py-1 text-xs font-medium {brand.status === 'active'
										? 'bg-emerald-50 text-emerald-700'
										: brand.status === 'merged'
											? 'bg-blue-50 text-blue-700'
											: 'bg-zinc-200 text-zinc-700'}">{brand.status}</span
								>{#if brand.is_demo}<span
										class="ml-1 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">demo</span
									>{/if}
								<p
									class="mt-2 text-[11px] font-medium {brand.enrichment_mode === 'auto'
										? 'text-emerald-700'
										: brand.enrichment_mode === 'manual_only'
											? 'text-amber-700'
											: 'text-red-700'}"
								>
									{brand.enrichment_mode === 'auto'
										? 'Auto enrichment'
										: brand.enrichment_mode === 'manual_only'
											? 'Manual enrichment'
											: 'Enrichment disabled'}
								</p></td
							>
							<td class="px-3 py-3"
								><div class="flex flex-wrap gap-1">
									{#each brand.region_codes.slice(0, 2) as region}<span
											class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{region}</span
										>{/each}{#if brand.region_codes.length > 2}<span class="text-xs text-zinc-500"
											>+{brand.region_codes.length - 2}</span
										>{/if}{#if brand.region_codes.length === 0}<span class="text-zinc-400"
											>None</span
										>{/if}
								</div></td
							>
			<td class="px-3 py-3"
								><strong class="font-medium text-zinc-900">{brand.location_count}</strong
								>{#if brand.location_count === 0}<span class="ml-1 text-xs text-amber-700">none</span
									>{/if}
								<p class="mt-1 text-[11px] text-zinc-500">
									{brand.manual_location_count} manual · {brand.shop_count} user shops
								</p>
								{#if brand.location_review_count > 0}<p class="mt-0.5 text-[11px] font-medium text-amber-700"
									>{brand.location_review_count} match review</p
								>{/if}</td
							>
							<td class="px-3 py-3"
								><strong class="font-medium text-zinc-900">{brand.node_count}</strong
								>{#if brand.node_count === 0}<span class="ml-1 text-xs text-amber-700">none</span
									>{/if}</td
							>
							<td class="px-3 py-3"
								><div class="flex items-center gap-2">
									{#if brand.website}<a
											href={brand.website}
											target="_blank"
											rel="noreferrer"
											class="font-medium text-blue-700 hover:underline">Web</a
										>{:else}<span class="text-zinc-400">Web</span>{/if}<span class="text-zinc-300"
										>·</span
									>{#if brand.wikidata}<a
											href={wikidataUrl(brand.wikidata)}
											target="_blank"
											rel="noreferrer"
											class="font-medium text-blue-700 hover:underline">WD</a
										>{:else}<span class="text-zinc-400">WD</span>{/if}
								</div>
								<p class="mt-1 text-[11px] text-zinc-500">{brand.alias_count} aliases</p></td
							>
							<td class="px-3 py-3"
								><span
									class="rounded px-2 py-1 text-xs font-medium {profileClasses(
										brand.profile_state
									)}">{profileLabel(brand.profile_state)}</span
								></td
							>
							<td class="px-3 py-3"
								>{#if brand.open_flag_count}<span
										class="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
										>{brand.open_flag_count} open</span
									>{:else}<span class="text-xs text-zinc-500">Clear</span>{/if}</td
							>
							<td class="px-3 py-3 text-xs text-zinc-500">{relativeDate(brand.last_activity_at)}</td
							>
						</tr>
						{#if expandedSlug === brand.slug}
							<tr>
								<td colspan="10" class="bg-zinc-50 px-5 py-5">
									{#if detailLoading === brand.slug}<p class="text-sm text-zinc-500">
											Loading brand details…
										</p>
									{:else if detailErrors[brand.slug]}<p class="text-sm text-red-700">
											{detailErrors[brand.slug]}
										</p>
									{:else if details[brand.slug]}
										{@const detail = details[brand.slug]}
										{#if detail.redirect}
											<div class="mb-5 border-l-2 border-blue-500 bg-blue-50 px-4 py-3">
												<p class="text-sm font-semibold text-blue-950">
													Redirects to {detail.redirect.target_display}
												</p>
												<p class="mt-1 text-xs text-blue-800">
													<code>{detail.redirect.target_slug}</code>
													{#if detail.redirect.merged_at}
														· merged {relativeDate(detail.redirect.merged_at)}
													{/if}
												</p>
											</div>
										{/if}
										<div class="grid gap-6 xl:grid-cols-[1fr_1fr_1.2fr]">
											<div class="space-y-5">
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">Aliases</h3>
													<div class="mt-2 flex flex-wrap gap-2">
														{#each detail.aliases as alias}<span
																class="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
																title={alias.normalized_name}
																>{alias.alias_display ?? alias.normalized_name}<span
																	class="ml-1 text-zinc-400">· {alias.match_mode}</span
																></span
															>{/each}{#if detail.aliases.length === 0}<p
																class="text-sm text-zinc-500"
															>
																No aliases.
															</p>{/if}
													</div>
												</section>
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">Regions</h3>
													<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
														{#each detail.regions as region}<div
																class="flex items-center justify-between gap-3 py-2 text-sm"
															>
																<span class="font-medium text-zinc-900">{region.region_code}</span
																><span class="text-xs text-zinc-500"
																	>{region.confidence} · {region.source}</span
																>
															</div>{/each}{#if detail.regions.length === 0}<p
																class="py-2 text-sm text-zinc-500"
															>
																No region footprint.
															</p>{/if}
													</div>
												</section>
											</div>
											<div class="space-y-5">
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">
														Published profile
													</h3>
													{#if detail.profile}<p class="mt-2 text-sm leading-6 text-zinc-700">
															{detail.profile.summary}
														</p>
														<p class="mt-1 text-xs text-zinc-500">
															{detail.profile.publication_method} · {detail.profile
																.summary_confidence == null
																? 'unknown confidence'
																: `${Math.round(detail.profile.summary_confidence * 100)}% confidence`}
														</p>{:else}<p class="mt-2 text-sm text-zinc-500">
															No published profile.
														</p>{/if}
												</section>
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">Other sources</h3>
													<div class="mt-2 space-y-1">
														{#each detail.sources.filter((source) => source.source !== 'osm').slice(0, 8) as source}<p
																class="truncate text-xs text-zinc-600"
															>
																<span class="font-medium">{source.source}</span>: {source.source_key}
															</p>{/each}{#if detail.sources.filter((source) => source.source !== 'osm').length === 0}<p
																class="text-sm text-zinc-500"
															>
																No other canonical sources.
															</p>{/if}
													</div>
												</section>
											<section>
												<div class="flex items-center justify-between gap-3">
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">
														Locations · {detail.physical_locations.length}
													</h3>
													<button
														type="button"
														onclick={() => openManualLocation(brand)}
														disabled={brand.status === 'merged' || brand.is_demo}
														class="rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
													>Add location</button>
												</div>
												<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
													{#each detail.physical_locations as location (location.id)}
														<div class="py-3">
															<div class="flex items-start justify-between gap-3">
															<div class="min-w-0">
																<p class="mb-0.5 font-mono text-[10px] text-zinc-400">Location {location.id.slice(0, 8)}</p>
																	<a href={googleMapsCoordinatesUrl(location.lat, location.lon)} target="_blank" rel="noreferrer" class="text-xs font-medium text-zinc-800 hover:underline">
																		{[location.city, location.county, location.region].filter(Boolean).join(', ') || coordinatesLabel(location.lat, location.lon)}
																	</a>
																	<p class="mt-0.5 font-mono text-[11px] text-zinc-500">{coordinatesLabel(location.lat, location.lon)}</p>
																</div>
																<span class={`rounded px-2 py-1 text-[11px] font-medium ${location.physical_status === 'needs_review' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{location.physical_status === 'needs_review' ? 'Match review' : 'Active'}</span>
															</div>
															<div class="mt-2 space-y-1">
																{#each location.evidence as evidence (evidence.id)}
																	<div class="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5">
																		<a href={evidence.source_url || googleMapsCoordinatesUrl(evidence.lat, evidence.lon)} target="_blank" rel="noreferrer" class="min-w-0 flex-1 truncate text-xs text-zinc-700 hover:underline" title={evidence.address_input ?? evidence.source_key}>
																			{evidence.osm_id ? `OSM ${evidence.osm_type ?? 'node'} ${evidence.osm_id}` : `Manual · ${evidence.verification_status ?? 'unverified'}`}
																		</a>
																		<button type="button" onclick={() => evidence.osm_id ? openNodeRepairForEvidence(brand, detail, evidence) : openManualEvidenceRemoval(brand, location, evidence)} disabled={brand.status === 'merged' || brand.is_demo} class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-100 hover:text-red-700 disabled:opacity-35" title={evidence.osm_id ? 'Remove or split OSM evidence' : 'Remove manual evidence'} aria-label={evidence.osm_id ? `Manage OSM evidence for ${brand.display}` : `Remove manual location from ${brand.display}`}>
																			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
																		</button>
																	</div>
																{/each}
															</div>
															{#if location.physical_status === 'needs_review'}
																<p class="mt-2 text-xs text-amber-800">An observation is 50–150 m from an existing storefront.</p>
																<div class="mt-2 flex gap-2">
																	<button type="button" onclick={() => resolvePhysicalLocation(brand.slug, location.id, 'attach_to_suggested')} disabled={pendingAction === `resolveLocation:${location.id}`} class="rounded bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50">Same storefront</button>
																	<button type="button" onclick={() => resolvePhysicalLocation(brand.slug, location.id, 'keep_separate')} disabled={pendingAction === `resolveLocation:${location.id}`} class="rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 disabled:opacity-50">Keep separate</button>
																</div>
															{/if}
														</div>
													{/each}
													{#if detail.physical_locations.length === 0}
														<p class="py-2 text-sm text-zinc-500">No physical locations.</p>
													{/if}
													</div>
												</section>
											</div>
											<div class="space-y-5">
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">
														Integrity flags
													</h3>
													<div class="mt-2 space-y-2">
														{#each detail.integrity_flags as flag}<div
																class="border-l-2 border-red-400 bg-white px-3 py-2"
															>
																<div class="flex items-center justify-between gap-2">
																	<p class="text-sm font-medium text-zinc-900">{flag.title}</p>
																	<span class="text-xs font-medium text-red-700"
																		>{flag.severity}</span
																	>
																</div>
																{#if flag.recommended_action}<p class="mt-1 text-xs text-zinc-600">
																		{flag.recommended_action}
																	</p>{/if}
															</div>{/each}{#if detail.integrity_flags.length === 0}<p
																class="text-sm text-zinc-500"
															>
																No open integrity flags.
															</p>{/if}
													</div>
												</section>
												<section>
													<h3 class="text-xs font-semibold text-zinc-500 uppercase">
														Recent activity
													</h3>
													<div class="mt-2 space-y-2">
														{#each detail.recent_activity.slice(0, 5) as activity}<div
																class="flex items-start justify-between gap-3 text-xs"
															>
																<span class="font-medium text-zinc-700"
																	>{activity.action.replaceAll('_', ' ')}</span
																><span class="shrink-0 text-zinc-500"
																	>{relativeDate(activity.created_at)}</span
																>
															</div>{/each}{#if detail.recent_activity.length === 0}<p
																class="text-sm text-zinc-500"
															>
																No recorded admin activity.
															</p>{/if}
													</div>
												</section>
											</div>
										</div>
										<div
											class="mt-5 flex flex-wrap justify-end gap-2 border-t border-zinc-200 pt-4"
										>
											<a
												href={`/admin/enrichment?brand=${encodeURIComponent(brand.slug)}`}
												class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
												>Open enrichment</a
											>
											<button
												type="button"
												onclick={() => openIdentityEditor(brand, detail)}
												disabled={brand.status === 'merged'}
												class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
												>Edit identity</button
											>
											{#if brand.status !== 'merged' && !brand.is_demo}
												<button
													type="button"
													onclick={() => {
														mergeBrand = brand;
														modalError = '';
													}}
													class="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
													>Merge into another brand</button
												>
											{/if}
											{#if brand.status !== 'merged'}
												<button
													type="button"
													onclick={() => {
														statusBrand = brand;
														statusNote = '';
														modalError = '';
													}}
													class="rounded px-3 py-2 text-sm font-medium {brand.status === 'active'
														? 'border border-red-200 bg-white text-red-700 hover:bg-red-50'
														: 'bg-zinc-950 text-white hover:bg-zinc-800'}"
													>{brand.status === 'active' ? 'Mark closed' : 'Reopen brand'}</button
												>
											{/if}
											{#if brand.status !== 'merged' && !brand.is_demo}
												<button
													type="button"
													onclick={() => {
														deletingBrand = brand;
														deleteConfirmation = '';
														deleteNote = '';
														modalError = '';
													}}
													class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
													>Delete brand</button
												>
											{/if}
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
					{#if data.brands.length === 0}<tr
							><td colspan="10" class="px-6 py-16 text-center text-sm text-zinc-500"
								>No brands match these filters.</td
							></tr
						>{/if}
				</tbody>
			</table>
		</div>
	</section>

	{#if data.pagination.pageCount > 1}
		<nav class="flex items-center justify-between" aria-label="Brand catalog pagination">
			<a
				href={catalogUrl({ page: Math.max(1, data.pagination.page - 1) })}
				aria-disabled={data.pagination.page === 1}
				class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 aria-disabled:pointer-events-none aria-disabled:opacity-40"
				>Previous</a
			>
			<span class="text-sm text-zinc-500"
				>Page {data.pagination.page} of {data.pagination.pageCount}</span
			>
			<a
				href={catalogUrl({ page: Math.min(data.pagination.pageCount, data.pagination.page + 1) })}
				aria-disabled={data.pagination.page === data.pagination.pageCount}
				class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 aria-disabled:pointer-events-none aria-disabled:opacity-40"
				>Next</a
			>
		</nav>
	{/if}
</main>

{#if manualEvidenceRemoval}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && (manualEvidenceRemoval = null)}
	>
		<div class="w-full max-w-lg rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="manual-location-removal-title">
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h2 id="manual-location-removal-title" class="text-lg font-semibold text-zinc-950">Remove manual location evidence?</h2>
					<p class="mt-1 text-sm text-zinc-600">{manualEvidenceRemoval.brand.display}</p>
				</div>
				<button type="button" onclick={() => (manualEvidenceRemoval = null)} aria-label="Close manual location removal" class="text-xl leading-none text-zinc-400 hover:text-zinc-800">×</button>
			</div>
			<div class="space-y-4 px-5 py-5">
				<div class="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
					{#if manualEvidenceRemoval.location.evidence.length > 1}
						The storefront will remain because other accepted evidence is attached.
					{:else}
						This is the storefront's only accepted evidence, so the storefront will be retired from location counts.
					{/if}
				</div>
				<div class="text-sm text-zinc-700">
					<p class="font-medium">{manualEvidenceRemoval.evidence.address_input || coordinatesLabel(manualEvidenceRemoval.evidence.lat, manualEvidenceRemoval.evidence.lon)}</p>
					{#if manualEvidenceRemoval.evidence.source_url}<a href={manualEvidenceRemoval.evidence.source_url} target="_blank" rel="noreferrer" class="mt-1 block truncate text-xs text-blue-700 hover:underline">{manualEvidenceRemoval.evidence.source_url}</a>{/if}
				</div>
				<label class="block">
					<span class="text-sm font-medium text-zinc-800">Reason</span>
					<textarea bind:value={manualEvidenceRemovalReason} rows="3" maxlength="1000" required placeholder="Duplicate entry, incorrect storefront, closed before verification…" class="mt-1 block w-full rounded border-zinc-300 text-sm"></textarea>
				</label>
				{#if modalError}<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{modalError}</div>{/if}
			</div>
			<div class="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4">
				<button type="button" onclick={() => (manualEvidenceRemoval = null)} class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
				<button type="button" onclick={removeManualEvidence} disabled={!manualEvidenceRemovalReason.trim() || Boolean(pendingAction)} class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">{pendingAction.startsWith('removeManualEvidence:') ? 'Removing…' : 'Confirm removal'}</button>
			</div>
		</div>
	</div>
{/if}

{#if nodeRepair}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="node-repair-title"
		>
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h2 id="node-repair-title" class="text-lg font-semibold text-zinc-950">
						Remove OSM node from brand
					</h2>
					<p class="mt-1 text-sm text-zinc-600">
						{nodeRepair.location.name ?? 'Unnamed OSM location'} · {nodeRepair.brand.display}
					</p>
				</div>
				<button
					type="button"
					onclick={closeModal}
					aria-label="Close OSM node dialog"
					class="text-xl leading-none text-zinc-400 hover:text-zinc-800">×</button
				>
			</div>

			<form
				method="post"
				action="?/repairOsmNode"
				use:enhance={actionEnhance('repairOsmNode')}
				class="flex min-h-0 flex-1 flex-col"
			>
				<input type="hidden" name="candidate_id" value={nodeRepair.location.id} />
				<input type="hidden" name="source_brand_slug" value={nodeRepair.brand.slug} />
				<input type="hidden" name="disposition" value={nodeDisposition} />

				<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
					<div class="border-l-2 border-amber-500 bg-amber-50 px-3 py-2">
						<p class="text-sm font-medium text-amber-950">
							This changes canonical identity resolution for one observed location.
						</p>
						<p class="mt-1 text-xs leading-5 text-amber-800">
							The raw candidate and prior research remain available as audit history.
						</p>
					</div>

					<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Node action">
						<label
							class="cursor-pointer rounded border p-3 {nodeDisposition === 'remove'
								? 'border-red-400 bg-red-50'
								: 'border-zinc-200 bg-white'}"
						>
							<span class="flex items-start gap-2">
								<input
									type="radio"
									bind:group={nodeDisposition}
									value="remove"
									class="mt-0.5 border-zinc-300 text-red-700 focus:ring-red-600"
								/>
								<span>
									<span class="block text-sm font-semibold text-zinc-950">Remove only</span>
									<span class="mt-1 block text-xs leading-5 text-zinc-600">
										Detach and reject this observation without creating a brand.
									</span>
								</span>
							</span>
						</label>
						<label
							class="cursor-pointer rounded border p-3 {nodeDisposition === 'create_brand'
								? 'border-blue-500 bg-blue-50'
								: 'border-zinc-200 bg-white'}"
						>
							<span class="flex items-start gap-2">
								<input
									type="radio"
									bind:group={nodeDisposition}
									value="create_brand"
									class="mt-0.5 border-zinc-300 text-blue-700 focus:ring-blue-600"
								/>
								<span>
									<span class="block text-sm font-semibold text-zinc-950"
										>Create separate brand</span
									>
									<span class="mt-1 block text-xs leading-5 text-zinc-600">
										Move the node to a new brand and queue a manual enrichment audit.
									</span>
								</span>
							</span>
						</label>
					</div>

					{#if nodeDisposition === 'create_brand'}
						<section class="space-y-4 border-t border-zinc-200 pt-5">
							<label class="block">
								<span class="text-sm font-medium text-zinc-800">New canonical display name</span>
								<input
									name="new_display"
									bind:value={nodeNewDisplay}
									maxlength="200"
									required
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<div class="border-t border-zinc-200 pt-4">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p class="text-sm font-semibold text-zinc-950">Initial research scope</p>
										<p class="mt-1 text-xs leading-5 text-zinc-500">
											Private identity constraints saved before enrichment is queued.
										</p>
									</div>
									<label class="flex items-center gap-2 text-xs text-zinc-600">
										<input
											type="checkbox"
											name="scope_identity_verified"
											value="true"
											bind:checked={nodeIdentityVerified}
											class="rounded border-zinc-300"
										/>
										Identity verified
									</label>
								</div>
								<div
									class="mt-4 border-l-2 border-teal-400 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-900"
								>
									<p class="font-medium">Automatic geographic context</p>
									<p class="mt-0.5">
										{coordinatesLabel(nodeRepair.location.lat, nodeRepair.location.lon)}{nodeRepair
											.location.region_key
											? ` · ${nodeRepair.location.region_key}`
											: ''}
									</p>
									<p class="text-teal-800">
										The new brand location will be reverse-geocoded before research. The fields
										below are optional corrections.
									</p>
								</div>
								<label class="mt-4 block">
									<span class="text-xs font-medium text-zinc-700">Identity basis</span>
									<select
										name="scope_identity_basis"
										bind:value={nodeIdentityBasis}
										class="mt-1 block w-full rounded border-zinc-300 text-sm"
									>
										<option value="">Not specified</option>
										<option value="official">Official identity</option>
										<option value="multi_location_cluster">Multi-location cluster</option>
										<option value="local">Local business</option>
										<option value="ambiguous">Ambiguous identity</option>
									</select>
								</label>
								<div class="mt-4 space-y-3">
									<div class="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
										<select
											name="scope_market_role"
											bind:value={nodeMarketRole}
											aria-label="Market role"
											class="rounded border-zinc-300 text-sm"
										>
											<option value="include">Include</option><option value="prefer">Prefer</option
											><option value="exclude">Exclude</option>
										</select>
										<input
											name="scope_market"
											bind:value={nodeMarket}
											maxlength="2048"
											placeholder="Optional market override"
											class="min-w-0 rounded border-zinc-300 text-sm"
										/>
									</div>
									<div class="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
										<select
											name="scope_location_role"
											bind:value={nodeLocationRole}
											aria-label="Location observation role"
											class="rounded border-zinc-300 text-sm"
										>
											<option value="prefer">Prefer</option><option value="include">Include</option
											><option value="exclude">Exclude</option>
										</select>
										<input
											name="scope_location_observation"
											bind:value={nodeLocationObservation}
											maxlength="2048"
											placeholder="Optional location override"
											class="min-w-0 rounded border-zinc-300 text-sm"
										/>
									</div>
									<div class="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]">
										<select
											name="scope_url_role"
											bind:value={nodeUrlRole}
											aria-label="Research URL role"
											class="rounded border-zinc-300 text-sm"
										>
											<option value="include">Include</option><option value="prefer">Prefer</option
											><option value="exclude">Exclude</option>
										</select>
										<input
											type="url"
											name="scope_url"
											bind:value={nodeResearchUrl}
											maxlength="2048"
											placeholder="Optional website or source override"
											class="min-w-0 rounded border-zinc-300 text-sm"
										/>
									</div>
								</div>
							</div>
							<p class="text-xs leading-5 text-zinc-500">
								The new brand starts with conservative matching and manual-only enrichment.
							</p>
						</section>
					{/if}

					<label class="block border-t border-zinc-200 pt-5">
						<span class="text-sm font-medium text-zinc-800">Reason</span>
						<textarea
							name="reason"
							bind:value={nodeRepairReason}
							rows="3"
							maxlength="1000"
							required
							placeholder="Verified separate business through…"
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						></textarea>
					</label>

					{#if modalError}
						<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
							{modalError}
						</div>
					{/if}
				</div>

				<div class="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4">
					<button
						type="button"
						onclick={closeModal}
						class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 {nodeDisposition ===
						'remove'
							? 'bg-red-700 hover:bg-red-800'
							: 'bg-blue-700 hover:bg-blue-800'}"
						disabled={!nodeRepairReason.trim() ||
							(nodeDisposition === 'create_brand' && !nodeNewDisplay.trim()) ||
							Boolean(pendingAction)}
					>
						{pendingAction === 'repairOsmNode'
							? 'Working…'
							: nodeDisposition === 'remove'
								? 'Confirm removal'
								: 'Create brand and enrich'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if editBrand}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="edit-title"
		>
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h2 id="edit-title" class="text-lg font-semibold text-zinc-950">
						Review and save identity
					</h2>
					<p class="mt-1 text-sm text-zinc-600">
						{editBrand.slug} · Current canonical values are prefilled.
					</p>
				</div>
				<button
					type="button"
					onclick={closeModal}
					aria-label="Close identity editor"
					class="text-xl leading-none text-zinc-400 hover:text-zinc-800"
				>
					×
				</button>
			</div>
			<form
				method="post"
				action="?/updateIdentity"
				use:enhance={actionEnhance('updateIdentity')}
				class="flex min-h-0 flex-1 flex-col"
			>
				<input type="hidden" name="brand_slug" value={editBrand.slug} />
				<input
					type="hidden"
					name="identity_regions"
					value={JSON.stringify(identityRegions)}
				/>
				<div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
					<BrandIdentityFields
						slug={editBrand.slug}
						originalDisplay={editBrand.display}
						bind:display={identityDisplay}
						bind:website={identityWebsite}
						bind:wikidata={identityWikidata}
						bind:aliases={identityAliases}
						bind:hasAliasDraft={identityHasAliasDraft}
					/>

					<section class="border-t border-zinc-200 pt-6">
						<div>
							<h4 class="text-sm font-semibold text-zinc-950">Operating regions</h4>
							<p class="mt-1 text-xs text-zinc-500">
								Add state-level brand presence here. City and county presence stays derived from
								observed locations.
							</p>
						</div>

						<div class="mt-4">
							<div class="flex items-center justify-between gap-3">
								<p class="text-xs font-semibold text-zinc-500 uppercase">Current regions</p>
								<span class="text-xs text-zinc-500">Removals apply when you confirm.</span>
							</div>
							<div class="mt-2 flex min-h-8 flex-wrap gap-2">
								{#each identityRegions as code (code)}
									<span
										class="inline-flex min-h-8 items-center gap-1 rounded border border-zinc-200 bg-white py-1 pr-1 pl-2 text-xs text-zinc-700"
									>
										{regionLabel(code)}
										<span class="px-1 text-[10px] font-semibold text-zinc-400 uppercase">
											{regionSourceLabel(code)}
										</span>
										<button
											type="button"
											onclick={() => removeIdentityRegion(code)}
											class="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-700"
											title={`Remove ${regionLabel(code)}`}
											aria-label={`Remove ${regionLabel(code)}`}
										>×</button>
									</span>
								{/each}
								{#if identityRegions.length === 0}
									<p class="self-center text-sm text-zinc-500">No regions associated.</p>
								{/if}
							</div>

							<div class="mt-3 flex gap-2">
								<label class="min-w-0 flex-1">
									<span class="sr-only">Add operating region</span>
									<select
										bind:value={identityRegionDraft}
										class="block h-10 w-full rounded border-zinc-300 text-sm"
									>
										<option value="">Choose a state or region</option>
										{#each data.regions.filter(
											(region) =>
												!identityRegions.includes(region.code)
										) as region (region.code)}
											<option value={region.code}>{region.region_name} ({region.code})</option>
										{/each}
									</select>
								</label>
								<button
									type="button"
									onclick={addIdentityRegion}
									disabled={!identityRegionDraft}
									class="h-10 shrink-0 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
								>Add</button>
							</div>

						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<BrandMatchPolicyField
							recommendation={details[editBrand.slug]?.dossier?.recommended_match_policy ?? null}
							bind:value={identityMatchPolicy}
						/>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<label class="block">
							<span class="text-sm font-medium text-zinc-800">Enrichment mode</span>
							<select
								name="identity_enrichment_mode"
								bind:value={identityEnrichmentMode}
								class="mt-1 block w-full rounded border-zinc-300 text-sm"
							>
								<option value="auto">Automatic</option>
								<option value="manual_only">Manual only</option>
								<option value="disabled">Disabled</option>
							</select>
						</label>
						{#if identityEnrichmentMode === 'disabled'}
							<p class="mt-2 text-xs font-medium text-red-700">
								Queued work will be cancelled and this brand cannot be enriched.
							</p>
						{:else if identityEnrichmentMode === 'manual_only'}
							<p class="mt-2 text-xs font-medium text-amber-700">
								Only a targeted admin rerun can enqueue this brand.
							</p>
						{/if}
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<label class="block">
							<span class="text-xs font-medium text-zinc-600">Review note (optional)</span>
							<textarea
								name="note"
								bind:value={identityNote}
								rows="3"
								placeholder="Evidence or context for this change"
								class="mt-1 block w-full rounded border-zinc-300 text-sm"
							></textarea>
						</label>
					</section>

					{#if modalError}
						<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
							{modalError}
						</div>
					{/if}
				</div>

				<div
					class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4"
				>
					<p class="text-xs text-zinc-500">
						{identityIsChanged
							? 'Changes will be recorded in the admin audit log.'
							: 'Change a field to enable confirmation.'}
					</p>
					<div class="flex shrink-0 gap-2">
						<button
							type="button"
							onclick={closeModal}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
							>Cancel</button
						><button
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!identityDisplay.trim() ||
								!identityIsChanged ||
								identityHasAliasDraft ||
								Boolean(pendingAction)}
							>{pendingAction === 'updateIdentity' ? 'Saving…' : 'Confirm changes'}</button
						>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if manualLocationBrand}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeManualLocation()}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="manual-location-title"
		>
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h2 id="manual-location-title" class="text-lg font-semibold text-zinc-950">
						Add real location
					</h2>
					<p class="mt-1 text-sm text-zinc-600">{manualLocationBrand.display}</p>
				</div>
				<button
					type="button"
					onclick={closeManualLocation}
					aria-label="Close location dialog"
					class="text-xl leading-none text-zinc-400 hover:text-zinc-800"
				>×</button>
			</div>

			<form
				method="post"
				action="?/createManualLocation"
				use:enhance={manualLocationEnhance()}
				class="flex min-h-0 flex-1 flex-col"
			>
				<input type="hidden" name="brand_slug" value={manualLocationBrand.slug} />
				<input type="hidden" name="location_input_kind" value={manualLocationInputKind} />
				<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
					<label class="block">
						<span class="text-xs font-medium text-zinc-600">Brand</span>
						<input
							value={`${manualLocationBrand.display} · ${manualLocationBrand.slug}`}
							disabled
							class="mt-1 block h-10 w-full rounded border-zinc-200 bg-zinc-50 text-sm text-zinc-600"
						/>
					</label>

					<div>
						<span class="text-xs font-medium text-zinc-600">Location input</span>
						<div class="mt-1 inline-flex rounded border border-zinc-300 bg-zinc-50 p-0.5">
							<button
								type="button"
								onclick={() => (manualLocationInputKind = 'coordinates')}
								class={`rounded px-3 py-1.5 text-sm font-medium ${manualLocationInputKind === 'coordinates' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'}`}
							>Coordinates</button>
							<button
								type="button"
								onclick={() => (manualLocationInputKind = 'address')}
								class={`rounded px-3 py-1.5 text-sm font-medium ${manualLocationInputKind === 'address' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500'}`}
							>Address</button>
						</div>
					</div>

					{#if manualLocationInputKind === 'coordinates'}
						<div class="grid gap-4 sm:grid-cols-2">
							<label>
								<span class="text-xs font-medium text-zinc-600">Latitude</span>
								<input
									name="location_lat"
									type="number"
									step="any"
									min="-90"
									max="90"
									required
									bind:value={manualLocationLat}
									placeholder="37.7749"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Longitude</span>
								<input
									name="location_lon"
									type="number"
									step="any"
									min="-180"
									max="180"
									required
									bind:value={manualLocationLon}
									placeholder="-122.4194"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
					{:else}
						<label class="block">
							<span class="text-xs font-medium text-zinc-600">Address</span>
							<input
								name="location_address"
								required
								bind:value={manualLocationAddress}
								placeholder="123 Main St, San Jose, CA"
								class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
							/>
						</label>
					{/if}

					<label class="block">
						<span class="text-xs font-medium text-zinc-600">Source URL</span>
						<input
							name="location_source_url"
							type="url"
							required
							bind:value={manualLocationSourceUrl}
							placeholder="https://…"
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
						/>
					</label>

					<label class="block">
						<span class="text-xs font-medium text-zinc-600">Verification status</span>
						<select
							name="location_verification_status"
							bind:value={manualLocationVerification}
							class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
						>
							<option value="verified">Verified</option>
							<option value="needs_review">Needs review</option>
							<option value="unverified">Unverified</option>
						</select>
					</label>

					<label class="block">
						<span class="text-xs font-medium text-zinc-600">Note (optional)</span>
						<textarea
							name="location_note"
							bind:value={manualLocationNote}
							rows="3"
							maxlength="2000"
							class="mt-1 block w-full rounded border-zinc-300 text-sm"
						></textarea>
					</label>

					{#if modalError}
						<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
							{modalError}
						</div>
					{/if}
				</div>

				<div class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4">
					<p class="text-xs text-zinc-500">City, county, and state will resolve asynchronously.</p>
					<div class="flex shrink-0 gap-2">
						<button
							type="button"
							onclick={closeManualLocation}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button>
						<button
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!manualLocationSourceUrl.trim() ||
								(manualLocationInputKind === 'coordinates'
									? !manualLocationLat || !manualLocationLon
									: !manualLocationAddress.trim()) ||
								Boolean(pendingAction)}
						>{pendingAction === 'createManualLocation' ? 'Creating…' : 'Confirm location'}</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deletingBrand}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-brand-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h2 id="delete-brand-title" class="text-lg font-semibold text-zinc-950">
					Permanently delete brand
				</h2>
				<p class="mt-1 text-sm text-red-700">
					Use this only for a false-positive brand. This cannot be undone; the API will refuse
					deletion while shops or feed events still depend on it.
				</p>
			</div>
			<form
				method="post"
				action="?/deleteBrand"
				use:enhance={actionEnhance('deleteBrand')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={deletingBrand.slug} />
				<div>
					<p class="text-sm font-medium text-zinc-900">{deletingBrand.display}</p>
					<code class="text-xs break-all text-zinc-500">{deletingBrand.slug}</code>
				</div>
				<label class="block">
					<span class="text-sm font-medium text-zinc-800">Type the exact slug</span>
					<input
						name="confirmation_slug"
						bind:value={deleteConfirmation}
						autocomplete="off"
						required
						class="mt-2 block w-full rounded border-zinc-300 text-sm"
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium text-zinc-800">Verification note</span>
					<textarea
						name="note"
						bind:value={deleteNote}
						rows="4"
						required
						placeholder="Verified false positive through…"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea>
				</label>
				{#if modalError}<div
						class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{modalError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeModal}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={deleteConfirmation !== deletingBrand.slug ||
							!deleteNote.trim() ||
							Boolean(pendingAction)}
						>{pendingAction === 'deleteBrand' ? 'Deleting…' : 'Delete permanently'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if mergeBrand}
	<BrandMergeDialog
		source={{ slug: mergeBrand.slug, display: mergeBrand.display }}
		enhanceSubmit={actionEnhance('mergeBrand')}
		busy={pendingAction === 'mergeBrand'}
		error={modalError}
		onClose={closeModal}
	/>
{/if}

{#if statusBrand}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeModal()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="status-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h2 id="status-title" class="text-lg font-semibold text-zinc-950">
					{statusBrand.status === 'active' ? 'Mark brand closed' : 'Reopen brand'}
				</h2>
				{#if statusBrand.status === 'active'}<p class="mt-1 text-sm text-red-700">
						This retires the brand, unpublishes its profile, resolves current flags, cancels
						enrichment work, and prevents new shop attachments.
					</p>{:else}<p class="mt-1 text-sm text-zinc-600">
						This reactivates the brand and queues a fresh audit. Previously published copy is not
						restored automatically.
					</p>{/if}
			</div>
			<form
				method="post"
				action={statusBrand.status === 'active' ? '?/closeBrand' : '?/reopenBrand'}
				use:enhance={actionEnhance(statusBrand.status === 'active' ? 'closeBrand' : 'reopenBrand')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={statusBrand.slug} />
				<div>
					<p class="text-sm font-medium text-zinc-900">{statusBrand.display}</p>
					<code class="text-xs text-zinc-500">{statusBrand.slug}</code>
				</div>
				<label class="block"
					><span class="text-sm font-medium text-zinc-800"
						>{statusBrand.status === 'active' ? 'Closure reason' : 'Reopen reason'}</span
					><textarea
						name="note"
						bind:value={statusNote}
						rows="4"
						required
						placeholder={statusBrand.status === 'active'
							? 'Verified closed through…'
							: 'Verified operating through…'}
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea></label
				>
				{#if modalError}<div
						class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{modalError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeModal}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					><button
						class="rounded px-3 py-2 text-sm font-medium text-white disabled:opacity-50 {statusBrand.status ===
						'active'
							? 'bg-red-700 hover:bg-red-800'
							: 'bg-zinc-950 hover:bg-zinc-800'}"
						disabled={!statusNote.trim() || Boolean(pendingAction)}
						>{pendingAction
							? 'Working…'
							: statusBrand.status === 'active'
								? 'Mark closed'
								: 'Reopen and audit'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
