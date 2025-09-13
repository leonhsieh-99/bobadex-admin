// src/routes/admin/imports/_api/dequeue/+server.ts
import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.userId) throw error(401, 'Not logged in');
  if (!locals.isAdmin) throw error(403, 'Forbidden');

  const form = await request.formData();
  const id = form.get('job_id') as string | null;
  if (!id) throw error(400, 'missing job_id');

  const { error: rpcErr } = await locals.supabase.rpc('osm_jobs_delete', { p_id: id });
  if (rpcErr) {
    throw redirect(303, `/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(rpcErr.message)}`);
  }
  throw redirect(303, `/admin/imports?toast=dequeued&id=${id}`);
};
