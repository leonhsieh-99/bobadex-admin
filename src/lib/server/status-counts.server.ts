import type { SupabaseClient } from '@supabase/supabase-js';

type CountClient = Pick<SupabaseClient, 'from' | 'schema'>;

function table(client: CountClient, schema: string | undefined, name: string) {
	return schema ? client.schema(schema).from(name) : client.from(name);
}

export async function countExact(
	client: CountClient,
	name: string,
	schema?: string
) {
	const { count, error } = await table(client, schema, name).select('*', {
		count: 'exact',
		head: true
	});
	return { count: count ?? 0, error };
}

export async function countByValues(
	client: CountClient,
	name: string,
	column: string,
	values: readonly string[],
	schema?: string
) {
	const results = await Promise.all(
		values.map(async (value) => {
			const { count, error } = await table(client, schema, name)
				.select('*', { count: 'exact', head: true })
				.eq(column, value);
			return { value, count: count ?? 0, error };
		})
	);
	const counts: Record<string, number> = {};
	for (const row of results) counts[row.value] = row.count;
	return {
		counts,
		error: results.find((row) => row.error)?.error ?? null
	};
}
