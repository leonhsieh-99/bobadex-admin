<script lang="ts">
    export let data: {
      regionCodes: Array<{
        code: string;
        country_code: string;
        region_name: string;
      }>;
    };

    let selectedRegionCode = data.regionCodes.find((r) => r.code === 'US-CA')?.code ?? data.regionCodes[0]?.code ?? 'US-CA';
    const defaultParams = JSON.stringify({
      bbox: [32.4, -124.5, 42.1, -114.1],
      timeout: 180,
      filters: [
        { k: "cuisine", op: "~", v: "^(bubble_tea|milk_tea)$" },
        { k: "amenity", op: "=", v: "cafe", nameRegex: "(\\btea\\b|\\bcha\\b|\\bbubble\\b|\\bboba\\b)", i: true }
      ],
      out: "center"
    }, null, 2);
  </script>
  
  <main class="mx-auto max-w-3xl px-4 py-6 space-y-4">
    <h1 class="text-xl font-semibold">Queue OSM Import</h1>
  
    <form id="queueForm" method="POST" action="/admin/imports/_api/import_region" novalidate>
      <label for="region_key" class="block text-xs text-gray-600 mb-1">Region key</label>
      <input
        id="region_key"
        name="region_key"
        class="border rounded px-3 py-2 text-sm w-full mb-3"
        list="region-code-options"
        bind:value={selectedRegionCode}
      />
      <datalist id="region-code-options">
        {#each data.regionCodes as rc}
          <option value={rc.code}>{rc.region_name} ({rc.country_code})</option>
        {/each}
      </datalist>

      <label for="params" class="block text-xs text-gray-600 mb-1">
        Params (JSON; must include bbox:[south,west,north,east])
      </label>
      <textarea
        id="params"
        name="params"
        class="w-full h-48 border rounded-lg px-3 py-2 font-mono text-sm"
        spellcheck="false"
      >{defaultParams}</textarea>
    
      <div class="mt-3 flex items-center gap-2">
        <div class="flex-1">
          <label for="note" class="sr-only">Note (optional)</label>
          <input
            id="note"
            name="note"
            class="border rounded px-3 py-2 text-sm w-full"
            placeholder="Note (optional)"
          />
        </div>
        <button type="submit" class="px-4 py-2 bg-gray-900 text-white rounded-lg">Queue</button>
      </div>
    </form>
    
  
    <a href="/admin/imports" class="text-sm text-gray-600 underline">← back to imports</a>
  </main>
  