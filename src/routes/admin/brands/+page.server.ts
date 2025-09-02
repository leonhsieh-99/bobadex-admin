// src/routes/admin/brands/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { supabaseFromCookies } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ cookies }) => {
  const sb = supabaseFromCookies(cookies);

  const { data, error } = await sb
    .from('brand_staging')
    .select('id, suggested_name, slug, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw fail(500, { message: 'Failed to load pending brands' });
  return { pending: data ?? [] };
};

export const actions: Actions = {
  verify: async ({ request, cookies }) => {
    const sb = supabaseFromCookies(cookies);
    const form = await request.formData();
    const id = Number(form.get('id'));
    const force_slug = (form.get('force_slug') as string) || undefined;
    const generate_icon = form.get('generate_icon') === 'on';

    if (!id) return fail(400, { message: 'Missing id' });

    const { data, error } = await sb.functions.invoke('verify-brand', {
      body: { id, force_slug, generate_icon }
    });

    if (error || data?.error) {
      return fail(400, { message: data?.error ?? error?.message ?? 'Verify failed' });
    }
    throw redirect(303, '/admin/brands');
  },

  reject: async ({ request, cookies }) => {
    const sb = supabaseFromCookies(cookies);
    const form = await request.formData();
    const id = Number(form.get('id'));
    const reason = (form.get('reason') as string) || undefined;

    if (!id) return fail(400, { message: 'Missing id' });

    const { data, error } = await sb.functions.invoke('reject-brand', {
      body: { id, reason }
    });

    if (error || data?.error) {
      return fail(400, { message: data?.error ?? error?.message ?? 'Reject failed' });
    }
    throw redirect(303, '/admin/brands');
  }
};
