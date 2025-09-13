// src/routes/admin/+page.server.ts
import type { PageServerLoad } from './$types';

type Counts = {
  pending_brands: number;
  pending_reports: number;
  pending_icons: number;
  queued_osm_jobs: number;
  pending_candidates: number;
};

export const load: PageServerLoad = async ({ locals }) => {
  const { data: countsRow } = await locals.supabase
    .rpc('admin_counts')
    .single<Counts>();

  const counts: Counts = countsRow ?? {
    pending_brands: 0,
    pending_reports: 0,
    pending_icons: 0,
    queued_osm_jobs: 0,
    pending_candidates: 0
  };

  const [{ data: jobs }, { data: brands }, { data: reports }] = await Promise.all([
    locals.supabase
      .from('osm_import_jobs')
      .select('id,status,source,created_at,note')
      .order('created_at', { ascending: false })
      .limit(8),
    locals.supabase
      .from('brand_staging')
      .select('id,suggested_name,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(6),
    locals.supabase
      .from('reports')
      .select('id,created_at,category,status')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(6)
  ]);

  return {
    counts,
    recent: {
      jobs: jobs ?? [],
      brands: brands ?? [],
      reports: reports ?? []
    }
  };
};
