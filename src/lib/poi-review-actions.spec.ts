import { describe, expect, it } from 'vitest';
import { blockedCreateReasons, reviewActionFlags, reviewActionState } from './poi-review-actions';

describe('reviewActionState', () => {
	it('treats identity exceptions as identity ambiguity', () => {
		expect(
			reviewActionState({
				process_status: 'needs_exception_resolution',
				route_class: 'exception_identity',
				risk_flags: { flags: ['identity_ambiguous'] }
			})
		).toBe('identity');
	});

	it('treats eligibility exceptions as eligibility ambiguity', () => {
		expect(
			reviewActionState({
				process_status: 'needs_exception_resolution',
				route_class: 'exception_eligibility',
				risk_flags: { flags: ['eligibility_category_risk'] }
			})
		).toBe('eligibility');
	});

	it('treats closure signals on low-risk create as staleness', () => {
		expect(
			reviewActionState({
				process_status: 'needs_manual_review',
				route_class: 'low_risk_create',
				process_reason: 'manual_search_exact_closure_signal_requires_source_review'
			})
		).toBe('staleness');
	});

	it('hides create when a brand is already matched', () => {
		const flags = reviewActionFlags({
			process_status: 'pending',
			route_class: 'auto_attach_exact',
			matched_brand_slug: 'happylemon-859a55'
		});
		expect(flags.state).toBe('matched');
		expect(flags.showCreate).toBe(false);
		expect(flags.showAttach).toBe(true);
	});

	it('hides create after a failed brand-creation gate', () => {
		const flags = reviewActionFlags(
			{
				process_status: 'needs_manual_review',
				route_class: 'low_risk_create',
				brand_creation_gate_status: 'failed'
			},
			{ review_kind: 'brand_creation_gate', status: 'completed', decision: 'failed' }
		);
		expect(flags.state).toBe('creation_gate');
		expect(flags.showCreate).toBe(false);
		expect(flags.showReturnToReview).toBe(true);
		expect(flags.showReject).toBe(true);
	});
});

describe('create gate', () => {
	it('keeps create disabled until identity, eligibility, freshness, and the creation gate pass', () => {
		expect(
			blockedCreateReasons({
				process_status: 'needs_exception_resolution',
				route_class: 'exception_identity',
				risk_flags: { flags: ['identity_ambiguous'] }
			})
		).toEqual(['identity', 'brand-creation gate']);
	});

	it('enables create only after every gate has passed', () => {
		const flags = reviewActionFlags(
			{
				process_status: 'ready_for_enrichment',
				route_class: 'low_risk_create',
				brand_creation_gate_status: 'passed'
			},
			{ review_kind: 'brand_creation_gate', status: 'completed', decision: 'passed' }
		);
		expect(flags.createEnabled).toBe(true);
		expect(flags.showCreate).toBe(true);
	});
});
