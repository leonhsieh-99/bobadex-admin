import { fail } from '@sveltejs/kit';
import { isBrandMatchPolicy } from '$lib/brand-match-policy';
import { mergeBrands } from '$lib/server/brand-merge.server';
import { initialResearchScopeFromForm } from '$lib/server/enrichment-research-scope.server';
import type { Actions, PageServerLoad } from './$types';

type BrandStatus = 'active' | 'retired' | 'merged';
type BrandEnrichmentMode = 'auto' | 'manual_only' | 'disabled';
type CatalogSort = 'attention' | 'node_count' | 'display' | 'created_at';
type CatalogSortDir = 'asc' | 'desc';

type CatalogRow = {
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

type LocationCountRow = {
	brand_slug: string;
	location_count: number | string;
	osm_node_count: number | string;
	manual_location_count: number | string;
	location_review_count: number | string;
};

const pageSize = 50;
const catalogSorts = new Set<CatalogSort>(['attention', 'node_count', 'display', 'created_at']);
const catalogSortDirs = new Set<CatalogSortDir>(['asc', 'desc']);

function cleanSearch(value: string | null) {
	return (value ?? '')
		.replace(/[,%()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function formValue(form: FormData, key: string) {
	return String(form.get(key) ?? '').trim();
}

function isUuid(value: string) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function actionError(data: unknown, fallback: string) {
	if (data && typeof data === 'object' && 'error' in data && data.error) return String(data.error);
	return fallback;
}

async function functionErrorMessage(error: unknown) {
	if (error && typeof error === 'object' && 'context' in error) {
		const context = (error as { context?: unknown }).context;
		if (context instanceof Response) {
			try {
				const payload = (await context.clone().json()) as { error?: unknown; message?: unknown };
				if (typeof payload.error === 'string' && payload.error) return payload.error;
				if (typeof payload.message === 'string' && payload.message) return payload.message;
			} catch {
				// Fall through to the client error when the function did not return JSON.
			}
		}
	}
	return error instanceof Error && error.message
		? error.message
		: 'The brand deletion request was rejected.';
}

function createManualLocationError(message: string) {
	if (message.includes('brand_location_already_exists')) {
		return 'A location already exists at those coordinates.';
	}
	if (message.includes('brand_not_active')) {
		return 'Only active brands can receive manual locations.';
	}
	if (message.includes('demo_brand_not_allowed')) {
		return 'Demo brands cannot receive manual locations.';
	}
	if (message.includes('valid_source_url_required')) {
		return 'A valid source URL is required.';
	}
	if (message.includes('invalid_latitude') || message.includes('invalid_longitude')) {
		return 'Enter valid latitude and longitude values.';
	}
	return message || 'The location could not be created.';
}

type NominatimSearchHit = { lat?: string; lon?: string };

async function resolveManualLocationPoint(input: {
	kind: string;
	latitude: number;
	longitude: number;
	address: string;
}) {
	if (input.kind === 'coordinates') {
		return { lat: input.latitude, lon: input.longitude, address: input.address || null };
	}

	const url = new URL('https://nominatim.openstreetmap.org/search');
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('q', input.address);
	url.searchParams.set('limit', '1');

	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'BobadexAdmin/1.0 (manual-brand-location)'
		}
	});
	if (!response.ok) {
		throw new Error('Address lookup failed. Try coordinates instead.');
	}

	const hits = (await response.json()) as NominatimSearchHit[];
	const lat = Number(hits[0]?.lat);
	const lon = Number(hits[0]?.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
		throw new Error('That address could not be geocoded. Try coordinates instead.');
	}

	return { lat, lon, address: input.address };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = cleanSearch(url.searchParams.get('q'));
	const requestedStatus = url.searchParams.get('status');
	const status: BrandStatus | null =
		requestedStatus === 'active' || requestedStatus === 'retired' || requestedStatus === 'merged'
			? requestedStatus
			: null;
	const region = cleanSearch(url.searchParams.get('region'));
	const attentionOnly = url.searchParams.get('attention') === '1';
	const requestedSort = url.searchParams.get('sort');
	const sort: CatalogSort = catalogSorts.has(requestedSort as CatalogSort)
		? (requestedSort as CatalogSort)
		: 'display';
	const requestedSortDir = url.searchParams.get('dir');
	const sortDir: CatalogSortDir = catalogSortDirs.has(requestedSortDir as CatalogSortDir)
		? (requestedSortDir as CatalogSortDir)
		: sort === 'display'
			? 'asc'
			: 'desc';
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);

	const [catalogResult, regionsResult] = await Promise.all([
		locals.supabase.rpc('admin_list_brand_catalog', {
			p_q: q || null,
			p_status: status,
			p_region_code: region || null,
			p_attention_only: attentionOnly,
			p_page: page,
			p_page_size: pageSize,
			p_sort: sort,
			p_sort_dir: sortDir
		}),
		locals.supabase
			.from('region_codes')
			.select('code,country_code,region_name')
			.order('country_code')
			.order('region_name')
	]);

	if (catalogResult.error) {
		console.error('[brand catalog]', catalogResult.error);
		throw new Error(`Failed to load brand catalog: ${catalogResult.error.message}`);
	}
	if (regionsResult.error) {
		console.error('[brand catalog regions]', regionsResult.error);
	}

	const catalogRows = (catalogResult.data ?? []) as Omit<
		CatalogRow,
		'enrichment_mode' | 'location_count' | 'manual_location_count' | 'location_review_count'
	>[];
	const [modeResult, locationCountsResult] = catalogRows.length
		? await Promise.all([
			locals.supabase
				.from('brands')
				.select('slug,enrichment_mode')
				.in(
					'slug',
					catalogRows.map((brand) => brand.slug)
				),
			locals.supabase.rpc('admin_get_brand_location_counts', {
				p_brand_slugs: catalogRows.map((brand) => brand.slug)
			})
		])
		: [{ data: [], error: null }, { data: [], error: null }];
	if (modeResult.error) {
		console.error('[brand catalog enrichment modes]', modeResult.error);
		throw new Error(`Failed to load enrichment modes: ${modeResult.error.message}`);
	}
	if (locationCountsResult.error) {
		console.error('[brand catalog location counts]', locationCountsResult.error);
		throw new Error(`Failed to load location counts: ${locationCountsResult.error.message}`);
	}
	const modeBySlug = new Map(
		(modeResult.data ?? []).map((brand) => [
			brand.slug,
			brand.enrichment_mode as BrandEnrichmentMode
		])
	);
	const locationCountsBySlug = new Map(
		((locationCountsResult.data ?? []) as LocationCountRow[]).map((row) => [row.brand_slug, row])
	);
	const brands: CatalogRow[] = catalogRows.map((brand) => ({
		...brand,
		enrichment_mode: modeBySlug.get(brand.slug) ?? 'auto',
		location_count: Number(locationCountsBySlug.get(brand.slug)?.location_count ?? 0),
		node_count: Number(locationCountsBySlug.get(brand.slug)?.osm_node_count ?? 0),
		manual_location_count: Number(locationCountsBySlug.get(brand.slug)?.manual_location_count ?? 0),
		location_review_count: Number(locationCountsBySlug.get(brand.slug)?.location_review_count ?? 0)
	}));
	const total = Number(brands[0]?.total_count ?? 0);

	return {
		brands,
		regions: regionsResult.data ?? [],
		filters: { q, status: status ?? '', region, attentionOnly, sort, sortDir },
		pagination: {
			page,
			pageSize,
			total,
			pageCount: Math.max(1, Math.ceil(total / pageSize))
		}
	};
};

