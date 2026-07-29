import { previewBrandMerge } from '$lib/server/brand-merge.server';
import type { RequestHandler } from './$types';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.isAdmin) return json({ error: 'Admin access required.' }, 403);

	const sourceSlug = (url.searchParams.get('source') ?? '').trim();
	const targetSlug = (url.searchParams.get('target') ?? '').trim();
	if (!sourceSlug || !targetSlug) return json({ error: 'Source and target are required.' }, 400);

	try {
		return json(await previewBrandMerge(locals, sourceSlug, targetSlug));
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not preview this merge.' },
			400
		);
	}
};
