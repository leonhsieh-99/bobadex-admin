import type { RequestHandler } from './$types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const GET: RequestHandler = async ({ url, locals }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json([]);

  // Search by display and slug; keep it fast & simple for typeahead
  const { data: brands, error } = await locals.supabase
    .from('brands')
    .select('slug, display')
    .or(`display.ilike.%${q}%,slug.ilike.%${q}%`)
    .order('display', { ascending: true })
    .limit(20);

  if (error) return json({ error: error.message }, 500);
  return json(brands ?? []);
};
