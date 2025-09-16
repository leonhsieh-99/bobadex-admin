import type { RequestHandler } from './$types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const POST: RequestHandler = async ({ request, locals }) => {
  const { slug } = (await request.json()) as { slug?: string };
  if (!slug) return json({ error: 'missing slug' }, 400);

  // find brand display
  const { data: brand, error: bErr } = await locals.supabase
    .from('brands')
    .select('slug, display')
    .eq('slug', slug)
    .maybeSingle();

  if (bErr) return json({ error: bErr.message }, 400);
  if (!brand) return json({ error: 'brand not found' }, 404);

  // create a staging row for pending_delete
  const { data, error: sErr } = await locals.supabase
    .from('brand_staging')
    .insert({
      suggested_name: brand.display,
      slug: brand.slug,
      status: 'pending_delete',
    })
    .select('id')
    .single();

  if (sErr) return json({ error: sErr.message }, 400);

  return json({ id: data.id, status: 'pending_delete' });
};
