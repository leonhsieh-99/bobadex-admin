import { supabaseAdmin } from '$lib/supabase.server';
import type { RequestHandler } from './$types';

type BrandResult = {
	slug: string;
	display: string;
	website: string | null;
	wikidata: string | null;
	enrichment_location_anchor: string | null;
	matched_alias: string | null;
	observed_osm_nodes: number;
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.isAdmin) return json({ error: 'Admin access required.' }, 403);

	const rawQuery = (url.searchParams.get('q') ?? '').trim();
	const query = rawQuery
		.replace(/[,%()]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (query.length < 2) return json([]);
	const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const admin = supabaseAdmin();

	const [brandResult, aliasResult] = await Promise.all([
		admin
			.from('brands')
			.select('slug,display,website,wikidata,enrichment_location_anchor')
			.or(`display.ilike.%${query}%,slug.ilike.%${query}%`)
			.eq('status', 'active')
			.eq('is_demo', false)
			.order('display', { ascending: true })
			.limit(12),
		admin
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
		results.set(brand.slug, { ...brand, matched_alias: null, observed_osm_nodes: 0 });
	}

	const aliasRows = aliasResult.data ?? [];
	const missingSlugs = [
		...new Set(aliasRows.map((alias) => alias.brand_slug).filter((slug) => !results.has(slug)))
	];
	if (missingSlugs.length) {
		const { data: aliasBrands, error: aliasBrandError } = await admin
			.from('brands')
			.select('slug,display,website,wikidata,enrichment_location_anchor')
			.in('slug', missingSlugs)
			.eq('status', 'active')
			.eq('is_demo', false);
		if (aliasBrandError) return json({ error: aliasBrandError.message }, 500);
		for (const brand of aliasBrands ?? []) {
			const alias = aliasRows.find((row) => row.brand_slug === brand.slug);
			results.set(brand.slug, {
				...brand,
				matched_alias: alias?.alias_display ?? alias?.normalized_name ?? null,
				observed_osm_nodes: 0
			});
		}
	}

	for (const alias of aliasRows) {
		const existing = results.get(alias.brand_slug);
		if (existing && !existing.matched_alias) {
			existing.matched_alias = alias.alias_display ?? alias.normalized_name;
		}
	}

	const resultSlugs = [...results.keys()];
	if (resultSlugs.length) {
		const { data: observedNodes, error: observedNodesError } = await admin
			.schema('ingest')
			.from('osm_candidate_pipeline_states')
			.select('id,source_key,matched_brand_slug')
			.in('matched_brand_slug', resultSlugs)
			.limit(5000);

		if (observedNodesError) return json({ error: observedNodesError.message }, 500);

		const nodeKeysByBrand = new Map<string, Set<string>>();
		for (const node of observedNodes ?? []) {
			if (!node.matched_brand_slug) continue;
			const keys = nodeKeysByBrand.get(node.matched_brand_slug) ?? new Set<string>();
			keys.add(node.source_key || node.id);
			nodeKeysByBrand.set(node.matched_brand_slug, keys);
		}

		for (const result of results.values()) {
			result.observed_osm_nodes = nodeKeysByBrand.get(result.slug)?.size ?? 0;
		}
	}

	return json([...results.values()].slice(0, 20));
};
