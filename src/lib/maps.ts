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
