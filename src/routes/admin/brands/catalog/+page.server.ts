import { fail } from '@sveltejs/kit';
import { isBrandMatchPolicy } from '$lib/brand-match-policy';
import { mergeBrands } from '$lib/server/brand-merge.server';
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
		: 'node_count';
	const requestedSortDir = url.searchParams.get('dir');
	const sortDir: CatalogSortDir = catalogSortDirs.has(requestedSortDir as CatalogSortDir)
		? (requestedSortDir as CatalogSortDir)
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

	const catalogRows = (catalogResult.data ?? []) as Omit<CatalogRow, 'enrichment_mode'>[];
	const modeResult = catalogRows.length
		? await locals.supabase
				.from('brands')
				.select('slug,enrichment_mode')
				.in(
					'slug',
					catalogRows.map((brand) => brand.slug)
				)
		: { data: [], error: null };
	if (modeResult.error) {
		console.error('[brand catalog enrichment modes]', modeResult.error);
		throw new Error(`Failed to load enrichment modes: ${modeResult.error.message}`);
	}
	const modeBySlug = new Map(
		(modeResult.data ?? []).map((brand) => [
			brand.slug,
			brand.enrichment_mode as BrandEnrichmentMode
		])
	);
	const brands: CatalogRow[] = catalogRows.map((brand) => ({
		...brand,
		enrichment_mode: modeBySlug.get(brand.slug) ?? 'auto'
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

		const { data, error } = await locals.supabase.rpc('admin_update_brand_identity_v4', {
			p_brand_slug: slug,
			p_display: display,
			p_aliases: aliases,
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
