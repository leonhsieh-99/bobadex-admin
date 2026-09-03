import { formatPostalAddress } from './maps';

export const STOREFRONT_RESOLUTIONS = {
	selectIdentity: 'select_identity',
	closedOrVacant: 'closed_or_vacant',
	keepUnresolved: 'keep_unresolved'
} as const;

export type StorefrontResolution =
	(typeof STOREFRONT_RESOLUTIONS)[keyof typeof STOREFRONT_RESOLUTIONS];

export type StorefrontObservation = {
	lat?: number | null;
	lon?: number | null;
	name?: string | null;
	address?: string | null;
	provider?: string | null;
	match_type?: string | null;
	candidate_id?: string | null;
	last_seen_at?: string | null;
	relationship?: string | null;
	observation_id?: string | null;
	identity_reason?: string | null;
	lifecycle_status?: string | null;
	match_distance_m?: number | null;
	provider_record_id?: string | null;
	provider_created_at?: string | null;
	provider_status_raw?: string | null;
	provider_refreshed_at?: string | null;
	source_url?: string | null;
	locality?: string | null;
	admin1?: string | null;
	postal_code?: string | null;
	display_address?: string | null;
};

export type StorefrontIdentityGroup = {
	label?: string | null;
	score?: number | null;
	identity_key: string;
	observations?: StorefrontObservation[];
	candidate_ids?: string[];
	closed_count?: number | null;
	current_count?: number | null;
	provider_count?: number | null;
	observation_count?: number | null;
	matched_brand_slug?: string | null;
	latest_provider_refresh?: string | null;
};

export type StorefrontDossier = {
	id: string;
	lat?: number | null;
	lon?: number | null;
	status?: string | null;
	evidence?: Record<string, unknown> | null;
	created_at?: string | null;
	region_key?: string | null;
	updated_at?: string | null;
	resolved_at?: string | null;
	address_input?: string | null;
	review_reason?: string | null;
	identity_groups?: StorefrontIdentityGroup[];
	normalized_address?: string | null;
	selected_identity_key?: string | null;
	canonical_candidate_id?: string | null;
	suggested_identity_key?: string | null;
	display_address?: string | null;
};

export function parseStorefrontReviewPayload(data: unknown): StorefrontDossier[] {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('invalid_storefront_review_payload');
	}
	const payload = data as { ok?: unknown; dossiers?: unknown };
	if (payload.ok !== true || !Array.isArray(payload.dossiers)) {
		throw new Error('invalid_storefront_review_payload');
	}
	return payload.dossiers.filter((row): row is StorefrontDossier =>
		Boolean(row && typeof row === 'object' && typeof (row as StorefrontDossier).id === 'string')
	);
}

export function storefrontReasonLabel(reason: string | null | undefined) {
	if (reason === 'competing_storefront_identities') return 'Competing identities';
	if (reason === 'same_identity_lifecycle_conflict') return 'Same identity, mixed open/closed';
	if (reason === 'generic_provider_closed_requires_confirmation')
		return 'Closed listing needs confirmation';
	if (reason === 'provider_identity_conflict') return 'Provider identity conflict';
	return (reason ?? 'Needs review').replaceAll('_', ' ');
}

export function storefrontRelationshipLabel(value: string | null | undefined) {
	if (value === 'primary') return 'Primary';
	if (value === 'corroborating') return 'Corroborating';
	if (value === 'conflicting') return 'Conflicting';
	return (value ?? 'Observation').replaceAll('_', ' ');
}

export function storefrontLifecycleLabel(value: string | null | undefined) {
	if (value === 'current') return 'Current';
	if (value === 'closed') return 'Closed';
	if (value === 'unknown') return 'Unknown';
	return (value ?? 'Unknown').replaceAll('_', ' ');
}

export function isStorefrontResolution(value: string): value is StorefrontResolution {
	return (Object.values(STOREFRONT_RESOLUTIONS) as string[]).includes(value);
}

export function dossierMatchesQuery(dossier: StorefrontDossier, query: string) {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const haystack = [
		dossier.display_address,
		dossier.address_input,
		dossier.normalized_address,
		dossier.region_key,
		dossier.review_reason,
		...(dossier.identity_groups ?? []).flatMap((group) => [
			group.label,
			group.identity_key,
			group.matched_brand_slug,
			...(group.observations ?? []).flatMap((observation) => [
				observation.name,
				observation.display_address,
				observation.locality
			])
		])
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	return haystack.includes(needle);
}

export function storefrontDisplayAddress(parts: {
	street?: string | null;
	locality?: string | null;
	admin1?: string | null;
	postalCode?: string | null;
}) {
	return formatPostalAddress(parts);
}

export function applyStorefrontPlaces(
	dossiers: StorefrontDossier[],
	places: Array<{
		id: string;
		address_input?: string | null;
		locality?: string | null;
		admin1?: string | null;
		postal_code?: string | null;
	}>
) {
	const byId = new Map(places.map((place) => [place.id, place]));
	return dossiers.map((dossier) => {
		const identity_groups = (dossier.identity_groups ?? []).map((group) => {
			const observations = (group.observations ?? []).map((observation) => {
				const place = observation.observation_id ? byId.get(observation.observation_id) : undefined;
				const locality = place?.locality ?? observation.locality;
				const admin1 = place?.admin1 ?? observation.admin1;
				const postal_code = place?.postal_code ?? observation.postal_code;
				return {
					...observation,
					locality,
					admin1,
					postal_code,
					display_address:
						storefrontDisplayAddress({
							street: observation.address ?? place?.address_input,
							locality,
							admin1,
							postalCode: postal_code
						}) ??
						observation.address ??
						null
				};
			});
			return { ...group, observations };
		});
		const place = identity_groups
			.flatMap((group) => group.observations ?? [])
			.find((observation) => observation.locality || observation.admin1 || observation.postal_code);
		return {
			...dossier,
			identity_groups,
			display_address:
				storefrontDisplayAddress({
					street: dossier.address_input ?? place?.address,
					locality: place?.locality,
					admin1: place?.admin1,
					postalCode: place?.postal_code
				}) ??
				dossier.address_input ??
				dossier.normalized_address ??
				null
		};
	});
}
