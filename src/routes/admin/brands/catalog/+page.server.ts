import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

type BrandStatus = 'active' | 'retired';

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
	profile_state: string;
	profile_summary: string | null;
	profile_confidence: number | null;
	dossier_status: string | null;
	refresh_after: string | null;
	open_flag_count: number;
	last_activity_at: string;
	total_count: number;
};

const pageSize = 50;

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

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = cleanSearch(url.searchParams.get('q'));
	const requestedStatus = url.searchParams.get('status');
	const status: BrandStatus | null =
		requestedStatus === 'active' || requestedStatus === 'retired' ? requestedStatus : null;
	const region = cleanSearch(url.searchParams.get('region'));
	const attentionOnly = url.searchParams.get('attention') === '1';
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);

	const [catalogResult, regionsResult] = await Promise.all([
		locals.supabase.rpc('admin_list_brand_catalog', {
			p_q: q || null,
			p_status: status,
			p_region_code: region || null,
			p_attention_only: attentionOnly,
			p_page: page,
			p_page_size: pageSize
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

	const brands = (catalogResult.data ?? []) as CatalogRow[];
	const total = Number(brands[0]?.total_count ?? 0);

	return {
		brands,
		regions: regionsResult.data ?? [],
		filters: { q, status: status ?? '', region, attentionOnly },
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
		if (!slug || !display) {
			return fail(400, {
				ok: false,
				action: 'updateIdentity',
				brandSlug: slug,
				message: 'A display name is required.'
			});
		}

		const { data, error } = await locals.supabase.rpc('admin_update_brand_identity_v2', {
			p_brand_slug: slug,
			p_display: display,
			p_aliases: aliases,
			p_website: website || null,
			p_wikidata: wikidata || null,
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
		return {
			ok: true,
			action: 'updateIdentity',
			brandSlug: slug,
			data,
			message: `Updated ${display}.`
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
	}
};
