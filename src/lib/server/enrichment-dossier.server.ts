import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnrichmentDossierView } from '$lib/enrichment-dossier';

type JsonRecord = Record<string, unknown>;

export type { EnrichmentDossierView };

function readMetric(metrics: JsonRecord | null | undefined, key: string) {
	const value = metrics?.[key];
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

export async function loadBrandEnrichmentDossier(
	supabase: SupabaseClient,
	brandSlug: string
): Promise<{ brand: { slug: string; display: string } | null; dossier: EnrichmentDossierView | null }> {
	const { data: brand, error: brandError } = await supabase
		.from('brands')
		.select('slug,display,website,wikidata,status,match_policy,enrichment_mode')
		.eq('slug', brandSlug)
		.maybeSingle();
	if (brandError) throw new Error(brandError.message);
	if (!brand) return { brand: null, dossier: null };

	const { data: dossier, error: dossierError } = await supabase
		.schema('mod')
		.from('brand_dossiers')
		.select(
			'brand_slug,research_run_id,approval_status,customer_summary,public_summary_draft,research_topics,quality_metrics,updated_at,review_reasons'
		)
		.eq('brand_slug', brandSlug)
		.maybeSingle();
	if (dossierError) throw new Error(dossierError.message);
	if (!dossier) return { brand: { slug: brand.slug, display: brand.display }, dossier: null };

	const runId = dossier.research_run_id as string | null;
	const [
		runResult,
		claimsResult,
		flagsResult,
		profileResult,
		jobResult,
		locationsResult
	] = await Promise.all([
		runId
			? supabase
					.schema('ingest')
					.from('brand_research_runs')
					.select(
						'id,model,researcher_version,input_snapshot,customer_summary_draft,public_summary_draft,research_topics,quality_metrics,overall_confidence'
					)
					.eq('id', runId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		runId
			? supabase
					.schema('ingest')
					.from('brand_research_claims')
					.select('claim_key,confidence,evidence_assessment')
					.eq('run_id', runId)
			: Promise.resolve({ data: [], error: null }),
		supabase
			.schema('mod')
			.from('brand_integrity_flags')
			.select('id,severity,status,title,details,recommended_action')
			.eq('brand_slug', brandSlug)
			.order('last_seen_at', { ascending: false }),
		supabase
			.from('brand_profiles')
			.select('summary,public_summary,summary_confidence,publication_method,published_at')
			.eq('brand_slug', brandSlug)
			.maybeSingle(),
		supabase
			.schema('ingest')
			.from('brand_enrichment_jobs')
			.select('status')
			.eq('brand_slug', brandSlug)
			.in('status', ['queued', 'running'])
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		supabase.rpc('admin_get_brand_physical_locations', { p_brand_slug: brandSlug })
	]);

	for (const [label, result] of [
		['Research run', runResult],
		['Claims', claimsResult],
		['Integrity flags', flagsResult],
		['Profile', profileResult],
		['Enrichment job', jobResult],
		['Physical locations', locationsResult]
	] as const) {
		if (result.error) {
			console.error(`[enrichment dossier] ${label}`, result.error);
			throw new Error(result.error.message);
		}
	}

	const run = runResult.data;
	const qualityMetrics = (dossier.quality_metrics ?? run?.quality_metrics ?? null) as JsonRecord | null;

	return {
		brand: { slug: brand.slug, display: brand.display },
		dossier: {
			brand_slug: dossier.brand_slug,
			approval_status: dossier.approval_status,
			customer_summary: dossier.customer_summary,
			public_summary_draft: dossier.public_summary_draft,
			research_topics: (dossier.research_topics ?? null) as JsonRecord | null,
			quality_metrics: qualityMetrics,
			updated_at: dossier.updated_at,
			review_reasons: dossier.review_reasons ?? null,
			identity: {
				slug: brand.slug,
				display: brand.display
			},
			metrics: {
				overallConfidence:
					readMetric(qualityMetrics, 'overall_confidence') ?? run?.overall_confidence ?? null,
				identityConfidence: readMetric(qualityMetrics, 'identity_confidence'),
				citationCoverage: readMetric(qualityMetrics, 'citation_coverage'),
				credibleSources: readMetric(qualityMetrics, 'credible_source_count'),
				independentSources: readMetric(qualityMetrics, 'independent_linked_source_count')
			},
			run: run
				? {
						id: run.id,
						model: run.model,
						researcher_version: run.researcher_version,
						input_snapshot: (run.input_snapshot ?? null) as JsonRecord | null,
						customer_summary_draft: run.customer_summary_draft,
						public_summary_draft: run.public_summary_draft,
						research_topics: (run.research_topics ?? null) as JsonRecord | null,
						quality_metrics: (run.quality_metrics ?? null) as JsonRecord | null
					}
				: null,
			claims: ((claimsResult.data ?? []) as EnrichmentDossierView['claims']),
			integrityFlags: ((flagsResult.data ?? []) as Array<{
				id: string;
				severity: string;
				status: string;
				title: string;
				details: unknown;
				recommended_action: string | null;
			}>)
				.filter((flag) => flag.status !== 'resolved' && flag.status !== 'closed')
				.map(({ id, severity, title, details, recommended_action }) => ({
					id,
					severity,
					title,
					details,
					recommended_action
				})),
			profile: profileResult.data ?? null,
			physicalLocations: (locationsResult.data ?? []) as EnrichmentDossierView['physicalLocations'],
			activeJob: jobResult.data ? { status: jobResult.data.status } : null
		}
	};
}
