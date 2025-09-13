import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.userId) throw error(401, 'Not logged in');
  if (!locals.isAdmin) throw error(403, 'Forbidden');

  const form = await request.formData();
  const raw  = form.get('params') as string | null;
  const note = (form.get('note') as string | null) ?? null;

  if (!raw) throw error(400, 'Missing params');

  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { throw error(400, 'Invalid JSON'); }

  const { data: id, error: rpcErr } = await locals.supabase.rpc('osm_jobs_enqueue', {
    p_source: 'overpass',
    p_params: obj,
    p_note: note
  });

  if (rpcErr) {
    throw redirect(303, `/admin/imports?toast=enqueue_failed&msg=${encodeURIComponent(rpcErr.message)}`);
  }

  throw redirect(303, `/admin/imports?toast=queued&id=${id}`);
};
