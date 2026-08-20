<script lang="ts">
	import EnergyChart from "$lib/components/EnergyChart.svelte";
	import ReadingsCalendar from "$lib/components/ReadingsCalendar.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	let startDate = $state(formatDate(yesterday));
	let endDate = $state(formatDate(today));

	function formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
</script>

<h1>E-REDES consumption</h1>

<ReadingsCalendar cpe={data.cpe} />

<div class="controls">
	<label>
		Start
		<input type="date" bind:value={startDate} />
	</label>
	<label>
		End
		<input type="date" bind:value={endDate} />
	</label>
</div>

<EnergyChart {startDate} {endDate} />

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: end;
		margin: 1rem 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}
	input {
		padding: 0.25rem 0.5rem;
	}
</style>
