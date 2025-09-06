<script lang="ts">
    // export let data;
  </script>
  
  <header class="border-b bg-white">
    <div class="mx-auto max-w-6xl px-4 py-5 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Bobadex Admin</h1>
      <nav class="flex gap-2">
        <a href="/admin"          class="px-3 py-2 rounded hover:bg-gray-100">Dashboard</a>
        <a href="/admin/brands"   class="px-3 py-2 rounded hover:bg-gray-100">Brands</a>
        <a href="/admin/reports"  class="px-3 py-2 rounded hover:bg-gray-100">Reports</a>
        <a href="/admin/imports"  class="px-3 py-2 rounded bg-gray-900 text-white">Imports</a>
      </nav>
    </div>
  </header>
  
  <slot />
  