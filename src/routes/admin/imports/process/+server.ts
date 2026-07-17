// src/routes/admin/imports/process/+server.ts
import type { RequestHandler } from './$types';
import { redirect, error } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.isAdmin) throw error(403, 'Forbidden');

  const form = await request.formData();
  const jobId = (form.get('job_id') as string | null) ?? url.searchParams.get('id');
  if (!jobId) throw redirect(303, '/admin/imports?toast=process_missing_id');

  // Fire & forget the Edge Function — no need to await.
  void locals.supabase.functions.invoke('process-osm-candidates', { body: { job_id: jobId } });

  // Immediately return; UI can poll job status
  throw redirect(303, `/admin/imports?toast=processing&id=${jobId}`);
};
