import { json, redirect } from '@sveltejs/kit';

export async function POST({ request, locals }) {
  const form = await request.formData();
  const region_key = (form.get('region_key') as string | null) ?? null;
  const raw = (form.get('params') as string | null) ?? null;

  if (!region_key) return json({ ok: false, error: 'Missing region_key' }, { status: 400 });
  if (!raw) return json({ ok: false, error: 'Missing params' }, { status: 400 });

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // UI sends legacy `{ bbox:[south,west,north,east], ... }`.
  const bbox = (obj as any)?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return json(
      { ok: false, error: 'params must include bbox:[south,west,north,east]' },
      { status: 400 }
    );
  }

  const [south, west, north, east] = bbox;
  if (
    typeof south !== 'number' ||
    typeof west !== 'number' ||
    typeof north !== 'number' ||
    typeof east !== 'number'
  ) {
    return json(
      { ok: false, error: 'bbox values must be numbers' },
      { status: 400 }
    );
  }

  const authHeader = request.headers.get('authorization');

  const { data, error } = await locals.supabase.functions.invoke(
    'run-osm-import-region',
    {
      body: {
        query_type: 'bbox',
        query_params: {
          south,
          west,
          north,
          east
        },
        region_key,
        source: 'osm',
      },
      headers: authHeader ? { Authorization: authHeader } : undefined,
    }
  );

  if (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  const jobId = (data as any)?.job_id as string | undefined;
  if (!jobId) return json({ ok: false, error: 'Missing job_id from edge function' }, { status: 500 });
  return redirect(303, `/admin/imports?toast=queued&id=${jobId}`);
}