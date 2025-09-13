import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  console.log('[ping] GET');
  return new Response('pong', { status: 200 });
};

export const POST: RequestHandler = async ({ request }) => {
  console.log('[ping] POST');
  const form = await request.formData().catch(() => null);
  console.log('[ping] POST form', form ? Object.fromEntries(form) : '(no form)');
  return new Response('ok', { status: 200 });
};
