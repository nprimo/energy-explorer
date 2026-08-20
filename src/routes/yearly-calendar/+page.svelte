<script lang="ts">
	import YearlyCalendarHeatmap from "$lib/components/YearlyCalendarHeatmap.svelte";

	let { data } = $props();
</script>

<h1>Yearly Calendar Heatmap</h1>
<p class="subtitle">
	Full-year overview of reading completeness. Hover on a cell for details.
</p>

<YearlyCalendarHeatmap cpe={data.cpe} />

<p class="back"><a href="/">← Back to dashboard</a></p>

<style>
	h1 {
		font-size: 1.25rem;
		font-weight: 650;
		margin: 1.5rem 0 0.25rem;
	}

	.subtitle {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0 0 0.5rem;
	}

	.back {
		margin-top: 2rem;
		font-size: 0.85rem;
	}

	.back a {
		color: #2563eb;
		text-decoration: none;
	}

	.back a:hover {
		text-decoration: underline;
	}
</style>
