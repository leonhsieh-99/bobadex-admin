export type ResearchAnchorRole = 'include' | 'exclude' | 'prefer';

export type InitialResearchScope = {
	identity_basis: 'official' | 'multi_location_cluster' | 'local' | 'ambiguous' | null;
	identity_scope_verified: boolean;
	research_directive: null;
	anchors: Array<{
		type: 'url' | 'market' | 'location_observation';
		role: ResearchAnchorRole;
		value: string;
		reference_id: null;
		curator_verified: boolean;
		notes: null;
	}>;
};

const identityBases = new Set(['official', 'multi_location_cluster', 'local', 'ambiguous']);
const anchorRoles = new Set<ResearchAnchorRole>(['include', 'exclude', 'prefer']);

function value(form: FormData, name: string) {
	return String(form.get(name) ?? '').trim();
}

function role(form: FormData, name: string, fallback: ResearchAnchorRole): ResearchAnchorRole {
	const candidate = value(form, name) as ResearchAnchorRole;
	return anchorRoles.has(candidate) ? candidate : fallback;
}

function isHttpUrl(candidate: string) {
	if (!candidate) return true;
	try {
		const url = new URL(candidate);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

export function initialResearchScopeFromForm(form: FormData): InitialResearchScope {
	const identityBasis = value(form, 'scope_identity_basis');
	const market = value(form, 'scope_market');
	const location = value(form, 'scope_location_observation');
	const url = value(form, 'scope_url');

	if (identityBasis && !identityBases.has(identityBasis)) {
		throw new Error('Choose a valid identity basis.');
	}
	if ([market, location].some((anchor) => anchor.length > 2048)) {
		throw new Error('Market and location observations must be 2,048 characters or fewer.');
	}
	if (url.length > 2048 || !isHttpUrl(url)) {
		throw new Error('The research URL must be a valid HTTP or HTTPS URL.');
	}

	const curatorVerified = value(form, 'scope_identity_verified') === 'true';
	const anchors: InitialResearchScope['anchors'] = [];
	if (market) {
		anchors.push({
			type: 'market',
			role: role(form, 'scope_market_role', 'include'),
			value: market,
			reference_id: null,
			curator_verified: curatorVerified,
			notes: null
		});
	}
	if (location) {
		anchors.push({
			type: 'location_observation',
			role: role(form, 'scope_location_role', 'prefer'),
			value: location,
			reference_id: null,
			curator_verified: curatorVerified,
			notes: null
		});
	}
	if (url) {
		anchors.push({
			type: 'url',
			role: role(form, 'scope_url_role', 'include'),
			value: url,
			reference_id: null,
			curator_verified: curatorVerified,
			notes: null
		});
	}

	return {
		identity_basis: identityBasis
			? (identityBasis as Exclude<InitialResearchScope['identity_basis'], null>)
			: null,
		identity_scope_verified: curatorVerified,
		research_directive: null,
		anchors
	};
}
