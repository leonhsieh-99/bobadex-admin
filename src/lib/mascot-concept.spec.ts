import { describe, expect, it } from 'vitest';
import { conceptDirection, conceptPalette, conceptSummary } from './mascot-concept';

const currentConcept = {
	mode: 'brand_grounded',
	subject: 'A poised potato-bodied restaurant companion with a broad scalloped mane edge',
	primary_motif: 'mane_edge flaring outward',
	pose: 'Leaning lightly, face toward the viewer',
	expression: 'half-lidded eyes, small sleepy smile',
	accessory: 'a simple collar with one charm',
	palette: ['slate gray', 'warm cream', 'muted gold']
};

const legacyConcept = {
	ancestry_family: 'An original upright three-sense glider',
	body_plan: 'Upright two-legged creature with a pear-shaped torso',
	dominant_feature: 'A soft tri-lobed auditory crown',
	secondary_marking: 'Three oval markings beneath each eye',
	temperament_pose: 'Balanced on one foot'
};

describe('mascot concept display', () => {
	it('summarizes the current subject-led concept', () => {
		expect(conceptSummary(currentConcept)).toBe(currentConcept.subject);
		expect(conceptDirection(currentConcept)).toContain('mane_edge flaring outward');
		expect(conceptPalette(currentConcept)).toBe('slate gray, warm cream, muted gold');
	});

	it('falls back to the older ancestry fields', () => {
		expect(conceptSummary(legacyConcept)).toBe(
			'An original upright three-sense glider · Upright two-legged creature with a pear-shaped torso'
		);
		expect(conceptDirection(legacyConcept)).toContain('tri-lobed auditory crown');
	});

	it('treats missing current fields as unavailable', () => {
		expect(conceptSummary({ mode: 'house_fallback' })).toBe('');
	});
});
