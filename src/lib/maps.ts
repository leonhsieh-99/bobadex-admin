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
