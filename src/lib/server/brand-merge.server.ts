import { supabaseAdmin } from '$lib/supabase.server';

export type BrandMergePreview = {
	source: {
		slug: string;
		display: string;
		status: string;
		website: string | null;
		wikidata: string | null;
	};
	target: {
		slug: string;
		display: string;
		status: string;
		website: string | null;
		wikidata: string | null;
		logo_url: string | null;
		icon_path: string | null;
	};
	counts: {
		shops: number;
		feed_events: number;
		osm_candidates: number;
		reference_locations: number;
		aliases: number;
		sources: number;
		regions: number;
		research_runs: number;
		dossiers: number;
		published_profiles: number;
		open_integrity_flags: number;
		active_enrichment_jobs: number;
	};
	decisions: Record<string, string>;
};

function requireAdmin(locals: App.Locals) {
	if (!locals.isAdmin || !locals.userId) {
		throw new Error('Admin access required.');
	}
	return locals.userId;
}

export async function previewBrandMerge(
	locals: App.Locals,
	sourceSlug: string,
	targetSlug: string
) {
	const reviewerId = requireAdmin(locals);
	const { data, error } = await supabaseAdmin().rpc('admin_preview_brand_merge', {
		p_source_slug: sourceSlug,
		p_target_slug: targetSlug,
		p_reviewer_id: reviewerId
	});
	if (error) throw new Error(error.message);
	return data as BrandMergePreview;
}

export async function mergeBrands(
	locals: App.Locals,
	input: {
		sourceSlug: string;
		targetSlug: string;
		reason: string;
		markTargetForReview: boolean;
	}
) {
	const reviewerId = requireAdmin(locals);
	const { data, error } = await supabaseAdmin().rpc('admin_merge_brands', {
		p_source_slug: input.sourceSlug,
		p_target_slug: input.targetSlug,
		p_reason: input.reason,
		p_reviewer_id: reviewerId,
		p_mark_target_for_review: input.markTargetForReview
	});
	if (error) throw new Error(error.message);
	return data as {
		ok: boolean;
		source_slug: string;
		target_slug: string;
		target_display: string;
		shops_moved: number;
		aliases_moved: number;
		sources_moved: number;
		source_status: 'merged';
		impact_counts: Record<string, number>;
	};
}
