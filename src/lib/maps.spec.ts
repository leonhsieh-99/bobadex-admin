import { describe, expect, it } from 'vitest';
import {
	coordinatesLabel,
	formatPostalAddress,
	foursquarePlaceUrl,
	googleMapsCoordinatesUrl
} from './maps';

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

describe('formatPostalAddress', () => {
	it('appends city, state, and ZIP when the street line is street-only', () => {
		expect(
			formatPostalAddress({
				street: '123 Main St',
				locality: 'San Diego',
				admin1: 'CA',
				postalCode: '92101'
			})
		).toBe('123 Main St, San Diego, CA 92101');
	});

	it('keeps a street line that already includes the city', () => {
		expect(
			formatPostalAddress({
				street: '123 Main St, San Diego, CA 92101',
				locality: 'San Diego',
				admin1: 'CA',
				postalCode: '92101'
			})
		).toBe('123 Main St, San Diego, CA 92101');
	});
});

describe('foursquarePlaceUrl', () => {
	it('uses the public PlaceMaker review URL', () => {
		expect(foursquarePlaceUrl('4b8c3a0df964a5207f0c33e3')).toBe(
			'https://foursquare.com/placemakers/review-place/4b8c3a0df964a5207f0c33e3'
		);
	});
});
