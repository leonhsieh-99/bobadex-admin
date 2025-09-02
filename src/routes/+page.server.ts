import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // not logged in → show login
  if (!locals.userId) throw redirect(302, '/login');
  // logged in but not admin → you can decide (maybe 403 page)
  if (!locals.isAdmin) throw redirect(302, '/login');
  // admin → go to dashboard
  throw redirect(302, '/admin');
};
