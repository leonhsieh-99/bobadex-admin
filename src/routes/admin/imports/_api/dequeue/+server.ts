// src/routes/admin/imports/_api/dequeue/+server.ts
import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) throw error(401, 'Not logged in');
	if (!locals.isAdmin) throw error(403, 'Forbidden');

	const form = await request.formData();
	const id = String(form.get('job_id') ?? '').trim();
	if (!id) throw error(400, 'missing job_id');

	const { error: deleteError } = await locals.supabase.rpc('admin_delete_osm_import_job', {
		p_job_id: id
	});

	if (deleteError) {
		throw redirect(
			303,
			`/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(deleteError.message)}`
		);
	}

	throw redirect(303, `/admin/imports?toast=dequeued&id=${encodeURIComponent(id)}`);
};
