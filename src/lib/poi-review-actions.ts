export type ReviewActionState =
	| 'identity'
	| 'eligibility'
	| 'staleness'
	| 'matched'
	| 'creation_gate'
	| 'ready_create';

export type ReviewActionFlags = {
	state: ReviewActionState;
	showAttach: boolean;
	showCreate: boolean;
	showReject: boolean;
	showConfirmEligible: boolean;
	showConfirmCurrent: boolean;
	showRejectClosed: boolean;
	showReturnToReview: boolean;
	createEnabled: boolean;
	blockedCreateReasons: string[];
};

export type ReviewActionCandidate = {
	process_status: string;
	route_class?: string | null;
	process_reason?: string | null;
	matched_brand_slug?: string | null;
	brand_creation_gate_status?: string | null;
	risk_flags?: unknown;
};

export type ReviewActionReview = {
	review_kind?: string | null;
	status?: string | null;
	decision?: string | null;
} | null;

const FAILED_GATES = new Set(['failed', 'blocked', 'rejected', 'failed_gate', 'gate_failed']);
const PASSED_GATES = new Set(['passed', 'succeeded']);
const ACTIVE_STATUSES = new Set([
	'pending',
	'needs_exception_resolution',
	'needs_manual_review',
	'ready_for_enrichment'
]);

function flagList(riskFlags: unknown) {
	if (!riskFlags || typeof riskFlags !== 'object') return [] as string[];
	const flags = (riskFlags as { flags?: unknown }).flags;
	return Array.isArray(flags) ? flags.map((flag) => String(flag)) : [];
}

function routeOf(candidate: ReviewActionCandidate) {
	return candidate.route_class ?? '';
}

function reasonOf(candidate: ReviewActionCandidate) {
	return candidate.process_reason ?? '';
}

export function identityPassed(candidate: ReviewActionCandidate) {
	return (
		routeOf(candidate) !== 'exception_identity' &&
		!flagList(candidate.risk_flags).includes('identity_ambiguous')
	);
}

export function eligibilityPassed(candidate: ReviewActionCandidate) {
	return (
		routeOf(candidate) !== 'exception_eligibility' &&
		!flagList(candidate.risk_flags).includes('eligibility_category_risk')
	);
}

export function freshnessPassed(candidate: ReviewActionCandidate) {
	const reason = reasonOf(candidate);
	return (
		routeOf(candidate) !== 'exception_staleness' &&
		!flagList(candidate.risk_flags).includes('stale_provider_record') &&
		!reason.includes('closure_signal') &&
		!reason.includes('location_closed')
	);
}

export function creationGatePassed(candidate: ReviewActionCandidate, review: ReviewActionReview) {
	const gate = candidate.brand_creation_gate_status?.trim() ?? '';
	if (PASSED_GATES.has(gate)) return true;
	return (
		review?.review_kind === 'brand_creation_gate' &&
		review.status === 'completed' &&
		review.decision === 'passed'
	);
}

export function creationGateFailed(candidate: ReviewActionCandidate, review: ReviewActionReview) {
	const gate = candidate.brand_creation_gate_status?.trim() ?? '';
	if (FAILED_GATES.has(gate)) return true;
	if (routeOf(candidate).includes('creation_gate')) return true;
	return (
		review?.review_kind === 'brand_creation_gate' &&
		review.status === 'completed' &&
		review.decision !== 'passed'
	);
}

export function blockedCreateReasons(
	candidate: ReviewActionCandidate,
	review: ReviewActionReview = null
) {
	const reasons: string[] = [];
	if (!identityPassed(candidate)) reasons.push('identity');
	if (!eligibilityPassed(candidate)) reasons.push('eligibility');
	if (!freshnessPassed(candidate)) reasons.push('freshness');
	if (!creationGatePassed(candidate, review)) reasons.push('brand-creation gate');
	return reasons;
}

export function reviewActionState(
	candidate: ReviewActionCandidate,
	review: ReviewActionReview = null
): ReviewActionState {
	if (creationGateFailed(candidate, review)) return 'creation_gate';
	if (candidate.matched_brand_slug || routeOf(candidate).startsWith('auto_attach'))
		return 'matched';
	if (
		routeOf(candidate) === 'exception_staleness' ||
		routeOf(candidate) === 'deterministic_closed' ||
		flagList(candidate.risk_flags).includes('stale_provider_record') ||
		reasonOf(candidate).includes('closure_signal') ||
		reasonOf(candidate).includes('location_closed')
	) {
		return 'staleness';
	}
	if (
		routeOf(candidate) === 'exception_eligibility' ||
		flagList(candidate.risk_flags).includes('eligibility_category_risk')
	) {
		return 'eligibility';
	}
	if (
		candidate.process_status === 'ready_for_enrichment' &&
		creationGatePassed(candidate, review)
	) {
		return 'ready_create';
	}
	if (
		routeOf(candidate) === 'exception_identity' ||
		flagList(candidate.risk_flags).includes('identity_ambiguous')
	) {
		return 'identity';
	}
	return 'identity';
}

export function reviewActionFlags(
	candidate: ReviewActionCandidate,
	review: ReviewActionReview = null
): ReviewActionFlags {
	const state = reviewActionState(candidate, review);
	const blocked = blockedCreateReasons(candidate, review);
	const createEnabled = blocked.length === 0;
	const base: ReviewActionFlags = {
		state,
		showAttach: false,
		showCreate: false,
		showReject: false,
		showConfirmEligible: false,
		showConfirmCurrent: false,
		showRejectClosed: false,
		showReturnToReview: false,
		createEnabled,
		blockedCreateReasons: blocked
	};

	if (state === 'identity') {
		return { ...base, showAttach: true, showCreate: true, showReject: true };
	}
	if (state === 'eligibility') {
		return { ...base, showConfirmEligible: true, showCreate: true, showReject: true };
	}
	if (state === 'staleness') {
		return { ...base, showConfirmCurrent: true, showRejectClosed: true, showCreate: false };
	}
	if (state === 'matched') {
		return { ...base, showAttach: true, showCreate: false, showReject: true };
	}
	if (state === 'creation_gate') {
		return { ...base, showReject: true, showReturnToReview: true, showCreate: false };
	}
	return { ...base, showCreate: true, showAttach: true, showReject: true };
}

export function isActiveReviewCandidate(status: string) {
	return ACTIVE_STATUSES.has(status);
}

export function isCancelledLatestReview(review: ReviewActionReview) {
	return review?.status === 'cancelled';
}
