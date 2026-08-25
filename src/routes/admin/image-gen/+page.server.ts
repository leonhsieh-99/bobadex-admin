import { error, fail } from '@sveltejs/kit';
import { supabaseAdmin } from '$lib/supabase.server';
import type { Actions, PageServerLoad } from './$types';

type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
type PublishMode = 'auto' | 'review' | 'force';
type ImageView = 'ready' | 'generated' | 'review' | 'history';

const MAX_REGENERATION_BATCH = 5;

type BrandRow = {
	slug: string;
	display: string;
	icon_path: string | null;
	created_at: string;
};

type DossierRow = {
	brand_slug: string;
	approval_status: string;
	updated_at: string;
};

type CandidateRow = {
	id: string;
	brand_slug: string;
	status: string;
	creative_mode: string;
	quality: string;
	quality_score: number;
	model: string;
	concept: Record<string, unknown>;
	storage_bucket: string;
	storage_path: string | null;
	error_text: string | null;
	created_at: string;
	updated_at: string;
	publication_strategy: string;
	processed_storage_path: string | null;
	published_storage_path: string | null;
	previous_icon_path: string | null;
	published_at: string | null;
};

function formValue(form: FormData, key: string) {
	return String(form.get(key) ?? '').trim();
}

function cleanSearch(value: string | null) {
	return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function isQuality(value: string): value is ImageQuality {
	return ['auto', 'low', 'medium', 'high'].includes(value);
}

function isPublishMode(value: string): value is PublishMode {
	return ['auto', 'review', 'force'].includes(value);
}

async function functionErrorMessage(error: unknown) {
	if (error && typeof error === 'object' && 'context' in error) {
		const context = (error as { context?: unknown }).context;
		if (context instanceof Response) {
			try {
				const payload = (await context.clone().json()) as { error?: unknown; message?: unknown };
				if (typeof payload.error === 'string' && payload.error) return payload.error;
				if (typeof payload.message === 'string' && payload.message) return payload.message;
			} catch {
				// Fall back to the client error when the function did not return JSON.
			}
		}
	}
	return error instanceof Error && error.message
		? error.message
		: 'The image generation worker rejected the request.';
}

async function storageReadiness() {
	const { data, error: bucketError } = await supabaseAdmin().storage.getBucket('shop-media');
	return {
		ready: Boolean(data && !bucketError),
		isPublic: data?.public === true,
		error: bucketError?.message ?? null
	};
}

function publicStorageUrl(bucket: string, path: string | null) {
	if (!path) return null;
	return supabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function publicStorageThumbnailUrl(bucket: string, path: string | null, size = 128) {
	if (!path) return null;
	return supabaseAdmin()
		.storage.from(bucket)
		.getPublicUrl(path, {
			transform: {
				width: size,
				height: size,
				resize: 'contain',
				quality: 45
			}
		}).data.publicUrl;
}

function candidatePreviewPath(candidate: CandidateRow) {
	return (
		candidate.published_storage_path ?? candidate.processed_storage_path ?? candidate.storage_path
	);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.isAdmin) throw error(403, 'Admin access required.');

	const requestedView = url.searchParams.get('view');
	const view: ImageView =
		requestedView === 'generated' || requestedView === 'review' || requestedView === 'history'
			? requestedView
			: 'ready';
	const q = cleanSearch(url.searchParams.get('q')).toLowerCase();
	const admin = supabaseAdmin();
	const [brandsResult, dossiersResult, candidatesResult, storage] = await Promise.all([
		admin
			.from('brands')
			.select('slug,display,icon_path,created_at')
			.eq('status', 'active')
			.eq('is_demo', false)
			.order('display'),
		admin.schema('mod').from('brand_dossiers').select('brand_slug,approval_status,updated_at'),
		admin
			.schema('mod')
			.from('brand_icon_candidates')
			.select(
				'id,brand_slug,status,creative_mode,quality,quality_score,model,concept,storage_bucket,storage_path,error_text,created_at,updated_at,publication_strategy,processed_storage_path,published_storage_path,previous_icon_path,published_at'
			)
			.order('updated_at', { ascending: false })
			.limit(500),
		storageReadiness()
	]);

	if (brandsResult.error) {
		console.error('[image gen] brands', brandsResult.error);
		throw error(500, `Could not load brands: ${brandsResult.error.message}`);
	}
	if (dossiersResult.error) {
		console.error('[image gen] dossiers', dossiersResult.error);
		throw error(500, `Could not load enrichment readiness: ${dossiersResult.error.message}`);
	}
	if (candidatesResult.error) {
		console.error('[image gen] candidates', candidatesResult.error);
		throw error(500, `Could not load image candidates: ${candidatesResult.error.message}`);
	}

	const brands = (brandsResult.data ?? []) as BrandRow[];
	const dossiers = (dossiersResult.data ?? []) as DossierRow[];
	const candidates = (candidatesResult.data ?? []) as CandidateRow[];
	const dossierByBrand = new Map(dossiers.map((dossier) => [dossier.brand_slug, dossier]));
	const latestCandidateByBrand = new Map<string, CandidateRow>();
	for (const candidate of candidates) {
		if (!latestCandidateByBrand.has(candidate.brand_slug)) {
			latestCandidateByBrand.set(candidate.brand_slug, candidate);
		}
	}
	const brandBySlug = new Map(brands.map((brand) => [brand.slug, brand]));
	const enrichedBrands = brands.map((brand) => {
		const dossier = dossierByBrand.get(brand.slug);
		const latestCandidate = latestCandidateByBrand.get(brand.slug);
		return {
			...brand,
			dossier_status: dossier?.approval_status ?? null,
			dossier_updated_at: dossier?.updated_at ?? null,
			latest_candidate_status: latestCandidate?.status ?? null,
			latest_candidate_url:
				storage.ready && storage.isPublic && latestCandidate
					? publicStorageUrl(
							latestCandidate.storage_bucket || 'shop-media',
							candidatePreviewPath(latestCandidate)
						)
					: null,
			latest_candidate_thumbnail_url:
				storage.ready && storage.isPublic && latestCandidate
					? publicStorageThumbnailUrl(
							latestCandidate.storage_bucket || 'shop-media',
							candidatePreviewPath(latestCandidate),
							96
						)
					: null,
			icon_url:
				storage.ready && storage.isPublic ? publicStorageUrl('shop-media', brand.icon_path) : null,
			icon_thumbnail_url:
				storage.ready && storage.isPublic
					? publicStorageThumbnailUrl('shop-media', brand.icon_path)
					: null
		};
	});
	const filteredBrands = q
		? enrichedBrands.filter(
				(brand) => brand.display.toLowerCase().includes(q) || brand.slug.toLowerCase().includes(q)
			)
		: enrichedBrands;
	const iconless = filteredBrands
		.filter((brand) => !brand.icon_path?.trim())
		.sort((a, b) => {
			const aReady = a.dossier_status === 'approved' ? 1 : 0;
			const bReady = b.dossier_status === 'approved' ? 1 : 0;
			return bReady - aReady || a.display.localeCompare(b.display);
		});
	const generatedBrands = filteredBrands
		.filter((brand) => Boolean(brand.icon_path?.trim()))
		.sort((a, b) => a.display.localeCompare(b.display));
	const decoratedCandidates = candidates.map((candidate) => {
		const brand = brandBySlug.get(candidate.brand_slug);
		const previewPath = candidatePreviewPath(candidate);
		return {
			...candidate,
			brand_display: brand?.display ?? candidate.brand_slug,
			current_icon_path: brand?.icon_path ?? null,
			preview_url:
				storage.ready && storage.isPublic
					? publicStorageUrl(candidate.storage_bucket || 'shop-media', previewPath)
					: null,
			thumbnail_url:
				storage.ready && storage.isPublic
					? publicStorageThumbnailUrl(candidate.storage_bucket || 'shop-media', previewPath, 192)
					: null,
			current_icon_url:
				storage.ready && storage.isPublic
					? publicStorageUrl('shop-media', brand?.icon_path ?? null)
					: null
		};
	});
	const visibleCandidates = q
		? decoratedCandidates.filter(
				(candidate) =>
					candidate.brand_display.toLowerCase().includes(q) ||
					candidate.brand_slug.toLowerCase().includes(q)
			)
		: decoratedCandidates;
	const reviewCandidates = visibleCandidates.filter((candidate) =>
		['generating', 'generated', 'processing', 'failed'].includes(candidate.status)
	);
	const historyCandidates = visibleCandidates.filter((candidate) =>
		['approved', 'published', 'rejected', 'superseded'].includes(candidate.status)
	);
	const statusCounts: Record<string, number> = {};
	for (const candidate of candidates) {
		statusCounts[candidate.status] = (statusCounts[candidate.status] ?? 0) + 1;
	}

	return {
		view,
		q: cleanSearch(url.searchParams.get('q')),
		storage,
		metrics: {
			eligible: brands.length,
			iconless: enrichedBrands.filter((brand) => !brand.icon_path?.trim()).length,
			ready: enrichedBrands.filter(
				(brand) => !brand.icon_path?.trim() && brand.dossier_status === 'approved'
			).length,
			review: statusCounts.generated ?? 0,
			active: (statusCounts.generating ?? 0) + (statusCounts.processing ?? 0),
			failed: statusCounts.failed ?? 0,
			published: statusCounts.published ?? 0
		},
		brands: filteredBrands,
		iconless,
		generatedBrands,
		reviewCandidates,
		historyCandidates
	};
};

export const actions: Actions = {
	generateIcon: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { ok: false, action: 'generateIcon', message: 'Admin access required.' });
		}
		const form = await request.formData();
		const slug = formValue(form, 'brand_slug');
		const quality = formValue(form, 'quality') || 'auto';
		const publishMode = formValue(form, 'publish_mode') || 'auto';
		const direction = formValue(form, 'direction');
		const confirmReplace = formValue(form, 'confirm_replace_existing') === 'true';
		if (!slug || !isQuality(quality) || !isPublishMode(publishMode)) {
			return fail(400, {
				ok: false,
				action: 'generateIcon',
				message: 'Select a brand, quality, and publication mode.'
			});
		}
		if (publishMode === 'force' && !confirmReplace) {
			return fail(400, {
				ok: false,
				action: 'generateIcon',
				message: 'Confirm immediate replacement before using force mode.'
			});
		}
		const storage = await storageReadiness();
		if (!storage.ready || !storage.isPublic) {
			return fail(503, {
				ok: false,
				action: 'generateIcon',
				message:
					'The public shop-media Storage bucket is not configured. No generation was started.'
			});
		}

		const { data, error: queueError } = await locals.supabase.rpc(
			'admin_queue_brand_icon_generation',
			{
				p_brand_slug: slug,
				p_quality: quality,
				p_publish_mode: publishMode,
				p_direction: direction || null,
				p_confirm_replace_existing: confirmReplace
			}
		);
		if (queueError) {
			console.error('[image gen] generateIcon queue', queueError);
			const message = queueError.message || 'The mascot generation request could not be queued.';
			return fail(400, { ok: false, action: 'generateIcon', message });
		}

		return {
			ok: true,
			action: 'generateIcon',
			data,
			message: `Queued mascot generation for ${slug}. You can leave this page while it runs.`
		};
	},

	publishCandidate: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'publishCandidate',
				message: 'Admin access required.'
			});
		}
		const form = await request.formData();
		const candidateId = formValue(form, 'candidate_id');
		if (!candidateId) {
			return fail(400, {
				ok: false,
				action: 'publishCandidate',
				message: 'A candidate is required.'
			});
		}
		const storage = await storageReadiness();
		if (!storage.ready || !storage.isPublic) {
			return fail(503, {
				ok: false,
				action: 'publishCandidate',
				message: 'The public shop-media Storage bucket is not configured.'
			});
		}

		const { data, error: invokeError } = await locals.supabase.functions.invoke(
			'publish-brand-icon',
			{ body: { candidate_id: candidateId } }
		);
		const responseError =
			data && typeof data === 'object' && 'error' in data && data.error ? String(data.error) : null;
		if (invokeError || responseError) {
			const message = responseError ?? (await functionErrorMessage(invokeError));
			console.error('[image gen] publishCandidate', invokeError ?? data);
			return fail(400, { ok: false, action: 'publishCandidate', message });
		}
		return {
			ok: true,
			action: 'publishCandidate',
			data,
			message: 'Published the reviewed brand icon.'
		};
	},

	generateBatch: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, { ok: false, action: 'generateBatch', message: 'Admin access required.' });
		}
		const form = await request.formData();
		const count = Number.parseInt(formValue(form, 'count'), 10);
		if (!Number.isInteger(count) || count < 1 || count > 5) {
			return fail(400, {
				ok: false,
				action: 'generateBatch',
				message: 'Batch size must be from 1 to 5.'
			});
		}
		const storage = await storageReadiness();
		if (!storage.ready || !storage.isPublic) {
			return fail(503, {
				ok: false,
				action: 'generateBatch',
				message:
					'The public shop-media Storage bucket is not configured. No generation was started.'
			});
		}

		const admin = supabaseAdmin();
		const [dossierResult, brandResult] = await Promise.all([
			admin
				.schema('mod')
				.from('brand_dossiers')
				.select('brand_slug')
				.eq('approval_status', 'approved'),
			admin
				.from('brands')
				.select('slug,created_at')
				.eq('status', 'active')
				.eq('is_demo', false)
				.or('icon_path.is.null,icon_path.eq.')
				.order('created_at')
		]);
		const { data: dossiers, error: dossierError } = dossierResult;
		if (dossierError) {
			return fail(400, { ok: false, action: 'generateBatch', message: dossierError.message });
		}
		if (brandResult.error) {
			return fail(400, { ok: false, action: 'generateBatch', message: brandResult.error.message });
		}
		const approvedSlugs = new Set((dossiers ?? []).map((dossier) => dossier.brand_slug));
		const brands = (brandResult.data ?? [])
			.filter((brand) => approvedSlugs.has(brand.slug))
			.slice(0, count);
		if (!brands.length) {
			return fail(409, {
				ok: false,
				action: 'generateBatch',
				message: 'No approved enriched brands are ready for image generation.'
			});
		}

		const outcomes: Array<{ slug: string; ok: boolean; message?: string }> = [];
		for (const brand of brands) {
			const { data, error: invokeError } = await locals.supabase.functions.invoke(
				'generate-brand-icon',
				{
					body: { brand_slug: brand.slug, quality: 'auto', publish_mode: 'auto' }
				}
			);
			const responseError =
				data && typeof data === 'object' && 'error' in data && data.error
					? String(data.error)
					: null;
			outcomes.push({
				slug: brand.slug,
				ok: !invokeError && !responseError,
				message:
					responseError ?? (invokeError ? await functionErrorMessage(invokeError) : undefined)
			});
		}
		const succeeded = outcomes.filter((outcome) => outcome.ok).length;
		const failed = outcomes.length - succeeded;
		const result = {
			ok: failed === 0,
			action: 'generateBatch',
			data: outcomes,
			message: `Generated ${succeeded} icon${succeeded === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.`
		};
		return failed ? fail(400, result) : result;
	},

	regenerateSelected: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'regenerateSelected',
				message: 'Admin access required.'
			});
		}
		const form = await request.formData();
		const slugs = [
			...new Set(
				form
					.getAll('brand_slugs')
					.map((value) => String(value).trim())
					.filter(Boolean)
			)
		];
		const quality = formValue(form, 'quality') || 'auto';
		const direction = formValue(form, 'direction');
		if (!slugs.length || slugs.length > MAX_REGENERATION_BATCH || !isQuality(quality)) {
			return fail(400, {
				ok: false,
				action: 'regenerateSelected',
				message: `Select between 1 and ${MAX_REGENERATION_BATCH} brands and a valid quality.`
			});
		}

		const storage = await storageReadiness();
		if (!storage.ready || !storage.isPublic) {
			return fail(503, {
				ok: false,
				action: 'regenerateSelected',
				message: 'The public shop-media Storage bucket is not configured.'
			});
		}

		const { data: brands, error: brandsError } = await supabaseAdmin()
			.from('brands')
			.select('slug,display,icon_path')
			.in('slug', slugs)
			.eq('status', 'active')
			.eq('is_demo', false);
		if (brandsError) {
			return fail(400, {
				ok: false,
				action: 'regenerateSelected',
				message: brandsError.message
			});
		}
		if (
			(brands ?? []).length !== slugs.length ||
			brands?.some((brand) => !brand.icon_path?.trim())
		) {
			return fail(409, {
				ok: false,
				action: 'regenerateSelected',
				message: 'Every selected brand must be active and already have a live icon.'
			});
		}

		const brandBySlug = new Map((brands ?? []).map((brand) => [brand.slug, brand]));
		const outcomes: Array<{
			slug: string;
			display: string;
			ok: boolean;
			candidate_id?: string;
			message?: string;
		}> = await Promise.all(
			slugs.map(async (slug) => {
				const { data, error: invokeError } = await locals.supabase.functions.invoke(
					'generate-brand-icon',
					{
						body: {
							brand_slug: slug,
							quality,
							publish_mode: 'review',
							direction: direction || undefined
						}
					}
				);
				const responseError =
					data && typeof data === 'object' && 'error' in data && data.error
						? String(data.error)
						: null;
				const candidateId =
					data && typeof data === 'object' && 'candidate_id' in data
						? String(data.candidate_id ?? '')
						: '';
				return {
					slug,
					display: brandBySlug.get(slug)?.display ?? slug,
					ok: !invokeError && !responseError && Boolean(candidateId),
					candidate_id: candidateId || undefined,
					message:
						responseError ?? (invokeError ? await functionErrorMessage(invokeError) : undefined)
				};
			})
		);

		const succeeded = outcomes.filter((outcome) => outcome.ok).length;
		const failed = outcomes.length - succeeded;
		const result = {
			ok: failed === 0,
			action: 'regenerateSelected',
			outcomes,
			candidateIds: outcomes.flatMap((outcome) =>
				outcome.ok && outcome.candidate_id ? [outcome.candidate_id] : []
			),
			message: `Generated ${succeeded} replacement${succeeded === 1 ? '' : 's'} for review${failed ? `; ${failed} failed` : ''}.`
		};
		return succeeded === 0 ? fail(400, result) : result;
	},

	rejectCandidate: async ({ request, locals }) => {
		if (!locals.isAdmin) {
			return fail(403, {
				ok: false,
				action: 'rejectCandidate',
				message: 'Admin access required.'
			});
		}
		const form = await request.formData();
		const candidateId = formValue(form, 'candidate_id');
		if (!candidateId) {
			return fail(400, {
				ok: false,
				action: 'rejectCandidate',
				message: 'A candidate is required.'
			});
		}

		const now = new Date().toISOString();
		const { data: candidate, error: rejectError } = await supabaseAdmin()
			.schema('mod')
			.from('brand_icon_candidates')
			.update({ status: 'rejected', rejected_at: now, updated_at: now })
			.eq('id', candidateId)
			.eq('status', 'generated')
			.select('id')
			.maybeSingle();
		if (rejectError) {
			return fail(400, {
				ok: false,
				action: 'rejectCandidate',
				message: rejectError.message
			});
		}
		if (!candidate) {
			return fail(409, {
				ok: false,
				action: 'rejectCandidate',
				message: 'This draft is no longer available for review.'
			});
		}

		return {
			ok: true,
			action: 'rejectCandidate',
			candidateId,
			message: 'Kept the current icon and rejected the regenerated draft.'
		};
	}
};
