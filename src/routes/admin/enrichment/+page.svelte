<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import BrandIdentityFields from '$lib/BrandIdentityFields.svelte';
	import BrandMatchPolicyField from '$lib/BrandMatchPolicyField.svelte';
	import BrandMergeDialog from '$lib/BrandMergeDialog.svelte';
	import EnrichmentDossierCard from '$lib/EnrichmentDossierCard.svelte';
	import GeoPlaceTypeahead from '$lib/GeoPlaceTypeahead.svelte';
	import { isBrandMatchPolicy, type BrandMatchPolicy } from '$lib/brand-match-policy';
	import { coordinatesLabel, googleMapsCoordinatesUrl } from '$lib/maps';
	import { toasts } from '$lib/toast';
	import { onMount } from 'svelte';
	import type { SubmitFunction } from './$types';

	type Citation = {
		citation_role: string | null;
		evidence_excerpt: string | null;
		source: {
			id: string;
			url: string;
			title: string | null;
			publisher: string | null;
			credibility: string | number | null;
		} | null;
	};

	type BrandIdentity = {
		slug: string;
		display: string;
		website: string | null;
		wikidata: string | null;
		enrichment_mode: 'auto' | 'manual_only' | 'disabled';
		enrichment_location_anchor: string | null;
		aliases: Array<{
			id: number;
			normalized_name: string;
			alias_display: string | null;
			match_mode: string;
		}>;
		match_policy: BrandMatchPolicy;
	};

	type MarketPresencePlace = {
		place_id: string | null;
		level: 'country' | 'admin1' | 'metro' | 'city';
		name: string;
		code: string | null;
		display_name: string;
		country_code: string | null;
		country_name: string | null;
		admin1_code: string | null;
		admin1_name: string | null;
		metro_code: string | null;
		metro_name: string | null;
		confidence: number;
	};

	type GeoPlaceResult = Omit<MarketPresencePlace, 'confidence'>;
	type ResearchRoute = 'local_identity' | 'established_brand' | 'identity_first';
	type TopicCoverage = 'supported' | 'partial' | 'unavailable' | 'not_applicable';
	type ResearchTopic = {
		coverage?: TopicCoverage;
		summary?: string;
		claim_keys?: string[];
		route?: ResearchRoute;
		scale?: string;
		basis?: string;
	};
	type ResearchTopics = Partial<
		Record<
			'identity' | 'classification_products' | 'origin_history' | 'footprint' | 'visual_identity',
			ResearchTopic
		>
	>;

	type ResearchAnchor = {
		clientKey: string;
		id?: string;
		type: 'url' | 'market' | 'social' | 'location_observation';
		role: 'include' | 'exclude' | 'prefer';
		value: string;
		reference_id: string;
		curator_verified: boolean;
		notes: string;
	};

	type ResearchScope = {
		brand_slug?: string;
		identity_basis: 'official' | 'multi_location_cluster' | 'local' | 'ambiguous' | '';
		identity_scope_verified: boolean;
		research_directive: string;
		anchors: ResearchAnchor[];
		updated_at?: string | null;
	};

	type PublishableDossier = {
		brand_slug: string;
		approval_status: string;
		customer_summary: string | null;
		public_summary_draft: string | null;
		research_topics: ResearchTopics | null;
		quality_metrics?: Record<string, unknown> | null;
		profile_facts: Record<string, unknown>;
		profile?: {
			summary: string | null;
			public_summary: string | null;
			public_summary_source_run_id: string | null;
			public_summary_model: string | null;
			public_summary_generated_at: string | null;
			summary_confidence: number | null;
			publication_method: string | null;
			published_at: string | null;
		} | null;
		recommended_match_policy: BrandMatchPolicy;
		identity: BrandIdentity;
		activeJob: EnrichmentJob | null;
		claims?: Array<{
			id: string;
			claim_key: string;
			claim_value: unknown;
			confidence: number | null;
			evidence_assessment: string | null;
			materiality: string | null;
			rationale: string | null;
			citations: Citation[];
		}>;
		physicalLocations?: Array<{
			id: string;
			lat: number;
			lon: number;
			physical_status: string;
			city: string | null;
			county: string | null;
			region: string | null;
			evidence: Array<{
				source: string;
				source_key: string;
				osm_type: string | null;
				osm_id: number | null;
				verification_status: string | null;
			}>;
		}>;
		enrichmentFootprint?: Array<{
			brand_slug: string;
			place_id: string;
			location_count: number;
			level: string;
			code: string;
			name: string;
		}>;
		run?: {
			id: string;
			model: string | null;
			researcher_version: string | null;
			input_snapshot: Record<string, unknown> | null;
			customer_summary_draft: string | null;
			public_summary_draft: string | null;
			research_topics: ResearchTopics | null;
			quality_metrics: Record<string, unknown> | null;
			creative_brief_draft: Record<string, unknown> | string | null;
			error_text: string | null;
		} | null;
	};

	type Dossier = PublishableDossier & {
		creative_brief: Record<string, unknown> | string | null;
		quality_metrics: Record<string, unknown> | null;
		match_policy_route: string | null;
		match_policy_evidence: Record<string, unknown>;
		last_researched_at: string | null;
		updated_at: string;
		review_reasons: string[] | null;
		metrics: {
			overallConfidence: number | null;
			identityConfidence: number | null;
			citationCoverage: number | null;
			credibleSources: number | null;
			independentSources: number | null;
		};
		run: {
			id: string;
			model: string | null;
			researcher_version: string | null;
			input_snapshot: Record<string, unknown> | null;
			customer_summary_draft: string | null;
			creative_brief_draft: Record<string, unknown> | string | null;
			error_text: string | null;
		} | null;
		claims: Array<{
			id: string;
			claim_key: string;
			claim_value: unknown;
			confidence: number | null;
			evidence_assessment: string | null;
			materiality: string | null;
			rationale: string | null;
			citations: Citation[];
		}>;
		integrityFlags: Array<{
			id: string;
			severity: string;
			title: string;
			details: unknown;
			recommended_action: string | null;
		}>;
		profile: {
			summary: string | null;
			public_summary: string | null;
			public_summary_source_run_id: string | null;
			public_summary_model: string | null;
			public_summary_generated_at: string | null;
			summary_confidence: number | null;
			publication_method: string | null;
			published_at: string | null;
		} | null;
		physicalLocations: Array<{
			id: string;
			lat: number;
			lon: number;
			physical_status: string;
			city: string | null;
			county: string | null;
			region: string | null;
			evidence: Array<{
				source: string;
				source_key: string;
				osm_type: string | null;
				osm_id: number | null;
				verification_status: string | null;
			}>;
		}>;
		enrichmentFootprint: Array<{
			brand_slug: string;
			place_id: string;
			location_count: number;
			level: string;
			code: string;
			name: string;
		}>;
	};

	type EnrichmentJob = {
		id: string;
		brand_slug: string;
		trigger_kind: string;
		status: string;
		attempt_count: number;
		max_attempts: number;
		available_at: string;
		claimed_at: string | null;
		lease_expires_at: string | null;
		last_error: string | null;
		paused: boolean;
		controlled: boolean;
		autoPublishRequested: boolean;
		created_at: string;
		completed_at?: string | null;
		run: {
			id: string;
			status: string;
			researcherVersion: string | null;
			startedAt: string | null;
			completedAt: string | null;
			error: string | null;
			executedQueries: string[];
			retrievedSources: Array<{ url: string | null; title: string | null }>;
			retainedSources: Array<{ id: string; url: string; title: string | null }>;
			qualityMetrics: Record<string, unknown>;
			reviewReasons: string[];
			autoPublishEligible: boolean | null;
			approvalStatus: string | null;
			gate: {
				status: string;
				version: string | null;
				identityConfidence: number | null;
				hasAdequateInput: boolean;
				hasBlockingFlag: boolean;
				locationAnchor: string | null;
			};
		} | null;
	};

	type CronState = {
		serverTime: string | null;
		configured: boolean;
		jobs: Array<{
			jobid: number;
			jobname: string | null;
			schedule: string;
			active: boolean;
		}>;
		runs: Array<{
			jobid: number;
			status: string;
			start_time: string;
			end_time: string | null;
			return_message: string | null;
		}>;
		error: string | null;
	};

	type EnrichmentHistoryRow = {
		id: string;
		brand_slug: string;
		display: string;
		trigger_kind: string;
		status: string;
		result: string;
		auto_publish_requested: boolean;
		researcher_version: string | null;
		overall_confidence: number | null;
		approval_status: string | null;
		approval_method: string | null;
		last_error: string | null;
		created_at: string;
		completed_at: string | null;
		activity_at: string;
		details: {
			has_run: boolean;
			current_dossier: boolean;
			customer_summary: string | null;
			public_summary: string | null;
			official_website: string | null;
			website: string | null;
			boba_relevance: string | null;
			brand_status: string | null;
			markets: Array<{ name: string; level: string | null; confidence: number | null }>;
			research_topics: ResearchTopics | null;
			research_route: string | null;
			review_reasons: string[];
			identity_confidence: number | null;
			citation_coverage: number | null;
			gate_version: string | null;
		};
	};

	export let data: {
		metrics: {
			queued: number;
			running: number;
			failed: number;
			needsReview: number;
		};
		reviewDossiers: Dossier[];
		activeJobs: EnrichmentJob[];
		history: EnrichmentHistoryRow[];
		sourceErrors: string[];
		cron: CronState;
	};

	let deleting: PublishableDossier | null = null;
	let deleteConfirmation = '';
	let deleteNote = '';
	let deleteError = '';
	let rerunning: PublishableDossier | null = null;
	let rerunAnchor = '';
	let rerunExpectedCanonicalName = '';
	let rerunExpectedOrigin = '';
	let rerunOfficialWebsite = '';
	let rerunSourceKind = 'unknown';
	let rerunSourceUrl = '';
	let rerunError = '';
	let rerunScope: ResearchScope = emptyResearchScope();
	let savedResearchScope = '';
	let rerunScopeLoading = false;
	let rerunScopeError = '';
	let rerunScopeDirty = false;
	let researchAnchorSequence = 0;
	let resetting: PublishableDossier | null = null;
	let resetReason = '';
	let resetError = '';
	let closing: PublishableDossier | null = null;
	let closeNote = '';
	let closeError = '';
	let publishing: PublishableDossier | null = null;
	let merging: PublishableDossier | null = null;
	let mergeError = '';
	let publishError = '';
	let publishIdentityDisplay = '';
	let publishIdentityWebsite = '';
	let publishIdentityWikidata = '';
	let publishPublicSummary = '';
	let publishMatchPolicy: BrandMatchPolicy = 'corroboration_required';
	let publishHasAliasDraft = false;
	let publishIdentityAliases: Array<{
		id: number | null;
		display: string;
		normalized_name: string;
		match_mode: string;
	}> = [];
	let publishMarketPresence: MarketPresencePlace[] = [];
	let addingMarket = false;
	let rebindingMarketIndex: number | null = null;
	let resolvingMarkets = false;
	let pendingAction = '';
	let cohortCount = 1;
	let cohortMode: 'backfill' | 'audit' | 'refresh' = 'refresh';
	let refreshing = false;
	let liveCron = data.cron;
	let cronRefreshing = false;
	let historySort: 'recent' | 'brand' | 'result' = 'recent';
	let enrichmentTab: 'review' | 'history' = 'review';
	let expandedHistoryId: string | null = null;

	const number = new Intl.NumberFormat('en-US');

	$: sortedHistory = [...(data.history ?? [])].sort((a, b) => {
		if (historySort === 'brand') {
			return a.display.localeCompare(b.display, undefined, { sensitivity: 'base' });
		}
		if (historySort === 'result') {
			return (
				a.result.localeCompare(b.result) || Date.parse(b.activity_at) - Date.parse(a.activity_at)
			);
		}
		return Date.parse(b.activity_at) - Date.parse(a.activity_at);
	});

	function toggleHistoryDetails(id: string) {
		expandedHistoryId = expandedHistoryId === id ? null : id;
	}

	$: rerunScopeDirty =
		!rerunScopeLoading &&
		Boolean(rerunning) &&
		serializeResearchScope(rerunScope) !== savedResearchScope;

	function emptyResearchScope(): ResearchScope {
		return {
			identity_basis: '',
			identity_scope_verified: false,
			research_directive: '',
			anchors: [],
			updated_at: null
		};
	}

	function normalizeResearchScope(value: unknown): ResearchScope {
		const raw =
			value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: {};
		const identityBasis = String(raw.identity_basis ?? '');
		return {
			brand_slug: typeof raw.brand_slug === 'string' ? raw.brand_slug : undefined,
			identity_basis: ['official', 'multi_location_cluster', 'local', 'ambiguous'].includes(
				identityBasis
			)
				? (identityBasis as ResearchScope['identity_basis'])
				: '',
			identity_scope_verified: raw.identity_scope_verified === true,
			research_directive: typeof raw.research_directive === 'string' ? raw.research_directive : '',
			anchors: Array.isArray(raw.anchors)
				? raw.anchors
						.filter(
							(anchor): anchor is Record<string, unknown> =>
								Boolean(anchor) && typeof anchor === 'object' && !Array.isArray(anchor)
						)
						.map((anchor) => ({
							clientKey: `scope-${++researchAnchorSequence}`,
							id: typeof anchor.id === 'string' ? anchor.id : undefined,
							type: ['url', 'market', 'social', 'location_observation'].includes(
								String(anchor.type)
							)
								? (String(anchor.type) as ResearchAnchor['type'])
								: 'url',
							role: ['include', 'exclude', 'prefer'].includes(String(anchor.role))
								? (String(anchor.role) as ResearchAnchor['role'])
								: 'include',
							value: typeof anchor.value === 'string' ? anchor.value : '',
							reference_id: typeof anchor.reference_id === 'string' ? anchor.reference_id : '',
							curator_verified: anchor.curator_verified === true,
							notes: typeof anchor.notes === 'string' ? anchor.notes : ''
						}))
				: [],
			updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null
		};
	}

	function researchScopePayload(scope: ResearchScope) {
		return {
			identity_basis: scope.identity_basis || null,
			identity_scope_verified: scope.identity_scope_verified,
			research_directive: scope.research_directive.trim() || null,
			anchors: scope.anchors.map((anchor) => ({
				type: anchor.type,
				role: anchor.role,
				value: anchor.value.trim(),
				reference_id: anchor.reference_id.trim() || null,
				curator_verified: anchor.curator_verified,
				notes: anchor.notes.trim() || null
			}))
		};
	}

	function serializeResearchScope(scope: ResearchScope) {
		return JSON.stringify(researchScopePayload(scope));
	}

	function addResearchAnchor(
		type: ResearchAnchor['type'] = 'url',
		role: ResearchAnchor['role'] = 'include',
		value = '',
		notes = ''
	) {
		if (rerunScope.anchors.length >= 40) return;
		rerunScope.anchors = [
			...rerunScope.anchors,
			{
				clientKey: `scope-${++researchAnchorSequence}`,
				type,
				role,
				value,
				reference_id: '',
				curator_verified: true,
				notes
			}
		];
	}

	function hasLocationObservation(value: string) {
		const normalized = value.trim().toLocaleLowerCase();
		return rerunScope.anchors.some(
			(anchor) =>
				anchor.type === 'location_observation' &&
				anchor.value.trim().toLocaleLowerCase() === normalized
		);
	}

	function addLegacyLocationToScope() {
		const value = rerunAnchor.trim();
		if (!value || hasLocationObservation(value)) return;
		addResearchAnchor(
			'location_observation',
			'prefer',
			value,
			'Migrated from the legacy enrichment location anchor.'
		);
	}

	function removeResearchAnchor(clientKey: string) {
		rerunScope.anchors = rerunScope.anchors.filter((anchor) => anchor.clientKey !== clientKey);
	}

	async function loadResearchScope(slug: string) {
		rerunScopeLoading = true;
		rerunScopeError = '';
		try {
			const response = await fetch(`/admin/enrichment/research-scope/${encodeURIComponent(slug)}`);
			if (!response.ok) throw new Error(await response.text());
			rerunScope = normalizeResearchScope(await response.json());
			savedResearchScope = serializeResearchScope(rerunScope);
		} catch (error) {
			rerunScope = emptyResearchScope();
			savedResearchScope = serializeResearchScope(rerunScope);
			rerunScopeError =
				error instanceof Error ? error.message : 'Could not load the reusable research scope.';
		} finally {
			rerunScopeLoading = false;
		}
	}

	function percent(value: number | null) {
		if (value == null) return 'Unknown';
		return `${Math.round(value * 100)}%`;
	}

	function identityEvidence(dossier: Dossier) {
		return (
			dossier.claims.find((claim) =>
				['brand_identity', 'identity', 'brand_name', 'official_name'].includes(claim.claim_key)
			) ?? null
		);
	}

	function identityLabel(dossier: Dossier) {
		const claim = identityEvidence(dossier);
		return claim?.confidence != null
			? `${percent(claim.confidence)} · ${claim.evidence_assessment ?? 'unassessed'}`
			: percent(dossier.metrics.identityConfidence);
	}

	function relativeDate(value: string | null) {
		if (!value) return 'Unknown';
		const elapsed = Date.now() - new Date(value).getTime();
		if (elapsed < 60_000) return 'Just now';
		const minutes = Math.max(1, Math.floor(elapsed / 60_000));
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function displayValue(value: unknown) {
		if (value == null) return 'Not provided';
		if (typeof value === 'string') return value;
		return JSON.stringify(value, null, 2);
	}

	function automaticGeography(dossier: Dossier) {
		const snapshot = dossier.run?.input_snapshot;
		if (!snapshot) return [];
		const raw = snapshot.automatic_geographic_context;
		if (!Array.isArray(raw)) return [];

		const seen = new Set<string>();
		return raw.flatMap((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
			const geography = value as Record<string, unknown>;
			const label = typeof geography.label === 'string' ? geography.label.trim() : '';
			if (!label || seen.has(label.toLocaleLowerCase())) return [];
			seen.add(label.toLocaleLowerCase());
			return [
				{
					label,
					provider: typeof geography.provider === 'string' ? geography.provider : null,
					confidence: typeof geography.confidence === 'string' ? geography.confidence : null
				}
			];
		});
	}

	const researchTopicRows = [
		{ key: 'identity', label: 'Identity' },
		{ key: 'classification_products', label: 'Classification & products' },
		{ key: 'origin_history', label: 'Origin & history' },
		{ key: 'footprint', label: 'Footprint' },
		{ key: 'visual_identity', label: 'Visual identity' }
	] as const;

	function dossierResearchTopics(dossier: PublishableDossier) {
		return dossier.research_topics ?? dossier.run?.research_topics ?? {};
	}

	function researchRoute(dossier: PublishableDossier): ResearchRoute | null {
		const metricRoute = dossier.run?.quality_metrics?.research_route;
		const dossierRoute = dossier.quality_metrics?.research_route;
		const snapshotRoute = dossier.run?.input_snapshot?.research_route;
		const topicRoute = dossierResearchTopics(dossier).identity?.route;
		const route = metricRoute ?? dossierRoute ?? snapshotRoute ?? topicRoute;
		return route === 'local_identity' || route === 'established_brand' || route === 'identity_first'
			? route
			: null;
	}

	function researchRouteLabel(route: ResearchRoute | null) {
		if (route === 'local_identity') return 'Local identity';
		if (route === 'established_brand') return 'Established brand';
		if (route === 'identity_first') return 'Identity first';
		return 'Route unavailable';
	}

	function canonicalResearchLocations(dossier: PublishableDossier) {
		const raw = dossier.run?.input_snapshot?.canonical_location_context;
		if (!Array.isArray(raw)) return [];
		return raw.flatMap((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
			const location = value as Record<string, unknown>;
			const label = typeof location.label === 'string' ? location.label.trim() : '';
			const address = typeof location.address === 'string' ? location.address.trim() : '';
			if (!label && !address) return [];
			return [{ label: label || address, address: address || null }];
		});
	}

	function topicCoverageClass(coverage: TopicCoverage | undefined) {
		if (coverage === 'supported') return 'bg-emerald-50 text-emerald-700';
		if (coverage === 'partial') return 'bg-amber-50 text-amber-700';
		return 'bg-zinc-100 text-zinc-600';
	}

	function topicCoverageLabel(coverage: TopicCoverage | undefined) {
		return coverage === 'supported' || coverage === 'partial' ? coverage : 'unavailable';
	}

	function characterCount(value: string) {
		return Array.from(value).length;
	}

	function publicSummaryValue(dossier: PublishableDossier) {
		return (
			dossier.public_summary_draft ??
			dossier.run?.public_summary_draft ??
			dossier.profile?.public_summary ??
			''
		);
	}

	function hasDraftPublicSummary(dossier: PublishableDossier) {
		return Boolean(dossier.public_summary_draft ?? dossier.run?.public_summary_draft);
	}

	function metricLabel(key: string) {
		return key
			.split('_')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function metricValue(key: string, value: unknown) {
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		if (typeof value === 'number') {
			return key.includes('confidence') || key.includes('coverage')
				? percent(value)
				: number.format(value);
		}
		return displayValue(value);
	}

	function flagDescription(details: unknown) {
		if (typeof details === 'string') return details;
		if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
		const description = (details as Record<string, unknown>).description;
		return typeof description === 'string' ? description : null;
	}

	function flagSourceUrls(details: unknown) {
		if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
		const sourceUrls = (details as Record<string, unknown>).source_urls;
		return Array.isArray(sourceUrls)
			? sourceUrls.filter((url): url is string => typeof url === 'string')
			: [];
	}

	function actionEnhance(action: string): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = action;
			deleteError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The request could not be completed.';

				if (result.type === 'success') {
					toasts.success(message);
					if (action === 'saveResearchScope') {
						const savedScope = resultData && 'scope' in resultData ? resultData.scope : rerunScope;
						rerunScope = normalizeResearchScope(savedScope);
						savedResearchScope = serializeResearchScope(rerunScope);
						rerunScopeError = '';
						return;
					}
					if (action === 'deleteFalsePositive') closeDelete();
					if (action === 'rerunEnrichment') {
						closeRerun();
					}
					if (action === 'resetEnrichment') closeReset();
					if (action === 'markClosed') closeMarkClosed();
					if (action === 'reviewAndPublish') closePublish();
					if (action === 'mergeBrand') closeMerge();
					await invalidateAll();
					if (action === 'configureCron' || action === 'disableCron') {
						await refreshCron();
					}
					return;
				}
				if (action === 'deleteFalsePositive') deleteError = message;
				if (action === 'saveResearchScope') rerunScopeError = message;
				if (action === 'rerunEnrichment') rerunError = message;
				if (action === 'resetEnrichment') resetError = message;
				if (action === 'markClosed') closeError = message;
				if (action === 'reviewAndPublish') publishError = message;
				if (action === 'mergeBrand') mergeError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function openDelete(dossier: PublishableDossier) {
		deleting = dossier;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function closeDelete() {
		deleting = null;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function openRerun(dossier: PublishableDossier) {
		rerunning = dossier;
		rerunAnchor = dossier.identity.enrichment_location_anchor ?? '';
		rerunExpectedCanonicalName = '';
		rerunExpectedOrigin = '';
		rerunOfficialWebsite = '';
		rerunSourceKind = 'unknown';
		rerunSourceUrl = '';
		rerunError = '';
		rerunScope = emptyResearchScope();
		savedResearchScope = serializeResearchScope(rerunScope);
		rerunScopeError = '';
		void loadResearchScope(dossier.brand_slug);
	}

	function openReset(dossier: PublishableDossier) {
		resetting = dossier;
		resetReason = '';
		resetError = '';
	}

	function closeReset() {
		resetting = null;
		resetReason = '';
		resetError = '';
	}

	function openMarkClosed(dossier: PublishableDossier) {
		closing = dossier;
		closeNote = '';
		closeError = '';
	}

	function closeMarkClosed() {
		closing = null;
		closeNote = '';
		closeError = '';
	}

	function openMerge(dossier: PublishableDossier) {
		merging = dossier;
		mergeError = '';
	}

	function closeMerge() {
		merging = null;
		mergeError = '';
	}

	function closeRerun() {
		rerunning = null;
		rerunAnchor = '';
		rerunExpectedCanonicalName = '';
		rerunExpectedOrigin = '';
		rerunOfficialWebsite = '';
		rerunSourceKind = 'unknown';
		rerunSourceUrl = '';
		rerunError = '';
		rerunScope = emptyResearchScope();
		savedResearchScope = '';
		rerunScopeLoading = false;
		rerunScopeError = '';
	}

	function openPublish(dossier: PublishableDossier) {
		publishing = dossier;
		publishError = '';
		publishIdentityDisplay = dossier.identity.display;
		publishIdentityWebsite = publicationWebsite(dossier);
		publishIdentityWikidata = dossier.identity.wikidata ?? '';
		publishPublicSummary = publicSummaryValue(dossier);
		publishMatchPolicy = isBrandMatchPolicy(dossier.recommended_match_policy)
			? dossier.recommended_match_policy
			: dossier.identity.match_policy;
		publishHasAliasDraft = false;
		publishIdentityAliases = dossier.identity.aliases.map((alias) => ({
			id: alias.id,
			display: alias.alias_display ?? alias.normalized_name,
			normalized_name: alias.normalized_name,
			match_mode: alias.match_mode
		}));
		publishMarketPresence = marketPresencePlaces(dossier);
		addingMarket = false;
		rebindingMarketIndex = null;
		void resolveUnboundMarketPlaces();
	}

	function closePublish() {
		publishing = null;
		publishError = '';
		publishIdentityDisplay = '';
		publishIdentityWebsite = '';
		publishIdentityWikidata = '';
		publishPublicSummary = '';
		publishMatchPolicy = 'corroboration_required';
		publishIdentityAliases = [];
		publishMarketPresence = [];
		addingMarket = false;
		rebindingMarketIndex = null;
		resolvingMarkets = false;
	}

	function factText(dossier: PublishableDossier, key: string) {
		const value = dossier.profile_facts?.[key];
		return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
	}

	function publicationWebsite(dossier: PublishableDossier) {
		const proposedWebsite = dossier.profile_facts?.official_website;
		return typeof proposedWebsite === 'string' && proposedWebsite.trim()
			? proposedWebsite.trim()
			: (dossier.identity.website ?? '');
	}

	function factList(dossier: PublishableDossier, key: string) {
		const value = dossier.profile_facts?.[key];
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string').join('\n')
			: '';
	}

	function marketPresencePlaces(dossier: PublishableDossier): MarketPresencePlace[] {
		const value = dossier.profile_facts?.market_presence;
		if (!Array.isArray(value)) return [];
		return value.flatMap((item) => {
			if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
			const row = item as Record<string, unknown>;
			const level = row.level;
			if (level !== 'country' && level !== 'admin1' && level !== 'metro' && level !== 'city') {
				return [];
			}
			const name = typeof row.name === 'string' ? row.name : '';
			const confidence =
				typeof row.confidence === 'number'
					? row.confidence
					: typeof row.confidence === 'string'
						? Number(row.confidence)
						: 0.8;
			return [
				{
					place_id: typeof row.place_id === 'string' ? row.place_id : null,
					level,
					name,
					code: typeof row.code === 'string' ? row.code : null,
					display_name:
						typeof row.display_name === 'string' && row.display_name.trim()
							? row.display_name
							: name,
					country_code:
						typeof row.country_code === 'string' && row.country_code.trim()
							? row.country_code.trim().toUpperCase()
							: null,
					country_name: typeof row.country_name === 'string' ? row.country_name : null,
					admin1_code:
						typeof row.admin1_code === 'string' && row.admin1_code.trim()
							? row.admin1_code.trim().toUpperCase()
							: null,
					admin1_name: typeof row.admin1_name === 'string' ? row.admin1_name : null,
					metro_code:
						typeof row.metro_code === 'string' && row.metro_code.trim()
							? row.metro_code.trim()
							: null,
					metro_name: typeof row.metro_name === 'string' ? row.metro_name : null,
					confidence: Number.isFinite(confidence) ? confidence : 0.8
				}
			];
		});
	}

	function marketChipQualifier(place: MarketPresencePlace) {
		if (place.level === 'country') return 'country';
		if (place.level === 'admin1') return place.country_code ?? 'state';
		if (place.level === 'metro') {
			return [place.admin1_code?.replace(/^US-/, ''), place.country_code]
				.filter(Boolean)
				.join(' · ') || 'metro';
		}
		return (
			[place.admin1_code?.replace(/^US-/, ''), place.country_code].filter(Boolean).join(' · ') ||
			'city'
		);
	}

	function marketChipLabel(place: MarketPresencePlace) {
		const name = (place.name || place.display_name).trim() || 'Unnamed place';
		return `${name} · ${marketChipQualifier(place)}`;
	}

	function placeFromSearchResult(
		place: GeoPlaceResult,
		confidence = 1
	): MarketPresencePlace {
		return { ...place, confidence };
	}

	function hasMarketPlace(place: GeoPlaceResult) {
		return publishMarketPresence.some(
			(existing) =>
				(existing.place_id && existing.place_id === place.place_id) ||
				(existing.level === place.level &&
					existing.name.trim().toLocaleLowerCase() === place.name.trim().toLocaleLowerCase() &&
					(existing.country_code ?? '') === (place.country_code ?? ''))
		);
	}

	function startAddingMarket() {
		addingMarket = true;
		rebindingMarketIndex = null;
	}

	function cancelMarketEditor() {
		addingMarket = false;
		rebindingMarketIndex = null;
	}

	function addMarketPresencePlace(place: GeoPlaceResult) {
		if (!hasMarketPlace(place)) {
			publishMarketPresence = [...publishMarketPresence, placeFromSearchResult(place, 1)];
		}
		addingMarket = false;
	}

	function rebindMarketPresencePlace(index: number, place: GeoPlaceResult) {
		const confidence = publishMarketPresence[index]?.confidence ?? 1;
		publishMarketPresence[index] = placeFromSearchResult(place, confidence);
		publishMarketPresence = [...publishMarketPresence];
		rebindingMarketIndex = null;
	}

	function removeMarketPresencePlace(index: number) {
		publishMarketPresence = publishMarketPresence.filter((_, i) => i !== index);
		if (rebindingMarketIndex === index) rebindingMarketIndex = null;
		else if (rebindingMarketIndex != null && rebindingMarketIndex > index) {
			rebindingMarketIndex -= 1;
		}
	}

	function chooseExactPlace(
		places: GeoPlaceResult[],
		target: Pick<MarketPresencePlace, 'name' | 'level' | 'country_code' | 'admin1_code'>
	) {
		const normalizedName = target.name.trim().toLocaleLowerCase();
		const matches = places.filter((place) => {
			if (place.name.trim().toLocaleLowerCase() !== normalizedName) return false;
			if (target.country_code && place.country_code !== target.country_code) return false;
			if (target.admin1_code && place.admin1_code !== target.admin1_code) return false;
			return true;
		});
		const canonicalMatches = matches.filter((place) => {
			if (place.level !== target.level) return false;
			if (place.level === 'country' && target.country_code) return place.code === target.country_code;
			if (place.level === 'admin1' && target.admin1_code) return place.code === target.admin1_code;
			if (place.level === 'city' && target.admin1_code) {
				return place.code?.startsWith(`${target.admin1_code}/city/`) ?? false;
			}
			return true;
		});
		if (canonicalMatches.length === 1) return canonicalMatches[0];
		const atLevel = matches.filter((place) => place.level === target.level);
		if (atLevel.length === 1) return atLevel[0];
		if (matches.length === 1) return matches[0];
		return null;
	}

	async function resolveCanonicalPlace(place: MarketPresencePlace) {
		const exactName = (place.name || place.display_name).trim();
		if (exactName.length < 2) return null;
		const params = new URLSearchParams({ q: exactName, level: place.level });
		const response = await fetch(`/admin/enrichment/place-search?${params}`);
		if (!response.ok) return null;
		const body = (await response.json()) as { places?: GeoPlaceResult[] };
		return chooseExactPlace(body.places ?? [], place);
	}

	async function resolveUnboundMarketPlaces() {
		const unbound = publishMarketPresence
			.map((place, index) => ({ place, index }))
			.filter(({ place }) => !place.place_id && (place.name || place.display_name).trim().length >= 2);
		if (!unbound.length) return;
		resolvingMarkets = true;
		try {
			const resolved = await Promise.all(
				unbound.map(async ({ place, index }) => ({
					index,
					match: await resolveCanonicalPlace(place)
				}))
			);
			let next = publishMarketPresence;
			for (const { index, match } of resolved) {
				if (!match) continue;
				next = next.map((place, placeIndex) =>
					placeIndex === index
						? placeFromSearchResult(match, place.confidence)
						: place
				);
			}
			publishMarketPresence = next;
		} finally {
			resolvingMarkets = false;
		}
	}

	function claimEvidence(dossier: PublishableDossier, keys: string[]) {
		return (dossier.claims ?? []).filter((claim) => keys.includes(claim.claim_key));
	}

	function factSocials(dossier: PublishableDossier) {
		const value = dossier.profile_facts?.official_socials;
		if (!Array.isArray(value)) return '';
		return value
			.filter(
				(item): item is { platform: string; url: string } =>
					Boolean(item) &&
					typeof item === 'object' &&
					typeof (item as Record<string, unknown>).platform === 'string' &&
					typeof (item as Record<string, unknown>).url === 'string'
			)
			.map((item) => `${item.platform} | ${item.url}`)
			.join('\n');
	}

	function statusClasses(status: string) {
		if (status === 'succeeded' || status === 'published' || status === 'auto_published')
			return 'bg-emerald-50 text-emerald-700';
		if (status === 'failed') return 'bg-red-50 text-red-700';
		if (status === 'running') return 'bg-blue-50 text-blue-700';
		if (status === 'needs_review' || status === 'paused') return 'bg-amber-50 text-amber-800';
		return 'bg-zinc-100 text-zinc-700';
	}

	function historyResultLabel(result: string) {
		if (result === 'auto_published') return 'Auto-published';
		if (result === 'needs_review') return 'Needs review';
		if (result === 'published') return 'Published';
		if (result === 'succeeded') return 'Succeeded';
		if (result === 'failed') return 'Failed';
		if (result === 'running') return 'Running';
		if (result === 'queued') return 'Queued';
		if (result === 'paused') return 'Paused';
		return result.replaceAll('_', ' ');
	}

	async function refreshCron() {
		if (cronRefreshing || document.hidden) return;
		cronRefreshing = true;
		try {
			const response = await fetch('/admin/enrichment/cron-status', {
				headers: { accept: 'application/json' },
				cache: 'no-store'
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(
					payload && typeof payload.error === 'string'
						? payload.error
						: 'Cron status could not be refreshed.'
				);
			}
			liveCron = {
				serverTime: typeof payload.server_time === 'string' ? payload.server_time : null,
				configured: payload.configured === true,
				jobs: Array.isArray(payload.jobs) ? payload.jobs : [],
				runs: Array.isArray(payload.runs) ? payload.runs : [],
				error: null
			};
		} catch (error) {
			liveCron = {
				...liveCron,
				error: error instanceof Error ? error.message : 'Cron status could not be refreshed.'
			};
		} finally {
			cronRefreshing = false;
		}
	}

	async function refreshEnrichment() {
		if (refreshing || document.hidden) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		const enrichmentInterval = window.setInterval(() => {
			if (data.activeJobs.length > 0) void refreshEnrichment();
		}, 5_000);
		const cronInterval = window.setInterval(() => void refreshCron(), 10_000);
		void refreshCron();
		return () => {
			window.clearInterval(enrichmentInterval);
			window.clearInterval(cronInterval);
		};
	});
</script>

<svelte:head><title>Brand Enrichment | Bobadex Admin</title></svelte:head>

<svelte:window
	on:keydown={(event) => {
		if (event.key !== 'Escape') return;
		if (deleting) closeDelete();
		if (rerunning) closeRerun();
		if (resetting) closeReset();
		if (closing) closeMarkClosed();
		if (merging) closeMerge();
		if (publishing) closePublish();
	}}
/>

<main class="mx-auto max-w-7xl space-y-8 px-5 py-7 sm:py-9">
	<header class="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
		<div>
			<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
				Brand intelligence
			</p>
			<h2 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Enrichment</h2>
			<p class="mt-2 max-w-2xl text-sm text-zinc-600">
				Start a cohort, then review dossiers and publish verified brand profiles.
			</p>
		</div>
	</header>

	{#if data.sourceErrors.length}
		<div class="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			<p class="font-medium">Some enrichment data could not be loaded</p>
			<p class="mt-0.5">{data.sourceErrors.join(', ')}</p>
		</div>
	{/if}

	<section aria-label="Enrichment metrics" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each [['Queued', data.metrics.queued, 'text-zinc-950'], ['Running', data.metrics.running, 'text-blue-700'], ['Needs review', data.metrics.needsReview, 'text-amber-700'], ['Failed', data.metrics.failed, data.metrics.failed ? 'text-red-700' : 'text-zinc-950']] as metric}
			<div class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-xs font-medium text-zinc-500">{metric[0]}</p>
				<p class="mt-2 text-2xl font-semibold {metric[2]}">{number.format(Number(metric[1]))}</p>
			</div>
		{/each}
	</section>

	<section
		class="grid gap-6 border-y border-zinc-200 py-6 lg:grid-cols-2 lg:divide-x lg:divide-zinc-200"
	>
		<div class="lg:pr-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-lg font-semibold text-zinc-950">Start cohort</h3>
					<p class="mt-1 text-sm text-zinc-500">
						Queue brands for enrichment. Refresh re-runs existing dossiers on the current worker and
						auto-publishes when quality gates clear. Backfill only fills brands with no dossier.
						Audit still stops for review.
					</p>
				</div>
				<span class="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">Max 100</span>
			</div>

			<form
				method="post"
				action="?/controlledCohort"
				use:enhance={actionEnhance('controlledCohort')}
				onsubmit={(event) => {
					const estimate = (cohortCount * 0.005).toFixed(3);
					if (
						!window.confirm(
							`Queue up to ${cohortCount} ${cohortMode} job${cohortCount === 1 ? '' : 's'}? Estimated Search API cost: $${estimate}, excluding synthesis.`
						)
					)
						event.preventDefault();
				}}
				class="mt-4 grid gap-4 sm:grid-cols-2"
			>
				<label>
					<span class="text-sm font-medium text-zinc-800">Cohort size</span>
					<select
						name="count"
						bind:value={cohortCount}
						class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
					>
						<option value={1}>1 brand</option>
						<option value={5}>5 brands</option>
						<option value={10}>10 brands</option>
						<option value={25}>25 brands</option>
						<option value={100}>100 brands</option>
					</select>
				</label>
				<label>
					<span class="text-sm font-medium text-zinc-800">Mode</span>
					<select
						name="mode"
						bind:value={cohortMode}
						class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
					>
						<option value="refresh">Refresh existing</option>
						<option value="backfill">Backfill missing</option>
						<option value="audit">Audit</option>
					</select>
				</label>
				<label class="sm:col-span-2">
					<span class="text-sm font-medium text-zinc-800">Note</span>
					<input
						name="note"
						placeholder="Optional cohort note"
						class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
					/>
				</label>
				<div class="sm:col-span-2">
					<button
						class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
						disabled={Boolean(pendingAction)}
					>
						{pendingAction === 'controlledCohort'
							? 'Queuing…'
							: `Queue ${cohortCount} ${cohortMode} job${cohortCount === 1 ? '' : 's'}`}
					</button>
					<p class="mt-2 text-xs text-zinc-500">
						Estimated Search API cost: ${(cohortCount * 0.005).toLocaleString('en-US', {
							style: 'currency',
							currency: 'USD',
							minimumFractionDigits: 3
						})}. Synthesis is additional.
					</p>
				</div>
			</form>
		</div>

		<div class="lg:pl-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-lg font-semibold text-zinc-950">Worker</h3>
					<p class="mt-1 text-sm text-zinc-500">
						Drain the queue now or leave cron enabled for automatic processing.
					</p>
				</div>
				<span
					class="rounded px-2 py-1 text-xs font-medium {liveCron.jobs.some((job) => job.active)
						? 'bg-emerald-50 text-emerald-700'
						: 'bg-amber-50 text-amber-800'}"
				>
					{liveCron.jobs.some((job) => job.active) ? 'Cron active' : 'Cron disabled'}
				</span>
			</div>

			<form
				method="post"
				action="?/drain"
				use:enhance={actionEnhance('drain')}
				class="mt-4 flex items-end gap-3"
			>
				<label class="max-w-40 flex-1">
					<span class="text-sm font-medium text-zinc-800">Batch limit</span>
					<input
						name="limit"
						type="number"
						min="1"
						max="5"
						step="1"
						value="5"
						required
						class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm tabular-nums focus:border-zinc-500 focus:ring-zinc-500"
					/>
				</label>
				<button
					class="h-10 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
					disabled={Boolean(pendingAction)}
				>
					{pendingAction === 'drain' ? 'Processing…' : 'Run worker'}
				</button>
			</form>

			<div
				class="mt-3 flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<p class="text-sm font-medium text-zinc-900">Automatic drain</p>
					<p class="mt-0.5 text-xs text-zinc-500">Every five minutes · up to five brands</p>
				</div>
				<div class="flex shrink-0 gap-2">
					<form method="post" action="?/configureCron" use:enhance={actionEnhance('configureCron')}>
						<button
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
							disabled={Boolean(pendingAction)}
						>
							{pendingAction === 'configureCron'
								? 'Enabling…'
								: liveCron.jobs.some((job) => job.active)
									? 'Repair cron'
									: 'Enable cron'}
						</button>
					</form>
					{#if liveCron.jobs.some((job) => job.active)}
						<form
							method="post"
							action="?/disableCron"
							use:enhance={actionEnhance('disableCron')}
							onsubmit={(event) => {
								if (
									!window.confirm(
										'Disable automatic enrichment processing? Queued jobs will remain available.'
									)
								) {
									event.preventDefault();
								}
							}}
						>
							<button
								class="rounded border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
								disabled={Boolean(pendingAction)}
							>
								{pendingAction === 'disableCron' ? 'Disabling…' : 'Disable cron'}
							</button>
						</form>
					{/if}
				</div>
			</div>

			{#if data.activeJobs.length}
				<div class="mt-4 space-y-2">
					<div class="flex items-center justify-between gap-3">
						<p class="text-xs font-medium text-zinc-500">
							{data.activeJobs.length} active job{data.activeJobs.length === 1 ? '' : 's'}
							{#if refreshing}<span class="text-blue-600"> · refreshing</span>{/if}
						</p>
					</div>
					{#each data.activeJobs.slice(0, 6) as job}
						<div
							class="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white px-3 py-2 text-sm"
						>
							<code class="min-w-0 flex-1 truncate text-xs text-zinc-700">{job.brand_slug}</code>
							<span class="rounded px-2 py-0.5 text-xs font-medium {statusClasses(job.status)}"
								>{job.status}</span
							>
							{#if job.controlled && job.status === 'queued'}
								<form
									method="post"
									action="?/controlledJobState"
									use:enhance={actionEnhance('controlledJobState')}
									class="flex gap-1"
								>
									<input type="hidden" name="job_id" value={job.id} />
									<button
										name="job_action"
										value={job.paused ? 'resume' : 'pause'}
										class="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
										disabled={Boolean(pendingAction)}>{job.paused ? 'Resume' : 'Pause'}</button
									>
									<button
										name="job_action"
										value="cancel"
										class="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
										disabled={Boolean(pendingAction)}>Cancel</button
									>
								</form>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<section>
		<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<nav class="flex gap-1 overflow-x-auto border-b border-zinc-200" aria-label="Enrichment results">
				<button
					type="button"
					class="shrink-0 border-b-2 px-3 py-2 text-sm {enrichmentTab === 'review'
						? 'border-zinc-950 font-semibold text-zinc-950'
						: 'border-transparent text-zinc-600 hover:text-zinc-950'}"
					aria-current={enrichmentTab === 'review' ? 'page' : undefined}
					onclick={() => (enrichmentTab = 'review')}
				>
					Manual review
					<span class="ml-1 text-xs text-zinc-500 tabular-nums">{data.reviewDossiers.length}</span>
				</button>
				<button
					type="button"
					class="shrink-0 border-b-2 px-3 py-2 text-sm {enrichmentTab === 'history'
						? 'border-zinc-950 font-semibold text-zinc-950'
						: 'border-transparent text-zinc-600 hover:text-zinc-950'}"
					aria-current={enrichmentTab === 'history' ? 'page' : undefined}
					onclick={() => (enrichmentTab = 'history')}
				>
					History
					<span class="ml-1 text-xs text-zinc-500 tabular-nums">{sortedHistory.length}</span>
				</button>
			</nav>
			{#if enrichmentTab === 'history'}
				<label class="text-sm text-zinc-600">
					<span class="sr-only">Sort history</span>
					<select
						bind:value={historySort}
						class="h-9 rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
					>
						<option value="recent">Most recent</option>
						<option value="brand">Brand</option>
						<option value="result">Result</option>
					</select>
				</label>
			{/if}
		</div>

		{#if enrichmentTab === 'history'}
			{#if sortedHistory.length}
				<div class="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
					<table class="min-w-full text-left text-sm">
						<thead
							class="border-b border-zinc-200 bg-zinc-50 text-xs font-medium tracking-normal text-zinc-500 uppercase"
						>
							<tr>
								<th class="w-10 px-3 py-2.5"><span class="sr-only">Details</span></th>
								<th class="px-4 py-2.5">When</th>
								<th class="px-4 py-2.5">Brand</th>
								<th class="px-4 py-2.5">Mode</th>
								<th class="px-4 py-2.5">Result</th>
								<th class="px-4 py-2.5 text-right">Confidence</th>
								<th class="px-4 py-2.5">Worker</th>
							</tr>
						</thead>
						<tbody>
							{#each sortedHistory as job (job.id)}
								<tr class="border-b border-zinc-100 {expandedHistoryId === job.id ? 'bg-zinc-50' : ''}">
									<td class="px-3 py-2.5">
										<button
											type="button"
											class="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
											aria-expanded={expandedHistoryId === job.id}
											aria-label={expandedHistoryId === job.id
												? `Hide enrichment details for ${job.display}`
												: `Show enrichment details for ${job.display}`}
											onclick={() => toggleHistoryDetails(job.id)}
										>
											<svg
												class="h-4 w-4 transition-transform {expandedHistoryId === job.id
													? 'rotate-90'
													: ''}"
												viewBox="0 0 20 20"
												fill="currentColor"
												aria-hidden="true"
											>
												<path
													fill-rule="evenodd"
													d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 1 1 1.06-1.06l4.24 4.24a.75.75 0 0 1 0 1.06l-4.24 4.24a.75.75 0 0 1-1.08 0Z"
													clip-rule="evenodd"
												/>
											</svg>
										</button>
									</td>
									<td class="px-4 py-2.5 whitespace-nowrap text-zinc-600">
										<button
											type="button"
											class="text-left hover:text-zinc-950"
											onclick={() => toggleHistoryDetails(job.id)}
										>
											{relativeDate(job.activity_at)}
										</button>
									</td>
									<td class="px-4 py-2.5">
										<a
											href="/admin/brands/catalog?q={encodeURIComponent(job.display)}"
											class="font-medium text-zinc-950 hover:underline"
										>
											{job.display}
										</a>
										<p class="mt-0.5 truncate text-xs text-zinc-500">{job.brand_slug}</p>
									</td>
									<td class="px-4 py-2.5 text-zinc-600">{job.trigger_kind}</td>
									<td class="px-4 py-2.5">
										<span
											class="rounded px-2 py-0.5 text-xs font-medium {statusClasses(job.result)}"
										>
											{historyResultLabel(job.result)}
										</span>
										{#if job.last_error}
											<p class="mt-1 max-w-xs truncate text-xs text-red-700" title={job.last_error}>
												{job.last_error}
											</p>
										{/if}
									</td>
									<td class="px-4 py-2.5 text-right tabular-nums text-zinc-700">
										{job.overall_confidence == null ? '—' : percent(job.overall_confidence)}
									</td>
									<td class="px-4 py-2.5 text-xs text-zinc-500">
										{job.researcher_version ?? '—'}
									</td>
								</tr>
								{#if expandedHistoryId === job.id}
									<tr class="border-b border-zinc-200 bg-zinc-50">
										<td colspan="7" class="px-5 py-4">
											{#if !job.details.has_run}
												<p class="text-sm text-zinc-500">
													This job has not produced a research run yet.
												</p>
											{:else}
												{#if !job.details.current_dossier}
													<p class="mb-3 text-xs font-medium text-amber-800">
														A later run replaced this dossier. Summaries below are from this job's
														run, not the current published profile.
													</p>
												{/if}
												<div class="grid gap-5 lg:grid-cols-2">
													<div class="space-y-4">
														<div>
															<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
																Admin diagnostic
															</p>
															<p class="mt-1 text-sm leading-6 whitespace-pre-wrap text-zinc-700">
																{job.details.customer_summary || 'No diagnostic summary was produced.'}
															</p>
														</div>
														<div>
															<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
																User-facing summary
															</p>
															<p class="mt-1 text-sm leading-6 text-zinc-700">
																{job.details.public_summary || 'No consumer summary was produced.'}
															</p>
														</div>
														<div>
															<div class="flex items-center justify-between gap-2">
																<p
																	class="text-xs font-semibold tracking-normal text-zinc-500 uppercase"
																>
																	Research coverage
																</p>
																<span
																	class="rounded bg-white px-2 py-0.5 text-xs font-medium text-zinc-700"
																>
																	{researchRouteLabel(
																		job.details.research_route === 'local_identity' ||
																			job.details.research_route === 'established_brand' ||
																			job.details.research_route === 'identity_first'
																			? job.details.research_route
																			: null
																	)}
																</span>
															</div>
															<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
																{#each researchTopicRows as row}
																	{@const topic = job.details.research_topics?.[row.key]}
																	<div class="py-2.5">
																		<div class="flex items-center justify-between gap-3">
																			<p class="text-sm font-medium text-zinc-900">{row.label}</p>
																			<span
																				class="rounded px-2 py-0.5 text-xs font-medium {topicCoverageClass(
																					topic?.coverage
																				)}"
																			>
																				{topicCoverageLabel(topic?.coverage)}
																			</span>
																		</div>
																		<p class="mt-1 text-xs leading-5 text-zinc-600">
																			{topic?.summary ||
																				'No supported finding was produced for this topic.'}
																		</p>
																	</div>
																{/each}
															</div>
														</div>
													</div>
													<div class="space-y-4">
														<div class="grid grid-cols-2 gap-3 text-sm">
															<div>
																<p class="text-xs text-zinc-500">Identity</p>
																<p class="font-medium text-zinc-900">
																	{percent(job.details.identity_confidence)}
																</p>
															</div>
															<div>
																<p class="text-xs text-zinc-500">Citation coverage</p>
																<p class="font-medium text-zinc-900">
																	{percent(job.details.citation_coverage)}
																</p>
															</div>
															<div>
																<p class="text-xs text-zinc-500">Boba relevance</p>
																<p class="font-medium text-zinc-900">
																	{job.details.boba_relevance?.replaceAll('_', ' ') || '—'}
																</p>
															</div>
															<div>
																<p class="text-xs text-zinc-500">Brand status</p>
																<p class="font-medium text-zinc-900">
																	{job.details.brand_status || '—'}
																</p>
															</div>
														</div>
														<div>
															<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
																Website
															</p>
															{#if job.details.official_website || job.details.website}
																<a
																	href={job.details.official_website || job.details.website}
																	target="_blank"
																	rel="noreferrer"
																	class="mt-1 block truncate text-sm text-blue-700 hover:underline"
																>
																	{job.details.official_website || job.details.website}
																</a>
															{:else}
																<p class="mt-1 text-sm text-zinc-500">No website stored.</p>
															{/if}
														</div>
														<div>
															<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
																Markets
															</p>
															{#if job.details.markets.length}
																<div class="mt-2 flex flex-wrap gap-1.5">
																	{#each job.details.markets as market}
																		<span
																			class="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-800"
																		>
																			{market.name}{market.level ? ` · ${market.level}` : ''}
																		</span>
																	{/each}
																</div>
															{:else}
																<p class="mt-1 text-sm text-zinc-500">
																	{job.details.current_dossier
																		? 'No structured market presence.'
																		: 'Markets are only stored on the current dossier.'}
																</p>
															{/if}
														</div>
														{#if job.details.review_reasons.length}
															<div>
																<p
																	class="text-xs font-semibold tracking-normal text-zinc-500 uppercase"
																>
																	Review reasons
																</p>
																<ul class="mt-1 list-disc space-y-0.5 pl-4 text-xs text-zinc-700">
																	{#each job.details.review_reasons as reason}
																		<li>{reason.replaceAll('_', ' ')}</li>
																	{/each}
																</ul>
															</div>
														{/if}
														{#if job.last_error}
															<div>
																<p
																	class="text-xs font-semibold tracking-normal text-zinc-500 uppercase"
																>
																	Error
																</p>
																<p class="mt-1 text-xs leading-5 text-red-700">{job.last_error}</p>
															</div>
														{/if}
														{#if job.details.gate_version}
															<p class="text-xs text-zinc-400">{job.details.gate_version}</p>
														{/if}
													</div>
												</div>
											{/if}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="border-y border-zinc-200 py-14 text-center text-sm text-zinc-500">
					No enrichment jobs yet.
				</div>
			{/if}
		{:else}
		<div class="space-y-5">
			{#each data.reviewDossiers as dossier}
				<EnrichmentDossierCard
					{dossier}
					{pendingAction}
					flagAction="?/resolveFlag"
					flagEnhance={actionEnhance('resolveFlag')}
					onPublish={() => openPublish(dossier)}
					onRerun={() => openRerun(dossier)}
					onReset={() => openReset(dossier)}
					onMerge={() => openMerge(dossier)}
					onMarkClosed={() => openMarkClosed(dossier)}
					onDelete={() => openDelete(dossier)}
				/>
			{/each}
			{#if data.reviewDossiers.length === 0}<div
					class="border-y border-zinc-200 py-14 text-center text-sm text-zinc-500"
				>
					No dossiers currently need review.
				</div>{/if}
		</div>
		{/if}
	</section>
</main>

{#if merging}
	<BrandMergeDialog
		source={{ slug: merging.brand_slug, display: merging.identity.display }}
		action="?/mergeBrand"
		enhanceSubmit={actionEnhance('mergeBrand')}
		busy={pendingAction === 'mergeBrand'}
		error={mergeError}
		onClose={closeMerge}
	/>
{/if}

{#if publishing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-5"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closePublish()}
	>
		<div
			class="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="publish-title"
		>
			<div class="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
				<div>
					<h3 id="publish-title" class="text-lg font-semibold text-zinc-950">
						{publishing.approval_status === 'approved'
							? 'Edit and republish'
							: 'Review and publish'}
					</h3>
					<p class="mt-1 text-sm text-zinc-600">
						{publishing.brand_slug} · {publishing.approval_status === 'approved'
							? 'Current published values are prefilled.'
							: 'Current enrichment values are prefilled.'}
					</p>
				</div>
				<button
					type="button"
					onclick={closePublish}
					aria-label="Close review and publish"
					class="text-xl leading-none text-zinc-400 hover:text-zinc-800"
				>
					×
				</button>
			</div>

			<form
				method="post"
				action="?/reviewAndPublish"
				use:enhance={actionEnhance('reviewAndPublish')}
				class="flex min-h-0 flex-1 flex-col"
			>
				<input type="hidden" name="brand_slug" value={publishing.brand_slug} />
				<input
					type="hidden"
					name="publish_mode"
					value={publishing.approval_status === 'approved' ? 'republish' : 'review'}
				/>
				<input
					type="hidden"
					name="original_profile_facts"
					value={JSON.stringify(publishing.profile_facts ?? {})}
				/>
				<input
					type="hidden"
					name="original_public_summary"
					value={publicSummaryValue(publishing)}
				/>
				<input
					type="hidden"
					name="public_summary_is_published_fallback"
					value={String(
						!hasDraftPublicSummary(publishing) && Boolean(publishing.profile?.public_summary)
					)}
				/>

				<div class="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
					<BrandIdentityFields
						slug={publishing.brand_slug}
						originalDisplay={publishing.identity.display}
						bind:display={publishIdentityDisplay}
						bind:website={publishIdentityWebsite}
						bind:wikidata={publishIdentityWikidata}
						bind:aliases={publishIdentityAliases}
						bind:hasAliasDraft={publishHasAliasDraft}
					/>

					<section class="border-t border-zinc-200 pt-6">
						<BrandMatchPolicyField
							label="Recommended match policy"
							recommendation={publishing.recommended_match_policy}
							bind:value={publishMatchPolicy}
						/>
					</section>

					<section>
						<div class="border-t border-zinc-200 pt-6">
							<h4 class="text-sm font-semibold text-zinc-950">Admin diagnostic summary</h4>
							<p class="mt-1 text-xs text-zinc-500">
								Internal research context. This is not shown on the consumer brand page.
							</p>
							<label class="mt-3 block">
								<span class="sr-only">Customer summary</span>
								<textarea
									name="summary"
									rows="5"
									required
									value={publishing.customer_summary ??
										publishing.run?.customer_summary_draft ??
										''}
									class="block w-full rounded border-zinc-300 text-sm leading-6 focus:border-zinc-500 focus:ring-zinc-500"
								></textarea>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
							<div>
								<div class="flex items-center justify-between gap-3">
									<div>
										<h4 class="text-sm font-semibold text-zinc-950">User-facing summary</h4>
										<p class="mt-1 text-xs text-zinc-500">
											Published on the mobile brand page. Leave empty to preserve an existing
											summary.
										</p>
									</div>
									<span
										class="shrink-0 text-xs tabular-nums {characterCount(publishPublicSummary) >
											300 ||
										(characterCount(publishPublicSummary) > 0 &&
											characterCount(publishPublicSummary) < 40)
											? 'text-red-700'
											: 'text-zinc-500'}"
									>
										{characterCount(publishPublicSummary)}/300
									</span>
								</div>
								<label class="mt-3 block">
									<span class="sr-only">User-facing summary</span>
									<textarea
										name="public_summary"
										rows="5"
										minlength="40"
										maxlength="300"
										bind:value={publishPublicSummary}
										class="block w-full rounded border-zinc-300 text-sm leading-6 focus:border-zinc-500 focus:ring-zinc-500"
									></textarea>
								</label>
							</div>
							<div>
								<p class="text-xs font-semibold text-zinc-500 uppercase">Mobile preview</p>
								<div class="mt-3 overflow-hidden rounded border border-zinc-200 bg-white shadow-sm">
									<div class="border-b border-zinc-100 px-4 py-3">
										<p class="text-base font-semibold text-zinc-950">
											{publishIdentityDisplay || publishing.identity.display}
										</p>
									</div>
									<p class="px-4 py-4 text-sm leading-6 text-zinc-700">
										{publishPublicSummary || 'No user-facing summary will be added.'}
									</p>
								</div>
							</div>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Official presence</h4>
						<div class="mt-3 grid gap-4">
							<label>
								<span class="text-xs font-medium text-zinc-600">Official ordering URL</span>
								<input
									name="fact_official_ordering_url"
									type="url"
									value={factText(publishing, 'official_ordering_url')}
									placeholder="https://…"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label class="md:col-span-2">
								<span class="text-xs font-medium text-zinc-600">Official social accounts</span>
								<textarea
									name="fact_official_socials"
									rows="3"
									value={factSocials(publishing)}
									placeholder={'Instagram | https://instagram.com/brand\nTikTok | https://tiktok.com/@brand'}
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
								<span class="mt-1 block text-xs text-zinc-500">One per line: Platform | URL</span>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Identity and origin</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<label>
								<span class="text-xs font-medium text-zinc-600">Founded year</span>
								<input
									name="fact_founded_year"
									type="number"
									min="1800"
									max={new Date().getFullYear()}
									value={factText(publishing, 'founded_year')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Founded place</span>
								<input
									name="fact_founded_place"
									value={factText(publishing, 'founded_place')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Parent company</span>
								<input
									name="fact_parent_company"
									value={factText(publishing, 'parent_company')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Ownership model</span>
								<select
									name="fact_ownership_model"
									value={factText(publishing, 'ownership_model')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="independent">Independent</option>
									<option value="franchise">Franchise</option>
									<option value="company_operated">Company operated</option>
									<option value="mixed">Mixed</option>
									<option value="subsidiary">Subsidiary</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Native names</span>
								<textarea
									name="fact_native_names"
									rows="3"
									value={factList(publishing, 'native_names')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Former names</span>
								<textarea
									name="fact_former_names"
									rows="3"
									value={factList(publishing, 'former_names')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Classification</h4>
						<div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<label>
								<span class="text-xs font-medium text-zinc-600">Business type</span>
								<select
									name="fact_business_type"
									value={factText(publishing, 'business_type')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="tea_focused">Tea focused</option>
									<option value="dessert_bakery_hybrid">Dessert/bakery hybrid</option>
									<option value="restaurant_with_boba">Restaurant with boba</option>
									<option value="boba_secondary">Boba secondary</option>
									<option value="other">Other</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Boba relevance</span>
								<select
									name="fact_boba_relevance"
									value={factText(publishing, 'boba_relevance')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="primary">Primary</option>
									<option value="substantial">Substantial</option>
									<option value="secondary">Secondary</option>
									<option value="incidental">Incidental</option>
									<option value="none">None</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Price positioning</span>
								<select
									name="fact_price_positioning"
									value={factText(publishing, 'price_positioning')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="budget">Budget</option>
									<option value="mid_range">Mid range</option>
									<option value="premium">Premium</option>
									<option value="luxury">Luxury</option>
								</select>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Brand status</span>
								<select
									name="fact_brand_status"
									value={factText(publishing, 'brand_status')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								>
									<option value="">Not provided</option>
									<option value="active">Active</option>
									<option value="dormant">Dormant</option>
									<option value="acquired">Acquired</option>
									<option value="rebranded">Rebranded</option>
									<option value="closed">Closed</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">Products and footprint</h4>
						<dl class="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 text-xs">
							<div class="grid gap-1 py-2.5 sm:grid-cols-[130px_1fr]">
								<dt class="font-semibold text-zinc-800">Market presence</dt>
								<dd class="text-zinc-600">Researched brand coverage.</dd>
							</div>
							<div class="grid gap-1 py-2.5 sm:grid-cols-[130px_1fr]">
								<dt class="font-semibold text-zinc-800">Brand locations</dt>
								<dd class="text-zinc-600">
									Actual geocoded storefronts; county collections are derived from these.
								</dd>
							</div>
							<div class="grid gap-1 py-2.5 sm:grid-cols-[130px_1fr]">
								<dt class="font-semibold text-zinc-800">Region codes</dt>
								<dd class="text-zinc-600">
									Ingestion scopes only; they are not evidence that a brand operates there.
								</dd>
							</div>
						</dl>
						<div class="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<label>
								<span class="text-xs font-medium text-zinc-600">Product categories</span>
								<textarea
									name="fact_product_categories"
									rows="4"
									value={factList(publishing, 'product_categories')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Signature products</span>
								<textarea
									name="fact_signature_products"
									rows="4"
									value={factList(publishing, 'signature_products')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Known for</span>
								<textarea
									name="fact_known_for"
									rows="4"
									value={factList(publishing, 'known_for')}
									placeholder="One per line"
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Store count statement</span>
								<input
									name="fact_store_count_statement"
									value={factText(publishing, 'store_count_statement')}
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Store count as of</span>
								<input
									name="fact_store_count_as_of"
									value={factText(publishing, 'store_count_as_of')}
									placeholder="2026-07"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>

						<div class="mt-5 space-y-3">
							<div class="flex items-start justify-between gap-3">
								<div>
									<h5 class="text-xs font-semibold text-zinc-500 uppercase">Market presence</h5>
									<p class="mt-1 text-xs text-zinc-500">
										Where the brand is known to operate. Not individual storefronts or ingestion
										scope.
									</p>
								</div>
								<button
									type="button"
									onclick={startAddingMarket}
									class="rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
									aria-label="Add market"
								>
									+
								</button>
							</div>
							<input
								type="hidden"
								name="fact_market_presence"
								value={JSON.stringify(publishMarketPresence)}
							/>
							<div class="flex flex-wrap gap-2">
								{#each publishMarketPresence as place, index}
									{#if rebindingMarketIndex === index}
										<div class="w-full max-w-md">
											<GeoPlaceTypeahead
												value={place.display_name || place.name}
												selectedId={place.place_id}
												canonicalName={place.name}
												countryCode={place.country_code}
												admin1Code={place.admin1_code}
												autoSelectExact={true}
												autofocus={true}
												contextKey={`${publishing.brand_slug}:rebind:${index}`}
												onselect={(selected) => rebindMarketPresencePlace(index, selected)}
												oncancel={cancelMarketEditor}
											/>
										</div>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs {place.place_id
												? 'border-zinc-200 bg-zinc-50 text-zinc-800'
												: 'border-amber-300 bg-amber-50 text-amber-900'}"
										>
											<button
												type="button"
												onclick={() => {
													if (!place.place_id) {
														addingMarket = false;
														rebindingMarketIndex = index;
													}
												}}
												class="font-medium"
												title={place.place_id
													? place.display_name || place.name
													: 'Select a canonical match before publishing'}
											>
												{marketChipLabel(place)}
											</button>
											<button
												type="button"
												onclick={() => removeMarketPresencePlace(index)}
												class="rounded-full px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800"
												aria-label={`Remove ${place.name || 'market'}`}
											>
												×
											</button>
										</span>
									{/if}
								{/each}
								{#if addingMarket}
									<div class="w-full max-w-md">
										<GeoPlaceTypeahead
											autofocus={true}
											contextKey={`${publishing.brand_slug}:add`}
											onselect={addMarketPresencePlace}
											oncancel={cancelMarketEditor}
										/>
									</div>
								{/if}
							</div>
							{#if publishMarketPresence.length === 0 && !addingMarket}
								<p
									class="rounded border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500"
								>
									No structured market presence yet. Use + to add a place.
								</p>
							{/if}
							{#if resolvingMarkets}
								<p class="text-[11px] text-zinc-500">Matching canonical places…</p>
							{/if}
							{#if publishMarketPresence.some((place) => !place.place_id)}
								<p class="text-[11px] text-amber-700">
									Amber markets still need a canonical match. Click the name to search, or remove
									them.
								</p>
							{/if}

							{#if claimEvidence(publishing, ['markets', 'market_presence']).length}
								<div class="rounded border border-zinc-200 bg-white px-3 py-3">
									<p class="text-xs font-semibold text-zinc-500 uppercase">Markets evidence</p>
									<div class="mt-2 space-y-3">
										{#each claimEvidence(publishing, ['markets', 'market_presence']) as claim}
											<div>
												<p class="text-sm font-medium text-zinc-900">
													{claim.claim_key.replaceAll('_', ' ')}
													<span class="ml-2 text-xs font-normal text-zinc-500"
														>{claim.evidence_assessment ?? 'unassessed'}</span
													>
												</p>
												{#if claim.rationale}<p class="mt-1 text-xs leading-5 text-zinc-600">
														{claim.rationale}
													</p>{/if}
												{#if claim.citations.length}
													<div class="mt-2 flex flex-wrap gap-2">
														{#each claim.citations as citation}
															{#if citation.source}<a
																	href={citation.source.url}
																	target="_blank"
																	rel="noreferrer"
																	class="max-w-full truncate rounded border border-zinc-200 px-2 py-1 text-xs text-blue-700 hover:bg-zinc-50"
																	>{citation.source.title ??
																		citation.source.publisher ??
																		citation.source.url}</a
																>{/if}
														{/each}
													</div>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							{#if !publishing.physicalLocations?.length && (publishing.enrichmentFootprint?.length ?? 0) > 0}
								<div class="rounded border border-amber-200 bg-amber-50 px-3 py-3">
									<p class="text-xs font-semibold text-amber-800 uppercase">
										Resolved enrichment footprint
									</p>
									<p class="mt-1 text-xs text-amber-800">
										Backup places from enrichment when this brand has no confirmed locations.
										Read-only.
									</p>
									<ul class="mt-2 space-y-1">
										{#each publishing.enrichmentFootprint ?? [] as place}
											<li class="text-sm text-amber-950">
												<span class="font-medium">{place.name}</span>
												<span class="text-xs text-amber-800">
													· {place.level} · {place.code}
												</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					</section>

					<section class="border-t border-zinc-200 pt-6">
						<h4 class="text-sm font-semibold text-zinc-950">History and review</h4>
						<div class="mt-3 grid gap-4 md:grid-cols-2">
							<label class="md:col-span-2">
								<span class="text-xs font-medium text-zinc-600">History summary</span>
								<textarea
									name="fact_history_summary"
									rows="4"
									value={factText(publishing, 'history_summary')}
									class="mt-1 block w-full rounded border-zinc-300 text-sm"
								></textarea>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Observed at</span>
								<input
									name="fact_observed_at"
									value={factText(publishing, 'observed_at')}
									placeholder="2026-07-27"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label>
								<span class="text-xs font-medium text-zinc-600">Review note (optional)</span>
								<input
									name="note"
									placeholder="Why you changed or approved this result"
									class="mt-1 block h-10 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
					</section>

					{#if publishError}
						<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
							{publishError}
						</div>
					{/if}
				</div>

				<div
					class="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-5 py-4"
				>
					<p class="text-xs text-zinc-500">Only changed fields are recorded in the audit.</p>
					<div class="flex shrink-0 gap-2">
						<button
							type="button"
							onclick={closePublish}
							class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>
							Cancel
						</button>
						<button
							class="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
							disabled={publishHasAliasDraft || Boolean(pendingAction)}
						>
							{pendingAction === 'reviewAndPublish'
								? 'Publishing…'
								: publishing.approval_status === 'approved'
									? 'Confirm and republish'
									: 'Confirm and publish'}
						</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if rerunning}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeRerun()}
	>
		<div
			class="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="rerun-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="rerun-title" class="text-lg font-semibold text-zinc-950">Rerun enrichment?</h3>
				<p class="mt-1 text-sm text-zinc-600">
					Save any missing research context and queue a fresh enrichment run for cron processing.
				</p>
			</div>
			<form
				method="post"
				action="?/saveResearchScope"
				use:enhance={actionEnhance('saveResearchScope')}
				class="space-y-4 border-b border-zinc-200 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={rerunning.brand_slug} />
				<input type="hidden" name="research_scope" value={serializeResearchScope(rerunScope)} />
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h4 class="text-sm font-semibold text-zinc-950">Reusable research scope</h4>
						<p class="mt-1 max-w-xl text-xs leading-5 text-zinc-500">
							Defines the private identity boundary reused by future enrichment runs. Saving it does
							not queue work.
						</p>
					</div>
					{#if rerunScope.updated_at}
						<span class="text-xs text-zinc-500">Updated {relativeDate(rerunScope.updated_at)}</span>
					{/if}
				</div>

				{#if rerunScopeLoading}
					<p class="border-l-2 border-blue-400 bg-blue-50 px-3 py-2 text-sm text-blue-800">
						Loading saved research scope…
					</p>
				{:else}
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block">
							<span class="text-sm font-medium text-zinc-800">Identity basis</span>
							<select
								bind:value={rerunScope.identity_basis}
								class="mt-1 w-full rounded border-zinc-300 text-sm"
							>
								<option value="">Not specified</option>
								<option value="official">Official identity</option>
								<option value="multi_location_cluster">Multi-location cluster</option>
								<option value="local">Local business</option>
								<option value="ambiguous">Ambiguous identity</option>
							</select>
						</label>
						<label
							class="flex min-h-16 items-center gap-3 border-l-2 border-zinc-300 bg-zinc-50 px-3 py-2"
						>
							<input
								type="checkbox"
								bind:checked={rerunScope.identity_scope_verified}
								class="rounded border-zinc-300 text-zinc-950 focus:ring-zinc-500"
							/>
							<span>
								<span class="block text-sm font-medium text-zinc-900"
									>Human-verified identity boundary</span
								>
								<span class="mt-0.5 block text-xs text-zinc-500"
									>Use only after manually confirming the intended brand identity.</span
								>
							</span>
						</label>
					</div>

					<label class="block">
						<span class="text-sm font-medium text-zinc-800">Research directive</span>
						<textarea
							bind:value={rerunScope.research_directive}
							maxlength="2000"
							rows="3"
							placeholder="Constrained guidance that applies to future research runs"
							class="mt-1 w-full rounded border-zinc-300 text-sm"
						></textarea>
						<span class="mt-1 block text-right text-xs text-zinc-400"
							>{rerunScope.research_directive.length}/2000</span
						>
					</label>

					<div class="border-t border-zinc-200 pt-4">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold text-zinc-950">Research anchors</p>
								<p class="mt-1 text-xs text-zinc-500">
									Include, exclude, or prefer markets, URLs, social accounts, and observed
									locations.
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onclick={() => addResearchAnchor('market', 'include')}
									disabled={rerunScope.anchors.length >= 40}
									class="inline-flex h-9 items-center gap-1.5 rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
									aria-label="Add market anchor"><span aria-hidden="true">+</span> Market</button
								>
								<button
									type="button"
									onclick={() => addResearchAnchor('location_observation', 'prefer')}
									disabled={rerunScope.anchors.length >= 40}
									class="inline-flex h-9 items-center gap-1.5 rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
									aria-label="Add location observation"
									><span aria-hidden="true">+</span> Location</button
								>
								<button
									type="button"
									onclick={() => addResearchAnchor()}
									disabled={rerunScope.anchors.length >= 40}
									class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-zinc-300 text-xl text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
									title="Add URL anchor"
									aria-label="Add URL anchor">+</button
								>
							</div>
						</div>

						<div class="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
							<p>
								<strong class="font-medium text-zinc-700">Market:</strong> a country, state, or operating
								territory.
							</p>
							<p>
								<strong class="font-medium text-zinc-700">Location:</strong> an observed shop or locality
								used to ground identity.
							</p>
						</div>

						{#if rerunAnchor}
							<div
								class="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2"
							>
								<div>
									<p class="text-xs font-medium text-amber-950">
										Legacy location grounding: {rerunAnchor}
									</p>
									<p class="mt-0.5 text-xs text-amber-800">
										Preserved for current worker compatibility.
									</p>
								</div>
								{#if !hasLocationObservation(rerunAnchor)}
									<button
										type="button"
										onclick={addLegacyLocationToScope}
										class="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
										>Add as location observation</button
									>
								{:else}
									<span class="text-xs font-medium text-amber-800">Represented in scope</span>
								{/if}
							</div>
						{/if}

						<div class="mt-3 divide-y divide-zinc-200 border-y border-zinc-200">
							{#each rerunScope.anchors as anchor (anchor.clientKey)}
								<div class="space-y-3 py-4">
									<div class="grid gap-3 sm:grid-cols-[130px_170px_minmax(0,1fr)_36px]">
										<select
											bind:value={anchor.role}
											aria-label="Anchor role"
											class="rounded border-zinc-300 text-sm"
										>
											<option value="include">Include</option>
											<option value="prefer">Prefer</option>
											<option value="exclude">Exclude</option>
										</select>
										<select
											bind:value={anchor.type}
											aria-label="Anchor type"
											class="rounded border-zinc-300 text-sm"
										>
											<option value="market">Market</option>
											<option value="url">URL</option>
											<option value="social">Social account</option>
											<option value="location_observation">Location observation</option>
										</select>
										<input
											bind:value={anchor.value}
											type={anchor.type === 'url' || anchor.type === 'social' ? 'url' : 'text'}
											maxlength="2048"
											required
											placeholder={anchor.type === 'market'
												? 'Australia'
												: anchor.type === 'location_observation'
													? 'Reno, Nevada'
													: 'https://…'}
											aria-label="Anchor value"
											class="min-w-0 rounded border-zinc-300 text-sm"
										/>
										<button
											type="button"
											onclick={() => removeResearchAnchor(anchor.clientKey)}
											class="inline-flex h-9 w-9 items-center justify-center rounded text-zinc-500 hover:bg-red-50 hover:text-red-700"
											title="Remove anchor"
											aria-label="Remove research anchor"
										>
											<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="h-4 w-4"
												aria-hidden="true"
											>
												<path d="M3 6h18" />
												<path d="M8 6V4h8v2" />
												<path d="M19 6l-1 14H6L5 6" />
											</svg>
										</button>
									</div>
									<div class="grid gap-3 sm:grid-cols-2">
										<input
											bind:value={anchor.reference_id}
											maxlength="200"
											placeholder="Reference ID (optional)"
											aria-label="Anchor reference ID"
											class="rounded border-zinc-300 text-sm"
										/>
										<input
											bind:value={anchor.notes}
											maxlength="500"
											placeholder="Curator note (optional)"
											aria-label="Anchor notes"
											class="rounded border-zinc-300 text-sm"
										/>
									</div>
									<label class="inline-flex items-center gap-2 text-xs text-zinc-600">
										<input
											type="checkbox"
											bind:checked={anchor.curator_verified}
											class="rounded border-zinc-300 text-zinc-950 focus:ring-zinc-500"
										/>
										Curator verified
									</label>
								</div>
							{/each}
							{#if rerunScope.anchors.length === 0}
								<p class="py-4 text-sm text-zinc-500">No reusable anchors.</p>
							{/if}
						</div>
					</div>
				{/if}

				{#if rerunScopeError}
					<div class="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">
						{rerunScopeError}
					</div>
				{/if}

				<div class="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
					<p class="text-xs text-zinc-500">
						{rerunScopeDirty ? 'Unsaved scope changes.' : 'Reusable scope is saved.'}
					</p>
					<button
						class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={rerunScopeLoading || !rerunScopeDirty || Boolean(pendingAction)}
					>
						{pendingAction === 'saveResearchScope' ? 'Saving…' : 'Save scope'}
					</button>
				</div>
			</form>

			<form
				method="post"
				action="?/rerunEnrichment"
				use:enhance={actionEnhance('rerunEnrichment')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={rerunning.brand_slug} />
				<input type="hidden" name="enrichment_location_anchor" value={rerunAnchor} />
				<details class="border-y border-zinc-200 py-3">
					<summary class="cursor-pointer text-sm font-semibold text-zinc-950">
						Temporary research hints
					</summary>
					<div class="mt-1 pl-5 text-xs leading-5 text-zinc-500">
						Optional corrections for this rerun only. Reusable identity boundaries belong in the
						saved scope above.
					</div>
					<div class="mt-4 space-y-4 pl-5">
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="block">
								<span class="text-sm font-medium text-zinc-800">Expected canonical name</span>
								<input
									name="expected_canonical_name"
									bind:value={rerunExpectedCanonicalName}
									maxlength="160"
									placeholder="Gotcha Fresh Tea"
									class="mt-1 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
							<label class="block">
								<span class="text-sm font-medium text-zinc-800">Expected brand origin</span>
								<input
									name="expected_origin"
									bind:value={rerunExpectedOrigin}
									maxlength="160"
									placeholder="Australia"
									class="mt-1 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
						<label class="block">
							<span class="text-sm font-medium text-zinc-800">Expected official website</span>
							<input
								name="expected_official_website"
								type="url"
								bind:value={rerunOfficialWebsite}
								maxlength="2048"
								placeholder="https://brand.example"
								class="mt-1 w-full rounded border-zinc-300 text-sm"
							/>
							<span class="mt-1 block text-xs text-zinc-500">
								Research hint only; this does not overwrite the published website.
							</span>
						</label>
						<div class="grid gap-4 sm:grid-cols-2">
							<label class="block">
								<span class="text-sm font-medium text-zinc-800">Source relationship</span>
								<select
									name="verified_source_kind"
									bind:value={rerunSourceKind}
									class="mt-1 w-full rounded border-zinc-300 text-sm"
								>
									<option value="unknown">Not specified</option>
									<option value="official_brand">Official global brand</option>
									<option value="regional_operator">Regional operator or franchise</option>
									<option value="directory_listing">Directory listing</option>
									<option value="independent_source">Independent source</option>
								</select>
							</label>
							<label class="block">
								<span class="text-sm font-medium text-zinc-800">Verified website/source URL</span>
								<input
									name="verified_source_url"
									type="url"
									bind:value={rerunSourceUrl}
									placeholder="https://…"
									class="mt-1 w-full rounded border-zinc-300 text-sm"
								/>
							</label>
						</div>
						<p class="text-xs leading-5 text-zinc-500">
							Directory pages support identity and location but are never published as the official
							website.
						</p>
					</div>
				</details>
				<div>
					<p class="text-sm font-medium text-zinc-900">{rerunning.brand_slug}</p>
					<p class="mt-1 text-xs text-zinc-500">
						The current dossier remains available until the new research run completes. The job ID
						will be shown in the success toast and History.
					</p>
					{#if rerunScopeDirty}
						<p class="mt-2 text-xs font-medium text-amber-700">
							Save the reusable research scope before queuing this rerun.
						</p>
					{/if}
				</div>
				{#if rerunError}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{rerunError}
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeRerun}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
						disabled={rerunScopeLoading || rerunScopeDirty || Boolean(pendingAction)}
					>
						{pendingAction === 'rerunEnrichment' ? 'Queuing…' : 'Confirm rerun'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if resetting}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeReset()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="reset-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="reset-title" class="text-lg font-semibold text-zinc-950">
					Reset brand enrichment?
				</h3>
				<p class="mt-1 text-sm text-zinc-600">
					This immediately unpublishes the profile, archives the current dossier, supersedes its
					claims, cancels active enrichment work, and leaves enrichment disabled for the brand.
				</p>
			</div>
			<form
				method="post"
				action="?/resetEnrichment"
				use:enhance={actionEnhance('resetEnrichment')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={resetting.brand_slug} />
				<p class="font-mono text-sm font-medium break-all text-zinc-900">
					{resetting.brand_slug}
				</p>
				<label class="block">
					<span class="text-sm font-medium text-zinc-800">Reset reason</span>
					<textarea
						name="reason"
						rows="3"
						required
						bind:value={resetReason}
						placeholder="What is wrong with the current enrichment?"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea>
				</label>
				{#if resetError}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{resetError}
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeReset}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
						disabled={!resetReason.trim() || Boolean(pendingAction)}
					>
						{pendingAction === 'resetEnrichment' ? 'Resetting…' : 'Confirm reset'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if closing}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeMarkClosed()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="close-brand-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="close-brand-title" class="text-lg font-semibold text-zinc-950">
					Mark brand closed?
				</h3>
				<p class="mt-1 font-mono text-sm break-all text-zinc-600">{closing.brand_slug}</p>
			</div>
			<form
				method="post"
				action="?/markClosed"
				use:enhance={actionEnhance('markClosed')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={closing.brand_slug} />
				<label class="block">
					<span class="text-sm font-medium text-zinc-800">Closure evidence</span>
					<textarea
						name="note"
						rows="3"
						required
						bind:value={closeNote}
						placeholder="How was the closure verified?"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea>
				</label>
				{#if closeError}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
						{closeError}
					</div>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeMarkClosed}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					>
					<button
						class="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
						disabled={!closeNote.trim() || Boolean(pendingAction)}
					>
						{pendingAction === 'markClosed' ? 'Saving…' : 'Confirm closed'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

{#if deleting}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeDelete()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="delete-title" class="text-lg font-semibold text-zinc-950">
					Permanently delete false positive
				</h3>
				<p class="mt-1 text-sm text-red-700">
					This cannot be undone. The API will refuse deletion when shops or feed events still depend
					on this brand.
				</p>
			</div>
			<form
				method="post"
				action="?/deleteFalsePositive"
				use:enhance={actionEnhance('deleteFalsePositive')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={deleting.brand_slug} />
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Type the exact slug</span><code
						class="mt-1 block rounded bg-zinc-100 px-2 py-1 text-xs break-all text-zinc-700"
						>{deleting.brand_slug}</code
					><input
						name="confirmation_slug"
						bind:value={deleteConfirmation}
						autocomplete="off"
						required
						class="mt-2 block w-full rounded border-zinc-300 text-sm"
					/></label
				>
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Verification note</span><textarea
						name="note"
						bind:value={deleteNote}
						rows="3"
						required
						placeholder="Verified false positive through …"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea></label
				>
				{#if deleteError}<div
						class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{deleteError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeDelete}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					><button
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={deleteConfirmation !== deleting.brand_slug ||
							!deleteNote.trim() ||
							Boolean(pendingAction)}
						>{pendingAction === 'deleteFalsePositive' ? 'Deleting…' : 'Delete permanently'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
