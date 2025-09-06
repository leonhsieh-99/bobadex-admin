// src/routes/admin/reports/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { supabaseAdmin } from '$lib/supabase.server';

export const load: PageServerLoad = async ({ locals }) => {
  const { data, error } = await locals.sb
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return { reports: data ?? [] };
};

export const actions: Actions = {
  resolve: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get('id') || '');
    const status = form.get('status') as 'accepted' | 'rejected' | 'dismissed';
    const note = (form.get('note') as string) || null;

    const { error } = await locals.sb.rpc('resolve_report', {
      p_report_id: id,
      p_status: status,
      p_note: note
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  },

  deleteImage: async ({ request, locals }) => {
    const form = await request.formData();
    const mediaId = String(form.get('media_id') || '');
    const reportId = (form.get('report_id') as string) || null;
    const note = (form.get('note') as string) || null;

    // DB delete + audit; returns [{ bucket, path }]
    const { data, error } = await locals.sb.rpc('admin_delete_image', {
      p_media_id: mediaId,
      p_report_id: reportId,
      p_note: note
    });
    if (error) return { ok: false, message: error.message };

    // Remove object(s) from Storage using SERVICE ROLE
    const admin = supabaseAdmin();
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      if (it?.bucket && it?.path) {
        await admin.storage.from(it.bucket).remove([it.path]);
      }
    }
    return { ok: true };
  },

  banUser: async ({ request, locals }) => {
    const form = await request.formData();
    const userId = String(form.get('user_id') || '');
    const reportId = (form.get('report_id') as string) || null;
    const reason = (form.get('reason') as string) || 'policy violation';

    // App-level ban in your DB (RLS-protected RPC)
    const { data: ok, error: e1 } = await locals.sb.rpc('admin_ban_user', {
      p_user_id: userId,
      p_reason: reason
    });
    if (e1 || !ok) return { ok: false, message: e1?.message ?? 'ban failed' };

    // Optionally flag in auth app_metadata (SERVICE ROLE)
    const admin = supabaseAdmin();
    await admin.auth.admin.updateUserById(userId, { app_metadata: { banned: true } });

    if (reportId) {
      await locals.sb.rpc('resolve_report', {
        p_report_id: reportId,
        p_status: 'accepted',
        p_note: 'user banned'
      });
    }
    return { ok: true };
  },

  unbanUser: async ({ request, locals }) => {
    const form = await request.formData();
    const userId = String(form.get('user_id') || '');

    const { data: ok, error: e1 } = await locals.sb.rpc('admin_unban_user', { p_user_id: userId });
    if (e1 || !ok) return { ok: false, message: e1?.message ?? 'unban failed' };

    const admin = supabaseAdmin();
    await admin.auth.admin.updateUserById(userId, { app_metadata: { banned: false } });

    return { ok: true };
  }
};
