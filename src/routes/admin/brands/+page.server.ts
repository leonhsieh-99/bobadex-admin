// src/routes/admin/brands/+page.server.ts
import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
  // pending approvals
  const { data: pending, error: qErr } = await locals.supabase
    .from('brand_staging')
    .select('id, suggested_name, status, created_at, duplicates')
    .eq('status', 'pending')
    .order('duplicates', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (qErr) {
    console.error('brand_staging query error:', qErr);
    throw error(500, 'Failed to load pending brands');
  }

  // brands needing icons
  const { data: iconless, error: iErr } = await locals.supabase
    .from('brands')
    .select('slug, display, icon_path, created_at')
    .or('icon_path.is.null,icon_path.eq.')
    .order('created_at', { ascending: true });

  if (iErr) {
    console.error('brands query error:', iErr);
    throw error(500, 'Failed to load brands needing icons');
  }

  return { pending: pending ?? [], iconless: iconless ?? [] };
};

export const actions: Actions = {
  verify: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const force_display = (form.get('force_display') as string | null) || undefined;

    if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

    const { data, error } = await locals.supabase.functions.invoke('verify-brand', {
      body: { id, force_display }
    });

    if (error || (data)?.error) {
      const msg = encodeURIComponent((data)?.error ?? error?.message ?? 'Verify failed');
      throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
    }

    const slug = (data).slug;
    const display = (data).display;


    throw redirect(
      303,
      `/admin/brands?toast=verified&slug=${encodeURIComponent(slug)}&display=${encodeURIComponent(display)}`
    );
  },

  reject: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const reason = (form.get('reason') as string | null) || undefined;

    if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

    const { data, error } = await locals.supabase.functions.invoke('reject-brand', {
      body: { id, reason }
    });

    if (error || (data)?.error) {
      console.error('reject-brand error:', {
        status: (error)?.context?.response?.status,
        message: error?.message,
        data
      });
      const msg = encodeURIComponent((data)?.error ?? error?.message ?? 'Reject failed');
      throw redirect(303, `/admin/brands?toast=reject_failed&msg=${msg}`);
    }

    throw redirect(303, '/admin/brands?toast=rejected');
  }
};
