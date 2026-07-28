import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.isAdmin) {
		return json({ error: 'Admin access required.' }, { status: 403 });
	}

	const { data, error } = await locals.supabase.rpc('admin_brand_enrichment_cron_status');

	if (error) {
		console.error('[enrichment] Cron status', error);
		return json({ error: error.message }, { status: 500 });
	}

	return json(data, {
		headers: {
			'cache-control': 'no-store'
		}
	});
};
