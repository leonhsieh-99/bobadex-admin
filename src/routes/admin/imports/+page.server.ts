// src/routes/admin/imports/+page.server.ts
import type { Actions } from './$types';
import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type JobRow = {
  id: string;
  source: string | null;
  status: 'queued'|'running'|'succeeded'|'failed';
  created_at: string;
  stats: Record<string, number> | null;
  note: string | null;
  error_text: string | null;
};

type CandidateRow = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  tags: Record<string, string> | null;
  match_brand_slug: string | null;
  match_score: number | null;
  blocked_brand: boolean;
  blocked_reason: string | null;
  staging_id: string | null;
  created_at: string;
};

type ApproveResult = { brand_slug: string; brand_display: string; op: 'created_new'|'merged_existing' };

export const load: PageServerLoad = async ({ locals, url }) => {
  // Jobs
  const { data: jobs } = await locals.supabase
    .from('osm_import_jobs')
    .select('id,source,status,created_at,stats,note,error_text')
    .order('created_at', { ascending: false })
    .limit(20);

  // Candidates (filter from query string)
  const candStatus = (url.searchParams.get('status') ?? 'pending') as 'pending'|'approved'|'rejected'|'merged';
  const q = url.searchParams.get('q') ?? '';

  let qCand = locals.supabase
    .from('osm_candidates')
    .select('id,name,lat,lon,tags,match_brand_slug,match_score,blocked_brand,blocked_reason,staging_id,created_at') // <-- lat/lon/tags
    .eq('status', candStatus)
    .order('match_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (q) qCand = qCand.ilike('name', `%${q}%`);

  const { data: candidates } = await qCand;

  return {
    jobs: (jobs ?? []) as JobRow[],
    candidates: (candidates ?? []) as CandidateRow[],
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
      throw redirect(303, `/admin/imports?toast=approve_failed&msg=${encodeURIComponent(rpcErr.message)}`);
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

    const { error: rpcErr } = await locals.supabase
      .rpc('reject_osm_candidate', { p_candidate_id: candidate_id, p_note: note });

    if (rpcErr) {
      throw redirect(303, `/admin/imports?toast=reject_failed&msg=${encodeURIComponent(rpcErr.message)}`);
    }

    throw redirect(303, '/admin/imports?toast=rejected');
  },

  merge: async ({ request, locals }) => {
    if (!locals.userId || !locals.isAdmin) throw error(403, 'Forbidden');

    const fd = await request.formData();
    const candidate_id = String(fd.get('candidate_id') ?? '');
    const brand_slug   = String(fd.get('brand_slug') ?? '');
    const note         = (fd.get('note') as string | null) ?? null;

    if (!candidate_id || !brand_slug) {
      throw redirect(303, '/admin/imports?toast=merge_failed&msg=missing_params');
    }

    const { error: rpcErr } = await locals.supabase.rpc('admin_merge_candidate_to_brand', {
      p_candidate_id: candidate_id,
      p_brand_slug: brand_slug,
      p_note: note
    });

    if (rpcErr) {
      throw redirect(303, `/admin/imports?toast=merge_failed&msg=${encodeURIComponent(rpcErr.message)}`);
    }

    throw redirect(303, '/admin/imports?toast=merged');
  }
};