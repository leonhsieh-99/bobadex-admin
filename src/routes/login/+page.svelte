<script lang="ts">
    export let form: { message?: string } | undefined;
    let showPassword = false;
  </script>
  
  <div class="min-h-screen relative overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-zinc-100 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900">
    <!-- decorative blurs -->
    <div class="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl"></div>
    <div class="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl"></div>
  
    <div class="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-6">
      <div class="w-full max-w-md">
        <!-- Brand -->
        <div class="mb-8 text-center">
          <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-black text-white shadow-md">
            <span class="font-bold tracking-tight">BD</span>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Bobadex Admin
          </h1>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Sign in to continue</p>
        </div>
  
        <!-- Card -->
        <div class="rounded-2xl border border-zinc-200/60 bg-white/70 p-6 shadow-lg backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-900/60">
          {#if form?.message}
            <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/30 dark:text-red-200">
              {form.message}
            </div>
          {/if}
  
          <form method="post" class="space-y-5" autocomplete="on">
            <!-- Email -->
            <div class="group">
              <label for="email" class="mb-1 block text-sm font-medium text-zinc-800 group-focus-within:text-zinc-900 dark:text-zinc-200">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autocomplete="email"
                placeholder="you@company.com"
                class="block w-full rounded-xl border border-zinc-300/80 bg-white/80 px-3 py-2 text-zinc-900 placeholder-zinc-400 shadow-sm outline-none ring-0 transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-50"
              />
            </div>
  
            <!-- Password -->
            <div class="group">
              <div class="mb-1 flex items-center justify-between">
                <label for="password" class="block text-sm font-medium text-zinc-800 group-focus-within:text-zinc-900 dark:text-zinc-200">
                  Password
                </label>
              </div>
              <div class="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autocomplete="current-password"
                  placeholder="••••••••"
                  class="block w-full rounded-xl border border-zinc-300/80 bg-white/80 px-3 py-2 pr-12 text-zinc-900 placeholder-zinc-400 shadow-sm outline-none ring-0 transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-50"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-2 my-auto inline-flex h-8 items-center rounded-lg px-2 text-xs text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                  on:click={() => (showPassword = !showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {#if showPassword}Hide{:else}Show{/if}
                </button>
              </div>
            </div>
  
            <!-- Submit -->
            <button
              type="submit"
              class="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-white shadow-sm transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 active:translate-y-[1px] dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <svg class="h-4 w-4 opacity-90 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3 12a1 1 0 0 1 1-1h12.586l-4.293-4.293a1 1 0 1 1 1.414-1.414l6.364 6.364a1 1 0 0 1 0 1.414l-6.364 6.364a1 1 0 0 1-1.414-1.414L16.586 13H4a1 1 0 0 1-1-1Z"/>
              </svg>
              <span class="font-medium">Sign in</span>
            </button>
          </form>
        </div>
  
        <p class="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Admin access only.
        </p>
      </div>
    </div>
  </div>
  