// src/routes/admin/imports/_api/dequeue/+server.ts
import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.userId) throw error(401, 'Not logged in');
  if (!locals.isAdmin) throw error(403, 'Forbidden');

  const form = await request.formData();
  const id = form.get('job_id') as string | null;
  if (!id) throw error(400, 'missing job_id');

  const { data: stagingIdRows, error: stagingIdsErr } = await locals.supabase
    .schema('ingest')
    .from('osm_candidates')
    .select('staging_id')
    .eq('import_job_id', id);

  if (stagingIdsErr) {
    throw redirect(
      303,
      `/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(
        stagingIdsErr.message
      )}`
    );
  }

  const stagingIds = (stagingIdRows ?? [])
    .map((r) => r.staging_id as string | null)
    .filter((v): v is string => !!v);

  // Delete candidates first (no FK assumptions/cascade guarantees).
  const { error: candErr } = await locals.supabase
    .schema('ingest')
    .from('osm_candidates')
    .delete()
    .eq('import_job_id', id);

  if (candErr) {
    throw redirect(
      303,
      `/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(
        candErr.message
      )}`
    );
  }

  const { error: jobErr } = await locals.supabase
    .schema('ingest')
    .from('osm_import_jobs')
    .delete()
    .eq('id', id);

  if (jobErr) {
    throw redirect(
      303,
      `/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(jobErr.message)}`
    );
  }

  if (stagingIds.length) {
    const { error: stagingDeleteErr } = await locals.supabase
      .schema('ingest')
      .from('brand_staging')
      .delete()
      .in('id', stagingIds);

    if (stagingDeleteErr) {
      throw redirect(
        303,
        `/admin/imports?toast=dequeue_failed&msg=${encodeURIComponent(
          stagingDeleteErr.message
        )}`
      );
    }
  }
  throw redirect(303, `/admin/imports?toast=dequeued&id=${id}`);
};
