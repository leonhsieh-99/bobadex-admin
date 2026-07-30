export const brandMatchPolicies = [
	'trusted_name_match',
	'corroboration_required',
	'manual_review'
] as const;

export type BrandMatchPolicy = (typeof brandMatchPolicies)[number];

export function isBrandMatchPolicy(value: unknown): value is BrandMatchPolicy {
	return typeof value === 'string' && brandMatchPolicies.some((policy) => policy === value);
}

export function brandMatchPolicyLabel(policy: BrandMatchPolicy) {
	return {
		trusted_name_match: 'Trusted name match',
		corroboration_required: 'Corroboration required',
		manual_review: 'Manual review'
	}[policy];
}

export function brandMatchPolicyDescription(policy: BrandMatchPolicy) {
	return {
		trusted_name_match: 'A recognized brand name can be matched deterministically.',
		corroboration_required: 'Name matches need supporting website, Wikidata, or source evidence.',
		manual_review: 'Matching always requires an admin decision.'
	}[policy];
}
