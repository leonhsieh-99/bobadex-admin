import type { RequestHandler } from './$types';

type BrandResult = {
	slug: string;
	display: string;
	website: string | null;
	wikidata: string | null;
	matched_alias: string | null;
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const GET: RequestHandler = async ({ url, locals }) => {
	const rawQuery = (url.searchParams.get('q') ?? '').trim();
	const query = rawQuery.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim();
	if (query.length < 2) return json([]);
	const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '');

	const [brandResult, aliasResult] = await Promise.all([
		locals.supabase
			.from('brands')
			.select('slug,display,website,wikidata')
			.or(`display.ilike.%${query}%,slug.ilike.%${query}%`)
			.order('display', { ascending: true })
			.limit(12),
		locals.supabase
			.from('brand_aliases')
			.select('brand_slug,normalized_name,alias_display')
			.or(`normalized_name.ilike.%${normalizedQuery}%,alias_display.ilike.%${query}%`)
			.limit(20)
	]);

	if (brandResult.error || aliasResult.error) {
		return json({ error: brandResult.error?.message ?? aliasResult.error?.message }, 500);
	}

	const results = new Map<string, BrandResult>();
	for (const brand of brandResult.data ?? []) {
		results.set(brand.slug, { ...brand, matched_alias: null });
	}

	const aliasRows = aliasResult.data ?? [];
	const missingSlugs = [
		...new Set(aliasRows.map((alias) => alias.brand_slug).filter((slug) => !results.has(slug)))
	];
	if (missingSlugs.length) {
		const { data: aliasBrands, error: aliasBrandError } = await locals.supabase
			.from('brands')
			.select('slug,display,website,wikidata')
			.in('slug', missingSlugs);
		if (aliasBrandError) return json({ error: aliasBrandError.message }, 500);
		for (const brand of aliasBrands ?? []) {
			const alias = aliasRows.find((row) => row.brand_slug === brand.slug);
			results.set(brand.slug, {
				...brand,
				matched_alias: alias?.alias_display ?? alias?.normalized_name ?? null
			});
		}
	}

	for (const alias of aliasRows) {
		const existing = results.get(alias.brand_slug);
		if (existing && !existing.matched_alias) {
			existing.matched_alias = alias.alias_display ?? alias.normalized_name;
		}
	}

	return json([...results.values()].slice(0, 20));
};
