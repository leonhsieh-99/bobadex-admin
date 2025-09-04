// src/routes/admin/brands/+page.server.ts
import type { PageServerLoad, Actions } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { supabaseFromCookies } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ cookies }) => {
  const sb = supabaseFromCookies(cookies);
  const { data, error: qErr } = await sb
    .from('brand_staging')
    .select('id, suggested_name, status, created_at, duplicates')
    .eq('status', 'pending')
    .order('duplicates', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (qErr) {
    console.error('brand_staging query error:', qErr);
    throw error(500, 'Failed to load pending brands');
  }

  return { pending: data ?? [] };
};

// src/routes/admin/brands/+page.server.ts
export const actions: Actions = {
  verify: async ({ request, cookies }) => {
    const sb = supabaseFromCookies(cookies);
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const force_slug = (form.get('force_slug') as string | null) || undefined;

    if (!id) throw redirect(303, '/admin/brands?toast=verify_failed&msg=missing_id');

    const { data, error } = await sb.functions.invoke('verify-brand', {
      body: { id, force_slug } // no generate_icon
    });

    if (error || (data)?.error) {
      const msg = encodeURIComponent((data)?.error ?? error?.message ?? 'Verify failed');
      throw redirect(303, `/admin/brands?toast=verify_failed&msg=${msg}`);
    }

    throw redirect(303, '/admin/brands?toast=verified');
  },

  reject: async ({ request, cookies }) => {
    const sb = supabaseFromCookies(cookies);
    const form = await request.formData();
    const id = form.get('id') as string | null;
    const reason = (form.get('reason') as string | null) || undefined;

    if (!id) throw redirect(303, '/admin/brands?toast=reject_failed&msg=missing_id');

    const accessToken = cookies.get('sb') ?? null;

    const { data, error } = await sb.functions.invoke('reject-brand', {
      body: { id, reason },
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
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

