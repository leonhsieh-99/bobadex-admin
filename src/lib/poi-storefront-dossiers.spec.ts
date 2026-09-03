import { describe, expect, it } from 'vitest';
import {
	applyStorefrontPlaces,
	dossierMatchesQuery,
	isStorefrontResolution,
	parseStorefrontReviewPayload,
	STOREFRONT_RESOLUTIONS,
	storefrontReasonLabel
} from './poi-storefront-dossiers';

describe('parseStorefrontReviewPayload', () => {
	it('reads dossiers from the admin RPC envelope', () => {
		expect(
			parseStorefrontReviewPayload({
				ok: true,
				dossiers: [{ id: '11111111-1111-1111-1111-111111111111', address_input: '540 Bryant St' }]
			})
		).toEqual([{ id: '11111111-1111-1111-1111-111111111111', address_input: '540 Bryant St' }]);
	});

	it('rejects a non-admin payload', () => {
		expect(() => parseStorefrontReviewPayload([{ id: 'x' }])).toThrow(
			'invalid_storefront_review_payload'
		);
	});
});

describe('storefront helpers', () => {
	it('accepts the three admin resolutions', () => {
		expect(isStorefrontResolution(STOREFRONT_RESOLUTIONS.selectIdentity)).toBe(true);
		expect(isStorefrontResolution(STOREFRONT_RESOLUTIONS.closedOrVacant)).toBe(true);
		expect(isStorefrontResolution(STOREFRONT_RESOLUTIONS.keepUnresolved)).toBe(true);
		expect(isStorefrontResolution('select_current')).toBe(false);
	});

	it('filters dossiers by address or identity label', () => {
		const dossier = {
			id: '1',
			address_input: '540 Bryant St',
			display_address: '540 Bryant St, Palo Alto, CA 94301',
			identity_groups: [{ identity_key: 'brand:sharetea', label: 'Sharetea' }]
		};
		expect(dossierMatchesQuery(dossier, 'bryant')).toBe(true);
		expect(dossierMatchesQuery(dossier, 'palo alto')).toBe(true);
		expect(dossierMatchesQuery(dossier, 'sharetea')).toBe(true);
		expect(dossierMatchesQuery(dossier, 'tong sui')).toBe(false);
	});

	it('composes city and ZIP onto street-only dossier addresses', () => {
		const [dossier] = applyStorefrontPlaces(
			[
				{
					id: '1',
					address_input: '540 Bryant St',
					identity_groups: [
						{
							identity_key: 'brand:sharetea',
							observations: [{ observation_id: 'obs-1', address: '540 Bryant St' }]
						}
					]
				}
			],
			[{ id: 'obs-1', locality: 'Palo Alto', admin1: 'CA', postal_code: '94301' }]
		);
		expect(dossier.display_address).toBe('540 Bryant St, Palo Alto, CA 94301');
		expect(dossier.identity_groups?.[0].observations?.[0].display_address).toBe(
			'540 Bryant St, Palo Alto, CA 94301'
		);
	});
});
