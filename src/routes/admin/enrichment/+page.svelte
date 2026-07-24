<script lang="ts">
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { toasts } from '$lib/toast';
	import type { SubmitFunction } from './$types';

	type Citation = {
		citation_role: string | null;
		evidence_excerpt: string | null;
		source: {
			id: string;
			url: string;
			title: string | null;
			publisher: string | null;
			credibility: string | number | null;
		} | null;
	};

	type Dossier = {
		brand_slug: string;
		approval_status: string;
		customer_summary: string | null;
		creative_brief: Record<string, unknown> | string | null;
		last_researched_at: string | null;
		updated_at: string;
		review_reasons: string[] | null;
		metrics: {
			overallConfidence: number | null;
			identityConfidence: number | null;
			citationCoverage: number | null;
			credibleSources: number | null;
			independentSources: number | null;
		};
		run: {
			id: string;
			model: string | null;
			customer_summary_draft: string | null;
			creative_brief_draft: Record<string, unknown> | string | null;
			error_text: string | null;
		} | null;
		claims: Array<{
			id: string;
			claim_key: string;
			claim_value: unknown;
			confidence: number | null;
			evidence_assessment: string | null;
			materiality: string | null;
			rationale: string | null;
			citations: Citation[];
		}>;
		integrityFlags: Array<{
			id: string;
			severity: string;
			title: string;
			details: string | null;
			recommended_action: string | null;
		}>;
		profile: {
			summary: string | null;
			summary_confidence: number | null;
			publication_method: string | null;
			published_at: string | null;
		} | null;
	};

	export let data: {
		metrics: {
			queued: number;
			running: number;
			failed: number;
			publishedProfiles: number;
			dossiersNeedingReview: number;
			dueRefreshes: number;
			openIntegrityFlags: number;
		};
		dossiers: Dossier[];
		recentJobs: Array<{
			id: string;
			brand_slug: string;
			trigger_kind: string;
			status: string;
			attempt_count: number;
			last_error: string | null;
			created_at: string;
		}>;
		sourceErrors: string[];
	};

	let deleting: Dossier | null = null;
	let deleteConfirmation = '';
	let deleteNote = '';
	let deleteError = '';
	let pendingAction = '';

	const number = new Intl.NumberFormat('en-US');

	function percent(value: number | null) {
		if (value == null) return 'Unknown';
		return `${Math.round(value * 100)}%`;
	}

	function relativeDate(value: string | null) {
		if (!value) return 'Unknown';
		const elapsed = Date.now() - new Date(value).getTime();
		const hours = Math.max(0, Math.floor(elapsed / 3_600_000));
		if (hours < 1) return 'Less than an hour ago';
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function displayValue(value: unknown) {
		if (value == null) return 'Not provided';
		if (typeof value === 'string') return value;
		return JSON.stringify(value, null, 2);
	}

	function actionEnhance(action: string): SubmitFunction {
		return ({ cancel }) => {
			if (pendingAction) {
				cancel();
				return;
			}
			pendingAction = action;
			deleteError = '';
			return async ({ result }) => {
				pendingAction = '';
				const resultData =
					result.type === 'success' || result.type === 'failure' ? result.data : null;
				const message =
					resultData && typeof resultData.message === 'string'
						? resultData.message
						: result.type === 'error'
							? result.error.message
							: 'The request could not be completed.';

				if (result.type === 'success') {
					toasts.success(message);
					if (action === 'deleteFalsePositive') closeDelete();
					await invalidateAll();
					return;
				}
				if (action === 'deleteFalsePositive') deleteError = message;
				toasts.error(message);
				await applyAction(result);
			};
		};
	}

	function openDelete(dossier: Dossier) {
		deleting = dossier;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function closeDelete() {
		deleting = null;
		deleteConfirmation = '';
		deleteNote = '';
		deleteError = '';
	}

	function statusClasses(status: string) {
		if (status === 'succeeded' || status === 'published') return 'bg-emerald-50 text-emerald-700';
		if (status === 'failed') return 'bg-red-50 text-red-700';
		if (status === 'running') return 'bg-blue-50 text-blue-700';
		return 'bg-zinc-100 text-zinc-700';
	}
</script>

<svelte:head><title>Brand Enrichment | Bobadex Admin</title></svelte:head>

<svelte:window on:keydown={(event) => event.key === 'Escape' && deleting && closeDelete()} />

<main class="mx-auto max-w-7xl space-y-8 px-5 py-7 sm:py-9">
	<header class="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
		<div>
			<p class="text-xs font-semibold tracking-normal text-zinc-500 uppercase">
				Brand intelligence
			</p>
			<h2 class="mt-1 text-2xl font-semibold text-zinc-950 sm:text-3xl">Enrichment</h2>
			<p class="mt-2 max-w-2xl text-sm text-zinc-600">
				Run research campaigns, review evidence, and publish verified brand profiles.
			</p>
		</div>
		<form method="post" action="?/drain" use:enhance={actionEnhance('drain')}>
			<button
				class="inline-flex items-center rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
				disabled={Boolean(pendingAction)}
			>
				{pendingAction === 'drain' ? 'Starting…' : 'Drain queued work'}
			</button>
		</form>
	</header>

	{#if data.sourceErrors.length}
		<div class="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			<p class="font-medium">Some enrichment data could not be loaded</p>
			<p class="mt-0.5">{data.sourceErrors.join(', ')}</p>
		</div>
	{/if}

	<section
		aria-label="Enrichment metrics"
		class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
	>
		{#each [['Queued', data.metrics.queued, 'text-zinc-950'], ['Running', data.metrics.running, 'text-blue-700'], ['Failed', data.metrics.failed, data.metrics.failed ? 'text-red-700' : 'text-zinc-950'], ['Published', data.metrics.publishedProfiles, 'text-emerald-700'], ['Needs review', data.metrics.dossiersNeedingReview, 'text-amber-700'], ['Due refreshes', data.metrics.dueRefreshes, 'text-zinc-950'], ['Open flags', data.metrics.openIntegrityFlags, data.metrics.openIntegrityFlags ? 'text-red-700' : 'text-zinc-950']] as metric}
			<div class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
				<p class="text-xs font-medium text-zinc-500">{metric[0]}</p>
				<p class="mt-2 text-2xl font-semibold {metric[2]}">{number.format(Number(metric[1]))}</p>
			</div>
		{/each}
	</section>

	<section class="border-y border-zinc-200 py-6">
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
			<div>
				<h3 class="text-lg font-semibold text-zinc-950">Start a campaign</h3>
				<p class="mt-1 text-sm text-zinc-500">
					Enter brand slugs separated by commas or new lines.
				</p>
				<form method="post" class="mt-4" use:enhance={actionEnhance('campaign')}>
					<textarea
						name="brand_slugs"
						rows="4"
						required
						placeholder="cocofreshteaandjuice-859a55"
						class="block w-full rounded border-zinc-300 text-sm focus:border-zinc-500 focus:ring-zinc-500"
					></textarea>
					<div class="mt-3 flex flex-wrap gap-2">
						<button
							formaction="?/backfill"
							class="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
							disabled={Boolean(pendingAction)}>Run backfill</button
						>
						<button
							formaction="?/audit"
							class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
							disabled={Boolean(pendingAction)}>Run audit</button
						>
					</div>
				</form>
			</div>
			<div class="grid content-start gap-3 text-sm">
				<div class="flex gap-3">
					<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
					<p>
						<strong class="text-zinc-900">Backfill</strong> can auto-publish when the evidence clears
						every gate.
					</p>
				</div>
				<div class="flex gap-3">
					<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
					<p><strong class="text-zinc-900">Audit</strong> always stops for an admin review.</p>
				</div>
				<div class="flex gap-3">
					<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
					<p>
						<strong class="text-zinc-900">Blocking integrity flags</strong> always stop publication.
					</p>
				</div>
			</div>
		</div>
	</section>

	<section>
		<div class="mb-4 flex items-end justify-between gap-4">
			<div>
				<h3 class="text-lg font-semibold text-zinc-950">Dossiers needing review</h3>
				<p class="mt-1 text-sm text-zinc-500">
					Claims, citations, and integrity signals from the current research run.
				</p>
			</div>
			<span class="text-sm text-zinc-500 tabular-nums">{data.dossiers.length} dossiers</span>
		</div>

		<div class="space-y-5">
			{#each data.dossiers as dossier}
				<article class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
					<header
						class="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
					>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h4 class="text-base font-semibold break-all text-zinc-950">
									{dossier.brand_slug}
								</h4>
								{#if dossier.integrityFlags.length}<span
										class="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
										>{dossier.integrityFlags.length} open flag{dossier.integrityFlags.length === 1
											? ''
											: 's'}</span
									>{/if}
							</div>
							<p class="mt-1 text-xs text-zinc-500">
								Updated {relativeDate(dossier.updated_at)}{dossier.run?.model
									? ` · ${dossier.run.model}`
									: ''}
							</p>
						</div>
						<div class="grid grid-cols-3 gap-4 text-right text-xs sm:grid-cols-5">
							<div>
								<p class="font-semibold text-zinc-900">
									{percent(dossier.metrics.overallConfidence)}
								</p>
								<p class="text-zinc-500">overall</p>
							</div>
							<div>
								<p class="font-semibold text-zinc-900">
									{percent(dossier.metrics.identityConfidence)}
								</p>
								<p class="text-zinc-500">identity</p>
							</div>
							<div>
								<p class="font-semibold text-zinc-900">
									{percent(dossier.metrics.citationCoverage)}
								</p>
								<p class="text-zinc-500">coverage</p>
							</div>
							<div>
								<p class="font-semibold text-zinc-900">{dossier.metrics.credibleSources ?? '—'}</p>
								<p class="text-zinc-500">credible</p>
							</div>
							<div>
								<p class="font-semibold text-zinc-900">
									{dossier.metrics.independentSources ?? '—'}
								</p>
								<p class="text-zinc-500">independent</p>
							</div>
						</div>
					</header>

					<div class="grid gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
						<div class="min-w-0 space-y-6">
							<section>
								<h5 class="text-xs font-semibold text-zinc-500 uppercase">Draft summary</h5>
								<p class="mt-2 text-sm leading-6 whitespace-pre-wrap text-zinc-700">
									{dossier.run?.customer_summary_draft ??
										dossier.customer_summary ??
										'No draft summary was produced.'}
								</p>
							</section>

							<section>
								<div class="flex items-center justify-between">
									<h5 class="text-xs font-semibold text-zinc-500 uppercase">Claims and evidence</h5>
									<span class="text-xs text-zinc-500">{dossier.claims.length} claims</span>
								</div>
								<div class="mt-2 divide-y divide-zinc-200 border-y border-zinc-200">
									{#each dossier.claims as claim}
										<div class="py-4">
											<div class="flex flex-wrap items-start justify-between gap-2">
												<div>
													<p class="text-sm font-semibold text-zinc-900">
														{claim.claim_key.replaceAll('_', ' ')}
													</p>
													<p class="mt-1 text-sm whitespace-pre-wrap text-zinc-700">
														{displayValue(claim.claim_value)}
													</p>
												</div>
												<div class="flex gap-2">
													<span
														class="rounded px-2 py-1 text-xs font-medium {claim.evidence_assessment ===
														'contradicted'
															? 'bg-red-50 text-red-700'
															: 'bg-zinc-100 text-zinc-700'}"
														>{claim.evidence_assessment ?? 'unassessed'}</span
													><span class="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700"
														>{percent(claim.confidence)}</span
													>
												</div>
											</div>
											{#if claim.rationale}<p class="mt-2 text-sm leading-6 text-zinc-600">
													{claim.rationale}
												</p>{/if}
											{#if claim.citations.length}
												<div class="mt-3 flex flex-wrap gap-2">
													{#each claim.citations as citation}
														{#if citation.source}<a
																href={citation.source.url}
																target="_blank"
																rel="noreferrer"
																class="max-w-full truncate rounded border border-zinc-200 px-2 py-1 text-xs text-blue-700 hover:bg-zinc-50"
																>{citation.source.title ??
																	citation.source.publisher ??
																	citation.source.url}</a
															>{/if}
													{/each}
												</div>
											{/if}
										</div>
									{/each}
									{#if dossier.claims.length === 0}<p class="py-5 text-sm text-zinc-500">
											No claims are attached to the current run.
										</p>{/if}
								</div>
							</section>
						</div>

						<aside class="space-y-5">
							<section>
								<h5 class="text-xs font-semibold text-zinc-500 uppercase">Review reasons</h5>
								<div class="mt-2 flex flex-wrap gap-2">
									{#each dossier.review_reasons ?? [] as reason}<span
											class="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
											>{reason.replaceAll('_', ' ')}</span
										>{/each}{#if !dossier.review_reasons?.length}<span class="text-sm text-zinc-500"
											>No reason supplied.</span
										>{/if}
								</div>
							</section>

							{#if dossier.integrityFlags.length}
								<section>
									<h5 class="text-xs font-semibold text-red-700 uppercase">Integrity flags</h5>
									<div class="mt-2 space-y-2">
										{#each dossier.integrityFlags as flag}<div
												class="border-l-2 border-red-400 bg-red-50 px-3 py-2"
											>
												<p class="text-sm font-medium text-red-900">{flag.title}</p>
												{#if flag.details}<p class="mt-1 text-xs text-red-800">
														{flag.details}
													</p>{/if}{#if flag.recommended_action}<p
														class="mt-1 text-xs font-medium text-red-900"
													>
														{flag.recommended_action}
													</p>{/if}
											</div>{/each}
									</div>
								</section>
							{/if}

							<section>
								<h5 class="text-xs font-semibold text-zinc-500 uppercase">Published profile</h5>
								{#if dossier.profile}<div class="mt-2 border-l-2 border-emerald-400 pl-3">
										<p class="text-sm leading-6 text-zinc-700">
											{dossier.profile.summary ?? 'Published without a summary.'}
										</p>
										<p class="mt-1 text-xs text-zinc-500">
											{dossier.profile.publication_method ?? 'Unknown method'} · {percent(
												dossier.profile.summary_confidence
											)}
										</p>
									</div>{:else}<p class="mt-2 text-sm text-zinc-500">No published profile.</p>{/if}
							</section>
						</aside>
					</div>

					<footer class="border-t border-zinc-200 bg-zinc-50 px-5 py-4">
						<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
							<div class="grid gap-2 sm:grid-cols-2">
								<form
									method="post"
									action="?/approve"
									use:enhance={actionEnhance('approve')}
									class="flex gap-2"
								>
									<input type="hidden" name="brand_slug" value={dossier.brand_slug} /><input
										name="note"
										required
										placeholder="Approval note"
										class="min-w-0 flex-1 rounded border-zinc-300 text-sm"
									/><button
										class="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
										disabled={Boolean(pendingAction)}>Approve</button
									>
								</form>
								<form
									method="post"
									action="?/markClosed"
									use:enhance={actionEnhance('markClosed')}
									class="flex gap-2"
								>
									<input type="hidden" name="brand_slug" value={dossier.brand_slug} /><input
										name="note"
										required
										placeholder="Closure evidence"
										class="min-w-0 flex-1 rounded border-zinc-300 text-sm"
									/><button
										class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-50"
										disabled={Boolean(pendingAction)}>Mark closed</button
									>
								</form>
							</div>
							<button
								type="button"
								onclick={() => openDelete(dossier)}
								class="rounded border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
								>Delete false positive</button
							>
						</div>
					</footer>
				</article>
			{/each}
			{#if data.dossiers.length === 0}<div
					class="border-y border-zinc-200 py-14 text-center text-sm text-zinc-500"
				>
					No dossiers currently need review.
				</div>{/if}
		</div>
	</section>

	<section>
		<div class="mb-3">
			<h3 class="text-lg font-semibold text-zinc-950">Recent enrichment jobs</h3>
			<p class="mt-1 text-sm text-zinc-500">
				Latest worker activity across backfills, audits, and refreshes.
			</p>
		</div>
		<div class="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
			<table class="min-w-full divide-y divide-zinc-200 text-left text-sm">
				<thead class="bg-zinc-50 text-xs text-zinc-500 uppercase"
					><tr
						><th class="px-4 py-3 font-medium">Brand</th><th class="px-4 py-3 font-medium"
							>Trigger</th
						><th class="px-4 py-3 font-medium">Status</th><th class="px-4 py-3 font-medium"
							>Attempts</th
						><th class="px-4 py-3 font-medium">Created</th></tr
					></thead
				><tbody class="divide-y divide-zinc-100"
					>{#each data.recentJobs as job}<tr
							><td class="max-w-xs truncate px-4 py-3 font-medium text-zinc-900"
								>{job.brand_slug}</td
							><td class="px-4 py-3 text-zinc-600">{job.trigger_kind}</td><td class="px-4 py-3"
								><span class="rounded px-2 py-1 text-xs font-medium {statusClasses(job.status)}"
									>{job.status}</span
								>{#if job.last_error}<p class="mt-1 max-w-md text-xs text-red-700">
										{job.last_error}
									</p>{/if}</td
							><td class="px-4 py-3 text-zinc-600 tabular-nums">{job.attempt_count}</td><td
								class="px-4 py-3 text-zinc-500">{relativeDate(job.created_at)}</td
							></tr
						>{/each}{#if data.recentJobs.length === 0}<tr
							><td colspan="5" class="px-4 py-10 text-center text-zinc-500"
								>No enrichment jobs yet.</td
							></tr
						>{/if}</tbody
				>
			</table>
		</div>
	</section>
</main>

{#if deleting}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closeDelete()}
	>
		<div
			class="w-full max-w-lg rounded-lg bg-white shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-title"
		>
			<div class="border-b border-zinc-200 px-5 py-4">
				<h3 id="delete-title" class="text-lg font-semibold text-zinc-950">
					Permanently delete false positive
				</h3>
				<p class="mt-1 text-sm text-red-700">
					This cannot be undone. The API will refuse deletion when shops or feed events still depend
					on this brand.
				</p>
			</div>
			<form
				method="post"
				action="?/deleteFalsePositive"
				use:enhance={actionEnhance('deleteFalsePositive')}
				class="space-y-4 px-5 py-5"
			>
				<input type="hidden" name="brand_slug" value={deleting.brand_slug} />
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Type the exact slug</span><code
						class="mt-1 block rounded bg-zinc-100 px-2 py-1 text-xs break-all text-zinc-700"
						>{deleting.brand_slug}</code
					><input
						name="confirmation_slug"
						bind:value={deleteConfirmation}
						autocomplete="off"
						required
						class="mt-2 block w-full rounded border-zinc-300 text-sm"
					/></label
				>
				<label class="block"
					><span class="text-sm font-medium text-zinc-800">Verification note</span><textarea
						name="note"
						bind:value={deleteNote}
						rows="3"
						required
						placeholder="Verified false positive through …"
						class="mt-1 block w-full rounded border-zinc-300 text-sm"
					></textarea></label
				>
				{#if deleteError}<div
						class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						{deleteError}
					</div>{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={closeDelete}
						class="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
						>Cancel</button
					><button
						class="rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={deleteConfirmation !== deleting.brand_slug ||
							!deleteNote.trim() ||
							Boolean(pendingAction)}
						>{pendingAction === 'deleteFalsePositive' ? 'Deleting…' : 'Delete permanently'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
