import { redirect, error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.userId) throw redirect(303, '/login');
  if (!locals.isAdmin) throw error(403, 'Forbidden');
  return {};
};
