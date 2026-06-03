// src/routes/admin/imports/+page.server.ts
import type { Actions } from './$types';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type JobRow = {
	id: string;
	source: string | null;
	status: 'running' | 'succeeded' | 'failed';
	created_at: string;
	stats: Record<string, number> | null;
	note: string | null;
	error_text: string | null;
};

type CandidateRow = {
	id: string;
	name: string | null;
	lat: number | null;
	lon: number | null;
	tags: Record<string, string> | null;
	matched_brand_slug: string | null;
	match_score: number | null;
	blocked_brand: boolean;
	blocked_reason: string | null;
	staging_id: string | null;
	process_status: OsmCandidateStatus;
	created_at: string;
};

type ApproveResult = {
	brand_slug: string;
	brand_display: string;
	op: 'created_new' | 'merged_existing';
};
type OsmCandidateStatus =
	| 'pending'
	| 'merged'
	| 'approved'
	| 'needs_review'
	| 'blocked'
	| 'rejected';
type CandidateStatusFilter = 'all' | OsmCandidateStatus;
const candidateStatuses: OsmCandidateStatus[] = [
	'needs_review',
	'pending',
	'blocked',
	'approved',
	'merged',
	'rejected'
];

type RegionCodeRow = {
	code: string;
	country_code: string;
	region_name: string;
};

export const load: PageServerLoad = async ({ locals, url }) => {
	// Jobs
	const { data: jobs } = await locals.supabase
		.schema('ingest')
		.from('osm_import_jobs')
		.select('id,source,status,created_at,stats,note,error_text')
		.order('created_at', { ascending: false })
		.limit(500);

	// Candidates (filter from query string)
	const requestedStatus = url.searchParams.get('status');
	const candStatus: CandidateStatusFilter = candidateStatuses.includes(
		requestedStatus as OsmCandidateStatus
	)
		? (requestedStatus as OsmCandidateStatus)
		: requestedStatus === 'all'
			? 'all'
			: 'needs_review';
	const q = url.searchParams.get('q') ?? '';

	let qCand = locals.supabase
		.schema('ingest')
		.from('osm_candidates')
		.select(
			'id,name,lat,lon,tags,matched_brand_slug,match_score,blocked_brand,blocked_reason,staging_id,process_status,created_at'
		) // <-- lat/lon/tags
		.order('match_score', { ascending: false, nullsFirst: false })
		.order('created_at', { ascending: false })
		.limit(100);

	if (candStatus !== 'all') {
		qCand = qCand.eq('process_status', candStatus);
	}

	if (q) qCand = qCand.ilike('name', `%${q}%`);

	const { data: candidates, error: candidatesErr } = await qCand;
	if (candidatesErr) {
		console.error(candidatesErr);
		throw error(500, `Failed to load OSM candidates: ${candidatesErr.message}`);
	}

	const { data: stagingRows } = await locals.supabase
		.schema('ingest')
		.from('brand_staging')
		.select(
			'id,suggested_name,normalized_name,location,status,source,duplicates,created_at,approved_slug'
		)
		.eq('source', 'osm')
		.eq('status', 'pending')
		.order('created_at', { ascending: false })
		.limit(100);

	const { data: regionCodes } = await locals.supabase
		.from('region_codes')
		.select('code,country_code,region_name')
		.order('code', { ascending: true });

	return {
		jobs: (jobs ?? []) as JobRow[],
		candidates: (candidates ?? []) as CandidateRow[],
		stagingRows: (stagingRows ?? []) as Array<{
			id: string;
			suggested_name: string;
			normalized_name: string | null;
			location: string | null;
			status: string;
			source: string;
			duplicates: number | null;
			created_at: string;
			approved_slug: string | null;
		}>,
		regionCodes: (regionCodes ?? []) as RegionCodeRow[],
		candidateStatuses,
		candStatus,
		q
	};
};

export const actions: Actions = {
	approve: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const candidate_id = form.get('candidate_id') as string | null;
		const force_display = (form.get('force_display') as string | null) || null;
		const note = (form.get('note') as string | null) || null;

		if (!candidate_id) {
			throw redirect(303, '/admin/imports?toast=approve_failed&msg=missing_candidate_id');
		}

		const { data, error: rpcErr } = await locals.supabase
			.rpc('approve_osm_candidate', {
				p_candidate_id: candidate_id,
				p_force_display: force_display,
				p_note: note
			})
			.returns<ApproveResult[]>();

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=approve_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		const row = Array.isArray(data) && data[0] ? data[0] : null;
		if (!row) {
			throw redirect(303, '/admin/imports?toast=approve_failed&msg=no_result');
		}

		throw redirect(
			303,
			`/admin/imports?toast=${row.op}&brand=${encodeURIComponent(row.brand_slug)}`
		);
	},

	reject: async ({ request, locals }) => {
		if (!locals.isAdmin) throw error(403, 'Forbidden');

		const form = await request.formData();
		const candidate_id = form.get('candidate_id') as string | null;
		const note = (form.get('note') as string | null) || null;

		if (!candidate_id) {
			throw redirect(303, '/admin/imports?toast=reject_failed&msg=missing_candidate_id');
		}

		const { error: rpcErr } = await locals.supabase.rpc('reject_osm_candidate', {
			p_candidate_id: candidate_id,
			p_note: note
		});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=reject_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		throw redirect(303, '/admin/imports?toast=rejected');
	},

	merge: async ({ request, locals }) => {
		if (!locals.userId || !locals.isAdmin) throw error(403, 'Forbidden');

		const fd = await request.formData();
		const candidate_id = String(fd.get('candidate_id') ?? '');
		const brand_slug = String(fd.get('brand_slug') ?? '');
		const note = (fd.get('note') as string | null) ?? null;

		if (!candidate_id || !brand_slug) {
			throw redirect(303, '/admin/imports?toast=merge_failed&msg=missing_params');
		}

		const { error: rpcErr } = await locals.supabase.rpc('admin_merge_candidate_to_brand', {
			p_candidate_id: candidate_id,
			p_brand_slug: brand_slug,
			p_note: note
		});

		if (rpcErr) {
			throw redirect(
				303,
				`/admin/imports?toast=merge_failed&msg=${encodeURIComponent(rpcErr.message)}`
			);
		}

		throw redirect(303, '/admin/imports?toast=merged');
	}
};
