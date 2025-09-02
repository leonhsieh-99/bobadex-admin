import { redirect } from '@sveltejs/kit';

export const load = async ({ cookies }) => {
  cookies.delete('sb', { path: '/' });
  throw redirect(302, '/login');
};
