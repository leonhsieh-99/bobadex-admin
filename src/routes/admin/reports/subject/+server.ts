// src/routes/admin/reports/subject/+server.ts
import type { RequestHandler } from './$types';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const type = url.searchParams.get('p_content_type');
  const id   = url.searchParams.get('p_content_id');

  if (!type || !id) return json({ error: 'missing params' }, 400);

  // IMAGE SUBJECT
  if (type === 'photo') {
    const { data: media, error: mediaErr } = await locals.sb
      .from('shop_media')
      .select('id,image_path,user_id')
      .eq('id', id)
      .maybeSingle();

    if (mediaErr) return json({ error: mediaErr.message }, 400);
    if (!media)   return json(null, 404);

    let uploader:
      | { id: string; name?: string | null; email?: string | null; avatar_url?: string | null }
      | undefined;

    if (media.user_id) {
      const { data: prof, error: profErr } = await locals.sb
        .rpc('admin_get_profile', { p_user_id: media.user_id })
        .maybeSingle();

      if (profErr) {
        console.error('admin_get_profile error:', profErr);
      }

      uploader = prof
        ? {
            id: prof.id,
            name: prof.display_name ?? null,
            email: prof.email ?? null,
            avatar_url: prof.avatar_url ?? null
          }
        : { id: media.user_id, name: null, email: null, avatar_url: null };
    }

    return json({
      type: 'image' as const,
      id: media.id as string,
      user_id: media.user_id as string | null,
      bucket: 'media-uploads',
      path: media.image_path as string,
      uploader
    });
  }

  // USER SUBJECT
  if (type === 'user') {
    const { data, error } = await locals.sb
      .rpc('admin_get_profile', { p_user_id: id })
      .maybeSingle();

    if (error) return json({ error: error.message }, 400);
    if (!data)  return json(null, 404);

    return json({
      type: 'user' as const,
      id: data.id,
      email: data.email,
      name: data.display_name,
      avatar_url: data.avatar_url
    });
  }

  return json({ error: 'unsupported type' }, 400);
};
