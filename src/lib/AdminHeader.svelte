<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { toasts } from '$lib/toast';

	export let reviewCount = 0;

	const navLink = 'inline-flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-zinc-100';

	const toastMessages: Record<string, { kind: 'success' | 'error' | 'info'; text: string }> = {
		created_new: { kind: 'success', text: 'Created new brand' },
		merged_existing: { kind: 'success', text: 'Merged into existing brand' },
		merged: { kind: 'success', text: 'Merged' },
		rejected: { kind: 'info', text: 'Candidate rejected' },
		approve_failed: { kind: 'error', text: 'Approve failed' },
		reject_failed: { kind: 'error', text: 'Reject failed' },
		merge_failed: { kind: 'error', text: 'Merge failed' },
		grid_updated: { kind: 'success', text: 'Grid settings saved' },
		grid_failed: { kind: 'error', text: 'Grid update failed' },
		import_started: { kind: 'success', text: 'Region import started' },
		start_failed: { kind: 'error', text: 'Import start failed' },
		queue_drained: { kind: 'success', text: 'Queue drain started' },
		drain_failed: { kind: 'error', text: 'Queue drain failed' },
		processed: { kind: 'success', text: 'Candidate batch processed' },
		process_failed: { kind: 'error', text: 'Candidate processing failed' },
		llm_started: { kind: 'success', text: 'LLM review batch finished' },
		llm_failed: { kind: 'error', text: 'LLM review failed' },
		llm_reset: { kind: 'success', text: 'Stuck LLM reviews reset' },
		llm_reset_failed: { kind: 'error', text: 'LLM reset failed' },
		auto_applied: { kind: 'success', text: 'Auto LLM reviews applied' },
		auto_apply_failed: { kind: 'error', text: 'Auto-apply failed' }
	};

	function withBase(path: string) {
		return base && base !== '/' ? `${base}${path}` : path;
	}

	function handle(url: URL) {
		const toastCode = url.searchParams.get('toast');
		const rawMessage = url.searchParams.get('msg');
		if (!toastCode) return;

		const config = toastMessages[toastCode] ?? { kind: 'info', text: toastCode };
		toasts[config.kind](rawMessage ?? config.text, 4000);

		if (browser) {
			const params = new URLSearchParams(url.search);
			params.delete('toast');
			params.delete('msg');
			const clean = `${url.pathname}${params.toString() ? `?${params}` : ''}${url.hash}`;
			history.replaceState({}, '', clean);
		}
	}

	onMount(() => handle(new URL(window.location.href)));
	afterNavigate(({ to }) => {
		if (browser && to) handle(to.url);
	});
</script>

<header class="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
	<div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
		<a href={withBase('/admin')} class="shrink-0 text-lg font-semibold text-zinc-950 sm:text-xl">Bobadex Admin</a>

		<nav class="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Admin navigation">
			<a href={withBase('/admin')} class={navLink}>Dashboard</a>
			<a href={withBase('/admin/imports')} class={navLink}>Imports</a>
			<a href={withBase('/admin/enrichment')} class={navLink}>Enrichment</a>
			<a href={withBase('/admin/reviews')} class={navLink}>
				Reviews
				{#if reviewCount > 0}
					<span class="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800">{reviewCount > 999 ? '999+' : reviewCount}</span>
				{/if}
			</a>
			<form method="post" action={withBase('/logout')}>
				<button type="submit" class="ml-1 inline-flex h-9 items-center gap-2 rounded border border-zinc-200 px-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 sm:px-3" title="Sign out">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M10 17l5-5-5-5M15 12H3M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<span class="hidden sm:inline">Logout</span>
				</button>
			</form>
		</nav>
	</div>
</header>
