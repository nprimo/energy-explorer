<script lang="ts">
	import YearlyCalendarHeatmap from "$lib/components/YearlyCalendarHeatmap.svelte";
	import EredesFetchPanel from "$lib/components/EredesFetchPanel.svelte";
	import type { PageData } from "./$types";
	import type { ConsumptionResponse } from "$lib/types/consumption";

	let { data }: { data: PageData } = $props();

	let highlightDays = $state<string[]>([]);
	let incrementalCounts = $state<Record<string, number>>({});
	let heatmapRefreshKey = $state(0);

	function handleFetched(result: ConsumptionResponse, counts: Record<string, number>) {
		// Merge incrementally so earlier fetches stay visible until the next base reload.
		incrementalCounts = { ...incrementalCounts, ...counts };
		highlightDays = [...result.fetchedDays];

		if (highlightDays.length > 0) {
			const snapshot = highlightDays.join(",");
			setTimeout(() => {
				if (highlightDays.join(",") === snapshot) highlightDays = [];
			}, 30_000);
		}
	}
</script>

<h1>E-REDES consumption</h1>
<p class="subtitle">Availability shows what's already cached locally. Use fetch to pull missing days from E-REDES.</p>

<YearlyCalendarHeatmap
	cpe={data.cpe}
	refreshKey={heatmapRefreshKey}
	{highlightDays}
	{incrementalCounts}
/>

<EredesFetchPanel onFetched={handleFetched} />

<style>
	h1 {
		margin-bottom: 0.25rem;
	}
	.subtitle {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.875rem;
	}
</style>
