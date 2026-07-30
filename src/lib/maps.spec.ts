import { describe, expect, it } from 'vitest';
import { coordinatesLabel, googleMapsCoordinatesUrl } from './maps';

describe('Google Maps coordinate links', () => {
	it('builds the requested coordinate search URL', () => {
		expect(googleMapsCoordinatesUrl(34.052235, -118.243683)).toBe(
			'https://www.google.com/maps/search/?api=1&query=34.052235,-118.243683'
		);
		expect(coordinatesLabel(34.052235, -118.243683)).toBe('34.05224, -118.24368');
	});

	it.each([
		[null, -118],
		[34, null],
		[91, 0],
		[0, -181],
		[Number.NaN, 0]
	])('rejects invalid coordinates (%s, %s)', (lat, lon) => {
		expect(googleMapsCoordinatesUrl(lat, lon)).toBeNull();
		expect(coordinatesLabel(lat, lon)).toBeNull();
	});
});
