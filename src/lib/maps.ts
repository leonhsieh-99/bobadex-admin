export function googleMapsCoordinatesUrl(lat: number | null, lon: number | null) {
	if (
		typeof lat !== 'number' ||
		typeof lon !== 'number' ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lon) ||
		lat < -90 ||
		lat > 90 ||
		lon < -180 ||
		lon > 180
	) {
		return null;
	}

	return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function coordinatesLabel(lat: number | null, lon: number | null) {
	return googleMapsCoordinatesUrl(lat, lon) ? `${lat?.toFixed(5)}, ${lon?.toFixed(5)}` : null;
}

export function formatPostalAddress(parts: {
	street?: string | null;
	locality?: string | null;
	admin1?: string | null;
	postalCode?: string | null;
}) {
	const street = parts.street?.trim() || '';
	const locality = parts.locality?.trim() || '';
	const admin1 = parts.admin1?.trim() || '';
	const postalCode = parts.postalCode?.trim() || '';
	const cityLine = [locality, [admin1, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	if (street && locality && street.toLowerCase().includes(locality.toLowerCase())) return street;
	return [street, cityLine].filter(Boolean).join(', ') || null;
}

export function foursquarePlaceUrl(providerRecordId: string | null | undefined) {
	const id = providerRecordId?.trim();
	return id ? `https://foursquare.com/placemakers/review-place/${encodeURIComponent(id)}` : null;
}

export type LocationEvidenceRef = {
	source?: string | null;
	source_key?: string | null;
	osm_type?: string | null;
	osm_id?: number | null;
	lat?: number | null;
	lon?: number | null;
	address_input?: string | null;
	source_url?: string | null;
	verification_status?: string | null;
};

export function locationEvidenceSource(evidence: LocationEvidenceRef) {
	const source = evidence.source?.trim().toLowerCase() ?? '';
	if (source === 'foursquare') return 'fsq';
	if (source === 'osm' || source === 'fsq' || source === 'overture' || source === 'manual') {
		return source;
	}
	if (evidence.osm_id) return 'osm';
	return source || 'manual';
}

export function locationEvidenceLabel(evidence: LocationEvidenceRef) {
	const source = locationEvidenceSource(evidence);
	const address = evidence.address_input?.trim();
	if (source === 'osm') {
		return `OSM ${evidence.osm_type ?? 'node'} ${evidence.osm_id ?? evidence.source_key ?? ''}`.trim();
	}
	if (source === 'fsq') {
		return ['FSQ', evidence.source_key, address].filter(Boolean).join(' · ');
	}
	if (source === 'overture') {
		return ['Overture', evidence.source_key, address].filter(Boolean).join(' · ');
	}
	return [
		'Manual',
		evidence.verification_status ?? 'unverified',
		address
	]
		.filter(Boolean)
		.join(' · ');
}

export function locationEvidenceHref(evidence: LocationEvidenceRef) {
	if (evidence.source_url?.trim()) return evidence.source_url.trim();
	if (locationEvidenceSource(evidence) === 'fsq') {
		return foursquarePlaceUrl(evidence.source_key);
	}
	return googleMapsCoordinatesUrl(evidence.lat ?? null, evidence.lon ?? null);
}
