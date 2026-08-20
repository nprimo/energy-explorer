<script lang="ts">
	import EnergyChart from "$lib/components/EnergyChart.svelte";
	import ReadingsCalendar from "$lib/components/ReadingsCalendar.svelte";

	let { data } = $props();
</script>

<h1>E-REDES consumption</h1>

<ReadingsCalendar cpe={data.cpe} />
<EnergyChart />
