// src/routes/whoami/+page.server.ts
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, cookies }) => {
  return {
    who: {
      userId: locals.userId,
      isAdmin: locals.isAdmin,
      hasTokenCookie: !!cookies.get('sb')
    }
  };
};