export const actions: Actions = {
	updateIdentity: async ({ request, locals }) => {
		if (!locals.isAdmin) return fail(403, { ok: false, message: 'Admin access required.' });
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const display = formValue(form, 'identity_display');
		const website = formValue(form, 'identity_website');
		const wikidata = formValue(form, 'identity_wikidata');
		const matchPolicy = formValue(form, 'identity_match_policy');
		const enrichmentMode = formValue(form, 'identity_enrichment_mode');
		let aliases: string[];
		let regionCodes: string[];
		try {
			const parsed = JSON.parse(formValue(form, 'identity_aliases') || '[]');
			if (!Array.isArray(parsed) || parsed.some((alias) => typeof alias !== 'string')) {
				throw new Error('Aliases must be a list of names.');
			}
			aliases = parsed;
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'updateIdentity',
				brandSlug: slug,
				message: error instanceof Error ? error.message : 'Aliases could not be read.'
			});
		}
		try {
			const parsed = JSON.parse(formValue(form, 'identity_regions') || '[]');
			if (!Array.isArray(parsed) || parsed.some((code) => typeof code !== 'string')) {
				throw new Error('Regions must be a list of region codes.');
			}
			regionCodes = [...new Set(parsed.map((code) => code.trim()).filter(Boolean))];
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'updateIdentity',
				brandSlug: slug,
				message: error instanceof Error ? error.message : 'Regions could not be read.'
			});
		}
		if (
			!slug ||
			!display ||
			!isBrandMatchPolicy(matchPolicy) ||
			!['auto', 'manual_only', 'disabled'].includes(enrichmentMode)
		) {
			return fail(400, {
				ok: false,
				action: 'updateIdentity',
				brandSlug: slug,
				message: !display
					? 'A display name is required.'
					: !isBrandMatchPolicy(matchPolicy)
						? 'Select a valid match policy.'
						: 'Select a valid enrichment mode.'
			});
		}

		const { data, error } = await locals.supabase.rpc('admin_update_brand_identity_v6', {
			p_brand_slug: slug,
			p_display: display,
			p_aliases: aliases,
			p_region_codes: regionCodes,
			p_website: website || null,
			p_wikidata: wikidata || null,
			p_match_policy: matchPolicy,
			p_enrichment_mode: enrichmentMode,
			p_note: formValue(form, 'note') || null
		});
		if (error) {
			return fail(400, {
				ok: false,
				action: 'updateIdentity',
				brandSlug: slug,
				message: error.message
			});
		}
		const identityResult =
			data && typeof data === 'object' && !Array.isArray(data)
				? (data as {
						before?: { aliases?: unknown[] };
						after?: { aliases?: unknown[] };
					})
				: null;
		const aliasesAdded = Math.max(
			0,
			(identityResult?.after?.aliases?.length ?? 0) - (identityResult?.before?.aliases?.length ?? 0)
		);
		return {
			ok: true,
			action: 'updateIdentity',
			brandSlug: slug,
			data,
			message:
				aliasesAdded > 0
					? `Saved ${aliasesAdded} new alias${aliasesAdded === 1 ? '' : 'es'} for ${display}.`
					: `Updated ${display}.`
		};
	},

	createManualLocation: async ({ request, locals }) => {
		if (!locals.isAdmin) return fail(403, { ok: false, message: 'Admin access required.' });
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const inputKind = formValue(form, 'location_input_kind');
		const address = formValue(form, 'location_address');
		const sourceUrl = formValue(form, 'location_source_url');
		const verificationStatus = formValue(form, 'location_verification_status');
		const latitudeValue = formValue(form, 'location_lat');
		const longitudeValue = formValue(form, 'location_lon');
		const latitude = Number(latitudeValue);
		const longitude = Number(longitudeValue);

		if (!slug || !['coordinates', 'address'].includes(inputKind)) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: !slug ? 'Brand is required.' : 'Choose coordinates or address.'
			});
		}
		if (inputKind === 'address' && !address) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: 'Address is required.'
			});
		}
		if (
			inputKind === 'coordinates' &&
			(!latitudeValue ||
				!longitudeValue ||
				!Number.isFinite(latitude) ||
				latitude < -90 ||
				latitude > 90 ||
				!Number.isFinite(longitude) ||
				longitude < -180 ||
				longitude > 180)
		) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: 'Enter valid latitude and longitude values.'
			});
		}
		if (!/^https?:\/\/\S+$/i.test(sourceUrl)) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: 'A valid source URL is required.'
			});
		}
		if (!['verified', 'needs_review', 'unverified'].includes(verificationStatus)) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: 'Choose a valid verification status.'
			});
		}

		let point: { lat: number; lon: number; address: string | null };
		try {
			point = await resolveManualLocationPoint({
				kind: inputKind,
				latitude,
				longitude,
				address
			});
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: error instanceof Error ? error.message : 'That address could not be geocoded.'
			});
		}

		const { data, error } = await locals.supabase.rpc('admin_create_manual_brand_location', {
			p_brand_slug: slug,
			p_lat: point.lat,
			p_lon: point.lon,
			p_source_url: sourceUrl,
			p_verification_status: verificationStatus,
			p_address_input: point.address,
			p_note: formValue(form, 'location_note') || null
		});
		if (error) {
			return fail(400, {
				ok: false,
				action: 'createManualLocation',
				brandSlug: slug,
				message: createManualLocationError(error.message)
			});
		}

		void locals.supabase.functions
			.invoke('drain-brand-location-geocode', { body: { limit: 5 } })
			.catch((drainError) => {
				console.error('[createManualLocation drain]', drainError);
			});

		return {
			ok: true,
			action: 'createManualLocation',
			brandSlug: slug,
			data,
			message: 'Manual location saved. City and county labels are pending geocoding.'
		};
	},

	resolveLocationMatch: async ({ request, locals }) => {
		if (!locals.isAdmin) return fail(403, { ok: false, message: 'Admin access required.' });
		const form = await request.formData();
		const brandSlug = formValue(form, 'brand_slug');
		const locationId = formValue(form, 'location_id');
		const resolution = formValue(form, 'resolution');
		if (!isUuid(locationId) || !['attach_to_suggested', 'keep_separate'].includes(resolution)) {
			return fail(400, {
				ok: false,
				action: 'resolveLocationMatch',
				brandSlug,
				message: 'Choose a valid storefront resolution.'
			});
		}

		const { data, error } = await locals.supabase.rpc('admin_resolve_brand_location_match', {
			p_location_id: locationId,
			p_resolution: resolution,
			p_note: formValue(form, 'note') || null
		});
		if (error) {
			return fail(400, {
				ok: false,
				action: 'resolveLocationMatch',
				brandSlug,
				message: error.message
			});
		}

		return {
			ok: true,
			action: 'resolveLocationMatch',
			brandSlug,
			data,
			message:
				resolution === 'attach_to_suggested'
					? 'Evidence attached to the existing storefront.'
					: 'Kept as a separate storefront.'
		};
	},

	closeBrand: async ({ request, locals }) => {
		if (!locals.isAdmin) return fail(403, { ok: false, message: 'Admin access required.' });
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const note = formValue(form, 'note');
		if (!slug || !note) {
			return fail(400, {
				ok: false,
				action: 'closeBrand',
				brandSlug: slug,
				message: 'A closure reason is required.'
			});
		}

		const { data, error } = await locals.supabase.functions.invoke(
			'process-brand-enrichment-jobs',
			{
				body: { action: 'mark_brand_closed', brand_slug: slug, note }
			}
		);
		const responseError = actionError(data, '');
		if (error || responseError) {
			return fail(400, {
				ok: false,
				action: 'closeBrand',
				brandSlug: slug,
				message: responseError || error?.message || 'Could not close the brand.'
			});
		}
		return { ok: true, action: 'closeBrand', brandSlug: slug, message: `Marked ${slug} closed.` };
	},

	reopenBrand: async ({ request, locals }) => {
		if (!locals.isAdmin) return fail(403, { ok: false, message: 'Admin access required.' });
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const note = formValue(form, 'note');
		if (!slug || !note) {
			return fail(400, {
				ok: false,
				action: 'reopenBrand',
				brandSlug: slug,
				message: 'A reopen reason is required.'
			});
		}

		const { data, error } = await locals.supabase.rpc('admin_reopen_brand', {
			p_brand_slug: slug,
			p_note: note
		});
		if (error) {
			return fail(400, {
				ok: false,
				action: 'reopenBrand',
				brandSlug: slug,
				message: error.message
			});
		}
		return {
			ok: true,
			action: 'reopenBrand',
			brandSlug: slug,
			data,
			message: `Reopened ${slug} and queued an audit.`
		};
	},

	mergeBrand: async ({ request, locals }) => {
		const form = await request.formData();
		const sourceSlug = formValue(form, 'source_slug');
		const targetSlug = formValue(form, 'target_slug');
		const reason = formValue(form, 'reason');
		if (!sourceSlug || !targetSlug || !reason) {
			return fail(400, {
				ok: false,
				action: 'mergeBrand',
				brandSlug: sourceSlug,
				message: 'Source, target, and merge reason are required.'
			});
		}

		try {
			const data = await mergeBrands(locals, {
				sourceSlug,
				targetSlug,
				reason,
				markTargetForReview: formValue(form, 'mark_target_for_review') === 'true'
			});
			return {
				ok: true,
				action: 'mergeBrand',
				brandSlug: sourceSlug,
				data,
				message: `Merged ${sourceSlug} into ${data.target_display}.`
			};
		} catch (error) {
			return fail(400, {
				ok: false,
				action: 'mergeBrand',
				brandSlug: sourceSlug,
				message: error instanceof Error ? error.message : 'Could not merge these brands.'
			});
		}
	},

	repairOsmNode: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'repairOsmNode',
				message: 'Admin access required.'
			});
		}

		const form = await request.formData();
		const candidateId = formValue(form, 'candidate_id');
		const sourceBrandSlug = formValue(form, 'source_brand_slug');
		const disposition = formValue(form, 'disposition');
		const reason = formValue(form, 'reason');
		const newDisplay = formValue(form, 'new_display');
		let researchScope;
		try {
			researchScope = initialResearchScopeFromForm(form);
		} catch (scopeError) {
			return fail(400, {
				ok: false,
				action: 'repairOsmNode',
				brandSlug: sourceBrandSlug,
				message: scopeError instanceof Error ? scopeError.message : 'Research scope is invalid.'
			});
		}

		if (
			!isUuid(candidateId) ||
			!sourceBrandSlug ||
			!['remove', 'create_brand'].includes(disposition) ||
			!reason
		) {
			return fail(400, {
				ok: false,
				action: 'repairOsmNode',
				brandSlug: sourceBrandSlug,
				message: !reason ? 'A reason is required.' : 'The OSM node repair request is invalid.'
			});
		}

		if (disposition === 'create_brand' && !newDisplay) {
			return fail(400, {
				ok: false,
				action: 'repairOsmNode',
				brandSlug: sourceBrandSlug,
				message: 'A display name is required for the new brand.'
			});
		}

		if (reason.length > 1000) {
			return fail(400, {
				ok: false,
				action: 'repairOsmNode',
				brandSlug: sourceBrandSlug,
				message: 'The reason must be 1,000 characters or fewer.'
			});
		}

		const { data, error } = await locals.supabase.rpc(
			'admin_remove_osm_node_from_brand_with_scope',
			{
				p_candidate_id: candidateId,
				p_source_brand_slug: sourceBrandSlug,
				p_disposition: disposition,
				p_reason: reason,
				p_new_display: disposition === 'create_brand' ? newDisplay : null,
				p_research_scope: disposition === 'create_brand' ? researchScope : {}
			}
		);

		if (error) {
			return fail(400, {
				ok: false,
				action: 'repairOsmNode',
				brandSlug: sourceBrandSlug,
				message: error.message
			});
		}

		const result = data as {
			disposition?: string;
			new_brand_display?: string;
			new_brand_slug?: string;
			enrichment_job_id?: string;
		};
		return {
			ok: true,
			action: 'repairOsmNode',
			brandSlug: sourceBrandSlug,
			data,
			message:
				result.disposition === 'create_brand'
					? `Created ${result.new_brand_display ?? result.new_brand_slug} and queued enrichment.`
					: 'Removed the OSM node from the brand.'
		};
	},

	deleteBrand: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'deleteBrand',
				message: 'Admin access required.'
			});
		}
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const confirmationSlug = String(form.get('confirmation_slug') ?? '');
		const note = formValue(form, 'note');
		if (!slug || confirmationSlug !== slug || !note) {
			return fail(400, {
				ok: false,
				action: 'deleteBrand',
				brandSlug: slug,
				message:
					confirmationSlug !== slug
						? 'The confirmation slug must match exactly.'
						: 'A verification note is required.'
			});
		}

		const { data, error } = await locals.supabase.functions.invoke(
			'process-brand-enrichment-jobs',
			{
				body: {
					action: 'delete_false_positive_brand',
					brand_slug: slug,
					confirmation_slug: confirmationSlug,
					note
				}
			}
		);
		const responseError = actionError(data, '');
		if (error || responseError) {
			const message = responseError || (await functionErrorMessage(error));
			console.error('[brand catalog] deleteBrand', error ?? data);
			return fail(400, {
				ok: false,
				action: 'deleteBrand',
				brandSlug: slug,
				message
			});
		}

		return {
			ok: true,
			action: 'deleteBrand',
			brandSlug: slug,
			data,
			message: `Permanently deleted false-positive brand ${slug}.`
		};
	}
};
