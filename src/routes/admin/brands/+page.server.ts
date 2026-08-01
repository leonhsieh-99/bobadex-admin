// src/routes/admin/brands/+page.server.ts
import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';

type PendingBrand = {
	id: string;
	suggested_name: string;
	normalized_name: string | null;
	location: string | null;
	source: string | null;
	status: string | null;
	created_at: string;
	duplicates: number | null;
	slug: string | null;
};

type CandidateEvidence = {
	id: string;
	name: string | null;
	normalized_name: string | null;
	lat: number | null;
	lon: number | null;
	tags: Record<string, string> | null;
	raw_tags: Record<string, string> | null;
	match_score: number | null;
	matched_brand_slug: string | null;
	blocked_brand: boolean;
	blocked_reason: string | null;
	staging_id: string | null;
	process_status: string;
	region_key: string | null;
	match_bucket: string | null;
	created_at: string;
};

export const load: PageServerLoad = async ({ locals }) => {
	const { data: pending, error: qErr } = await locals.supabase
		.schema('ingest')
		.from('brand_staging')
		.select(
			'id, suggested_name, normalized_name, location, source, status, created_at, duplicates, slug'
		)
		.eq('status', 'pending')
		.order('duplicates', { ascending: false, nullsFirst: false })
		.order('created_at', { ascending: true });
	if (qErr) {
		console.error(qErr);
		throw error(500, 'Failed to load pending brands');
	}

	const { data: pendingDelete, error: dErr } = await locals.supabase
		.schema('ingest')
		.from('brand_staging')
		.select('id, suggested_name, status, created_at, duplicates, slug')
		.eq('status', 'pending_delete')
		.order('duplicates', { ascending: false, nullsFirst: false })
		.order('created_at', { ascending: true });
	if (dErr) {
		console.error(dErr);
		throw error(500, 'Failed to load pending delete requests');
	}

	const pendingRows = (pending ?? []) as PendingBrand[];
	const stagingIds = pendingRows.map((row) => row.id);
	const normalizedNames = Array.from(
		new Set(pendingRows.map((row) => row.normalized_name).filter(Boolean) as string[])
	);

	const candidateQueries = [];
	if (stagingIds.length) {
		candidateQueries.push(
			locals.supabase
				.schema('ingest')
				.from('osm_candidates')
				.select(
					'id,name,normalized_name,lat,lon,tags,raw_tags,match_score,matched_brand_slug,blocked_brand,blocked_reason,staging_id,process_status,region_key,match_bucket,created_at'
				)
				.in('staging_id', stagingIds)
				.limit(300)
		);
	}
	if (normalizedNames.length) {
		candidateQueries.push(
			locals.supabase
				.schema('ingest')
				.from('osm_candidates')
				.select(
					'id,name,normalized_name,lat,lon,tags,raw_tags,match_score,matched_brand_slug,blocked_brand,blocked_reason,staging_id,process_status,region_key,match_bucket,created_at'
				)
				.in('normalized_name', normalizedNames)
				.order('match_score', { ascending: false, nullsFirst: false })
				.limit(300)
		);
	}

	const candidateResults = await Promise.all(candidateQueries);
	const candidates = new Map<string, CandidateEvidence>();
	for (const result of candidateResults) {
		if (result.error) {
			console.error(result.error);
			throw error(500, 'Failed to load OSM candidate evidence');
		}
		for (const row of (result.data ?? []) as CandidateEvidence[]) {
			candidates.set(row.id, row);
		}
	}

	return {
		pending: pendingRows,
		pendingDelete: pendingDelete ?? [],
		candidates: Array.from(candidates.values())
	};
};

export const actions: Actions = {
	// existing flow: approve a "pending" brand
	verify: async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') as string | null;
		const force_display = (form.get('force_display') as string | null) || undefined;
		if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

		const { data, error } = await locals.supabase.rpc('approve_brand', {
			p_staging_id: id,
			p_force_display: force_display ?? null
		});

		if (error || data?.error) {
			const msg = encodeURIComponent(data?.error ?? error?.message ?? 'Verify failed');
			throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
		}

		const row = Array.isArray(data) ? data[0] : data; // returns table(...)
		const slug = row?.brand_slug;
		const display = row?.brand_display;

		throw redirect(
			303,
			`/admin/brands?toast=verified&slug=${encodeURIComponent(slug)}&display=${encodeURIComponent(display)}`
		);
	},

	// existing flow: reject a "pending" brand
	reject: async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') as string | null;
		const reason = (form.get('reason') as string | null) || undefined;
		if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

		const { error } = await locals.supabase.rpc('reject_brand', {
			p_staging_id: id,
			p_reason: reason ?? null
		});

		if (error) {
			const msg = encodeURIComponent(error.message ?? 'Reject failed');
			throw redirect(303, `/admin/brands?toast=reject_failed&msg=${msg}`);
		}

		throw redirect(303, '/admin/brands?toast=rejected');
	},

	// NEW: approve a "pending_delete" request
	approveDelete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') as string | null;
		const slug = form.get('slug') as string | null;
		if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

		const { error } = await locals.supabase.rpc('approve_brand_delete', {
			p_staging_id: id,
			p_staging_slug: slug
		});

		if (error) {
			const msg = encodeURIComponent(error.message ?? 'Approve delete failed');
			throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
		}

		throw redirect(303, '/admin/brands?toast=verified'); // or a new toast like ?toast=delete_approved
	},

	// NEW: reject a "pending_delete" request (keep brand)
	rejectDelete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') as string | null;
		const reason = (form.get('reason') as string | null) || undefined;
		if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

		const { error } = await locals.supabase.rpc('reject_brand_delete', {
			p_staging_id: id,
			p_reason: reason ?? null
		});

		if (error) {
			const msg = encodeURIComponent(error.message ?? 'Keep brand failed');
			throw redirect(303, `/admin/brands?toast=reject_failed&msg=${msg}`);
		}

		throw redirect(303, '/admin/brands?toast=rejected'); // or ?toast=delete_rejected
	}
};
