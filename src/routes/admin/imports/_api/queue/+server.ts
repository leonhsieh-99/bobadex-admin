import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) throw error(401, 'Not logged in');
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const form = await request.formData();
	const region_key = (form.get('region_key') as string | null) ?? null;
	const raw = form.get('params') as string | null;
	const note = (form.get('note') as string | null) ?? null;

	if (!region_key) throw error(400, 'Missing region_key');
	if (!raw) throw error(400, 'Missing params');

	let obj: unknown;
	try {
		obj = JSON.parse(raw);
	} catch {
		throw error(400, 'Invalid JSON');
	}

	type BboxQueryParams = { south: number; west: number; north: number; east: number };

	// UI historically sent `{ bbox: [south,west,north,east], ... }`.
	const bboxFromLegacy =
		obj &&
		typeof obj === 'object' &&
		'bbox' in obj &&
		Array.isArray((obj as any).bbox) &&
		(obj as any).bbox.length === 4
			? (obj as any).bbox
			: null;

	const queryParams: BboxQueryParams | null = (() => {
		if (bboxFromLegacy) {
			const [south, west, north, east] = bboxFromLegacy;
			if (
				typeof south === 'number' &&
				typeof west === 'number' &&
				typeof north === 'number' &&
				typeof east === 'number'
			) {
				return { south, west, north, east };
			}
		}

		// Newer shape: `{ query_params: { south, west, north, east } }`
		if (obj && typeof obj === 'object' && 'query_params' in obj) {
			const qp = (obj as any).query_params;
			if (
				qp &&
				typeof qp === 'object' &&
				typeof qp.south === 'number' &&
				typeof qp.west === 'number' &&
				typeof qp.north === 'number' &&
				typeof qp.east === 'number'
			) {
				return { south: qp.south, west: qp.west, north: qp.north, east: qp.east };
			}
		}

		return null;
	})();

	if (!queryParams) {
		throw error(400, 'params must include bbox:[south,west,north,east]');
	}

	const payload = {
		region_key,
		query_type: 'bbox' as const,
		query_params: queryParams,
		source: 'osm' as const
	};

	const authHeader = request.headers.get('authorization');
	const { data, error: invokeErr } = await locals.supabase.functions.invoke(
		'run-osm-import-region',
		{
			body: payload,
			headers: authHeader ? { Authorization: authHeader } : undefined
		}
	);

	if (invokeErr) {
		throw redirect(
			303,
			`/admin/imports?toast=enqueue_failed&msg=${encodeURIComponent(invokeErr.message)}`
		);
	}

	const jobId = (data as any)?.job_id as string | undefined;
	if (!jobId) {
		throw redirect(
			303,
			`/admin/imports?toast=enqueue_failed&msg=${encodeURIComponent('missing job_id')}`
		);
	}

	// Note is not currently persisted by run-osm-import-region.
	void note;

	throw redirect(303, `/admin/imports?toast=queued&id=${jobId}`);
};
