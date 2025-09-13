// src/routes/admin/reports/subject/+server.ts
import type { RequestHandler } from './$types';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

type MediaRow = {
  id: string;
  image_path: string;
  user_id: string | null;
};

type AdminProfile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  email: string | null;
  profile_image_path: string | null;
};

type Uploader = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  email: string | null;
  profile_image_path: string | null;
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const type = url.searchParams.get('p_content_type');
  const id   = url.searchParams.get('p_content_id');

  if (!type || !id) return json({ error: 'missing params' }, 400);

  // IMAGE SUBJECT
  if (type === 'image' || type === 'photo') {
    console.log(id);
    const { data: media, error: mediaErr } = await locals.supabase
      .from('shop_media')
      .select('id,image_path,user_id')
      .eq('id', id)
      .maybeSingle<MediaRow>();
    console.log(media);

    if (mediaErr) return json({ error: mediaErr.message }, 400);
    if (!media)   return json(null, 404);

    let uploader: Uploader | undefined;
    if (media.user_id) {
      const { data: profRows, error: profErr } = await locals.supabase
        .rpc('admin_get_profile', { p_user_id: media.user_id })
        .returns<AdminProfile[]>();

      if (profErr) console.error('admin_get_profile error:', profErr);

      const prof = Array.isArray(profRows) ? profRows[0] ?? null : null;

      uploader = prof
        ? {
            id: prof.id,
            username: prof.username ?? null,
            display_name: prof.display_name ?? null,
            email: prof.email ?? null,
            bio: prof.bio ?? null,
            profile_image_path: prof.profile_image_path ?? null
          }
        : {
            id: media.user_id,
            username: null,
            display_name: null,
            email: null,
            bio: null,
            profile_image_path: null
          };
    }

    return json({
      type: 'image' as const,
      id: media.id,
      user_id: media.user_id,
      bucket: 'media-uploads',
      path: media.image_path,
      uploader
    });
  }

  // USER SUBJECT
  if (type === 'user') {
    const { data: rows, error } = await locals.supabase
      .rpc('admin_get_profile', { p_user_id: id })
      .returns<AdminProfile[]>();


    if (error) return json({ error: error.message }, 400);

    const one = Array.isArray(rows) ? rows[0] ?? null : null;

    if (!one) return json(null, 404);

    return json({
      type: 'user' as const,
      id: one.id,
      username: one.username,
      name: one.display_name,
      profile_image_path: one.profile_image_path,
      bio: one.bio,
      email: one.email
    });
  }

  return json({ error: 'unsupported type' }, 400);
};
