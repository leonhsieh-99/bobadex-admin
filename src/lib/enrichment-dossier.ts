export type EnrichmentDossierView = {
	brand_slug: string;
	approval_status: string;
	customer_summary: string | null;
	public_summary_draft: string | null;
	research_topics: Record<string, unknown> | null;
	quality_metrics: Record<string, unknown> | null;
	updated_at: string;
	review_reasons: string[] | null;
	identity: {
		slug: string;
		display: string;
	};
	metrics: {
		overallConfidence: number | null;
		identityConfidence: number | null;
		citationCoverage: number | null;
		credibleSources: number | null;
		independentSources: number | null;
	};
	run: {
		id: string;
		model: string | null;
		researcher_version: string | null;
		input_snapshot: Record<string, unknown> | null;
		customer_summary_draft: string | null;
		public_summary_draft?: string | null;
		research_topics?: Record<string, unknown> | null;
		quality_metrics?: Record<string, unknown> | null;
	} | null;
	claims: Array<{
		claim_key: string;
		confidence: number | null;
		evidence_assessment: string | null;
	}>;
	integrityFlags: Array<{
		id: string;
		severity: string;
		title: string;
		details: unknown;
		recommended_action: string | null;
	}>;
	profile: {
		summary: string | null;
		public_summary?: string | null;
		summary_confidence: number | null;
		publication_method: string | null;
		published_at: string | null;
	} | null;
	physicalLocations: Array<{
		id: string;
		lat: number;
		lon: number;
		physical_status: string;
		city: string | null;
		county: string | null;
		region: string | null;
		evidence: Array<{
			source: string;
			source_key: string;
			osm_type: string | null;
			osm_id: number | null;
			verification_status: string | null;
		}>;
	}>;
	activeJob: { status: string } | null;
};

type ResearchRoute = 'local_identity' | 'established_brand' | 'identity_first';
type TopicCoverage = 'supported' | 'partial' | 'unavailable' | 'not_applicable';
type ResearchTopic = {
	coverage?: TopicCoverage;
	summary?: string;
	route?: ResearchRoute;
};

export const researchTopicRows = [
	{ key: 'identity', label: 'Identity' },
	{ key: 'classification_products', label: 'Classification & products' },
	{ key: 'origin_history', label: 'Origin & history' },
	{ key: 'footprint', label: 'Footprint' },
	{ key: 'visual_identity', label: 'Visual identity' }
] as const;

export function percent(value: number | null) {
	if (value == null) return 'Unknown';
	return `${Math.round(value * 100)}%`;
}

export function relativeDate(value: string | null) {
	if (!value) return 'Unknown';
	const elapsed = Date.now() - new Date(value).getTime();
	if (elapsed < 60_000) return 'Just now';
	const minutes = Math.max(1, Math.floor(elapsed / 60_000));
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function identityLabel(dossier: EnrichmentDossierView) {
	const claim =
		dossier.claims.find((item) =>
			['brand_identity', 'identity', 'brand_name', 'official_name'].includes(item.claim_key)
		) ?? null;
	if (claim?.confidence != null) {
		return `${percent(claim.confidence)} · ${claim.evidence_assessment ?? 'unassessed'}`;
	}
	return percent(dossier.metrics.identityConfidence);
}

export function dossierResearchTopics(dossier: EnrichmentDossierView) {
	return (dossier.research_topics ?? dossier.run?.research_topics ?? {}) as Partial<
		Record<(typeof researchTopicRows)[number]['key'], ResearchTopic>
	>;
}

export function researchRoute(dossier: EnrichmentDossierView): ResearchRoute | null {
	const metricRoute = dossier.run?.quality_metrics?.research_route;
	const dossierRoute = dossier.quality_metrics?.research_route;
	const snapshotRoute = dossier.run?.input_snapshot?.research_route;
	const topicRoute = dossierResearchTopics(dossier).identity?.route;
	const route = metricRoute ?? dossierRoute ?? snapshotRoute ?? topicRoute;
	return route === 'local_identity' || route === 'established_brand' || route === 'identity_first'
		? route
		: null;
}

export function researchRouteLabel(route: ResearchRoute | null) {
	if (route === 'local_identity') return 'Local identity';
	if (route === 'established_brand') return 'Established brand';
	if (route === 'identity_first') return 'Identity first';
	return 'Route unavailable';
}

export function canonicalResearchLocations(dossier: EnrichmentDossierView) {
	const raw = dossier.run?.input_snapshot?.canonical_location_context;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		const location = value as Record<string, unknown>;
		const label = typeof location.label === 'string' ? location.label.trim() : '';
		const address = typeof location.address === 'string' ? location.address.trim() : '';
		if (!label && !address) return [];
		return [{ label: label || address, address: address || null }];
	});
}

export function automaticGeography(dossier: EnrichmentDossierView) {
	const snapshot = dossier.run?.input_snapshot;
	if (!snapshot) return [];
	const raw = snapshot.automatic_geographic_context;
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	return raw.flatMap((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
		const geography = value as Record<string, unknown>;
		const label = typeof geography.label === 'string' ? geography.label.trim() : '';
		if (!label || seen.has(label.toLocaleLowerCase())) return [];
		seen.add(label.toLocaleLowerCase());
		return [
			{
				label,
				provider: typeof geography.provider === 'string' ? geography.provider : null,
				confidence: typeof geography.confidence === 'string' ? geography.confidence : null
			}
		];
	});
}

export function publicSummaryValue(dossier: EnrichmentDossierView) {
	return (
		dossier.public_summary_draft ??
		dossier.run?.public_summary_draft ??
		dossier.profile?.public_summary ??
		''
	);
}

export function topicCoverageClass(coverage: TopicCoverage | undefined) {
	if (coverage === 'supported') return 'bg-emerald-50 text-emerald-700';
	if (coverage === 'partial') return 'bg-amber-50 text-amber-700';
	return 'bg-zinc-100 text-zinc-600';
}

export function topicCoverageLabel(coverage: TopicCoverage | undefined) {
	return coverage === 'supported' || coverage === 'partial' ? coverage : 'unavailable';
}

export function flagDescription(details: unknown) {
	if (typeof details === 'string') return details;
	if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
	const description = (details as Record<string, unknown>).description;
	return typeof description === 'string' ? description : null;
}

export function flagSourceUrls(details: unknown) {
	if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
	const sourceUrls = (details as Record<string, unknown>).source_urls;
	return Array.isArray(sourceUrls)
		? sourceUrls.filter((url): url is string => typeof url === 'string')
		: [];
}

export function statusClasses(status: string) {
	if (status === 'succeeded' || status === 'published' || status === 'auto_published')
		return 'bg-emerald-50 text-emerald-700';
	if (status === 'failed') return 'bg-red-50 text-red-700';
	if (status === 'running') return 'bg-blue-50 text-blue-700';
	if (status === 'needs_review' || status === 'paused') return 'bg-amber-50 text-amber-800';
	return 'bg-zinc-100 text-zinc-700';
}

export function approvalStatusLabel(status: string) {
	if (status === 'needs_review') return 'Needs review';
	if (status === 'approved') return 'Published';
	if (status === 'rejected') return 'Rejected';
	return status.replaceAll('_', ' ');
}

export function approvalStatusClass(status: string) {
	if (status === 'approved') return 'bg-emerald-50 text-emerald-700';
	if (status === 'needs_review') return 'bg-amber-50 text-amber-800';
	if (status === 'rejected') return 'bg-red-50 text-red-700';
	return 'bg-zinc-100 text-zinc-700';
}
