// src/routes/admin/brands/+page.server.ts
import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
  const { data: pending, error: qErr } = await locals.supabase
    .from('brand_staging')
    .select('id, suggested_name, status, created_at, duplicates')
    .eq('status', 'pending')
    .order('duplicates', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (qErr) { console.error(qErr); throw error(500, 'Failed to load pending brands'); }

  const { data: pendingDelete, error: dErr } = await locals.supabase
    .from('brand_staging')
    .select('id, suggested_name, status, created_at, duplicates, slug')
    .eq('status', 'pending_delete')
    .order('duplicates', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (dErr) { console.error(dErr); throw error(500, 'Failed to load pending delete requests'); }

  const { data: iconless, error: iErr } = await locals.supabase
    .from('brands')
    .select('slug, display, icon_path, created_at')
    .or('icon_path.is.null,icon_path.eq.')
    .order('created_at', { ascending: true });
  if (iErr) { console.error(iErr); throw error(500, 'Failed to load brands needing icons'); }

  return { pending: pending ?? [], pendingDelete: pendingDelete ?? [], iconless: iconless ?? [] };
};

export const actions: Actions = {
  // existing flow: approve a "pending" brand
  verify: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const force_display = (form.get('force_display') as string | null) || undefined;
    if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

    const { data, error } = await locals.supabase.rpc('approve_brand', {
      p_staging_id: id,
      p_force_display: force_display ?? null
    });

    if (error || (data)?.error) {
      const msg = encodeURIComponent((data)?.error ?? error?.message ?? 'Verify failed');
      throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
    }

    const row = Array.isArray(data) ? data[0] : data; // returns table(...)
    const slug = (row)?.brand_slug;
    const display = (row)?.brand_display;

    throw redirect(303, `/admin/brands?toast=verified&slug=${encodeURIComponent(slug)}&display=${encodeURIComponent(display)}`);
  },

  // existing flow: reject a "pending" brand
  reject: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const reason = (form.get('reason') as string | null) || undefined;
    if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

    const { error } = await locals.supabase.rpc('reject_brand', {
      p_staging_id: id,
      p_reason: reason ?? null
    });

    if (error) {
      const msg = encodeURIComponent(error.message ?? 'Reject failed');
      throw redirect(303, `/admin/brands?toast=reject_failed&msg=${msg}`);
    }

    throw redirect(303, '/admin/brands?toast=rejected');
  },

  // NEW: approve a "pending_delete" request
  approveDelete: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const slug = form.get('slug') as string | null;
    if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

    const { error } = await locals.supabase.rpc('approve_brand_delete', {
      p_staging_id: id,
      p_staging_slug: slug
    });

    if (error) {
      const msg = encodeURIComponent(error.message ?? 'Approve delete failed');
      throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
    }

    throw redirect(303, '/admin/brands?toast=verified'); // or a new toast like ?toast=delete_approved
  },

  // NEW: reject a "pending_delete" request (keep brand)
  rejectDelete: async ({ request, locals }) => {
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const reason = (form.get('reason') as string | null) || undefined;
    if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

    const { error } = await locals.supabase.rpc('reject_brand_delete', {
      p_staging_id: id,
      p_reason: reason ?? null
    });

    if (error) {
      const msg = encodeURIComponent(error.message ?? 'Keep brand failed');
      throw redirect(303, `/admin/brands?toast=reject_failed&msg=${msg}`);
    }

    throw redirect(303, '/admin/brands?toast=rejected'); // or ?toast=delete_rejected
  }
};
