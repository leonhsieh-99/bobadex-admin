import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const { data: jobs } = await locals.sb
    .from('osm_import_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  return { jobs: jobs ?? [] };
};

export const actions: Actions = {
  queue: async ({ request, locals }) => {
    const form = await request.formData();
    const raw = form.get('params') as string;
    const note = (form.get('note') as string) || null;

    let obj;
    try { obj = JSON.parse(raw); } catch { return { ok: false, message: 'Invalid JSON' }; }

    const { error } = await locals.sb.rpc('osm_jobs_enqueue', {
      p_source: JSON.stringify(obj),
      p_note: note
    });

    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }
};
