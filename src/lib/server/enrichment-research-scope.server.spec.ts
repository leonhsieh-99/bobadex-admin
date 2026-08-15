import { describe, expect, it } from 'vitest';
import { initialResearchScopeFromForm } from './enrichment-research-scope.server';

describe('initialResearchScopeFromForm', () => {
	it('builds typed anchors with independent roles', () => {
		const form = new FormData();
		form.set('scope_identity_basis', 'local');
		form.set('scope_identity_verified', 'true');
		form.set('scope_market', 'Australia');
		form.set('scope_market_role', 'exclude');
		form.set('scope_location_observation', 'Reno, Nevada');
		form.set('scope_location_role', 'prefer');
		form.set('scope_url', 'https://example.com/location');
		form.set('scope_url_role', 'include');

		expect(initialResearchScopeFromForm(form)).toMatchObject({
			identity_basis: 'local',
			identity_scope_verified: true,
			anchors: [
				{ type: 'market', role: 'exclude', value: 'Australia', curator_verified: true },
				{
					type: 'location_observation',
					role: 'prefer',
					value: 'Reno, Nevada',
					curator_verified: true
				},
				{
					type: 'url',
					role: 'include',
					value: 'https://example.com/location',
					curator_verified: true
				}
			]
		});
	});

	it('rejects non-HTTP research URLs', () => {
		const form = new FormData();
		form.set('scope_url', 'javascript:alert(1)');

		expect(() => initialResearchScopeFromForm(form)).toThrow(
			'The research URL must be a valid HTTP or HTTPS URL.'
		);
	});
});
