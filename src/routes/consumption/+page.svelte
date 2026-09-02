<script lang="ts">
	import DailyProfileChart from "$lib/components/DailyProfileChart.svelte";
	import { niceCeil, profileMax } from "$lib/consumption/profile";
	import { useClock } from "$lib/time/clock.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const profile = $derived(data.profile);

	// Today's classification drives which profile graph is shown. Shared clock
	// zone with the chart's "now" marker (Europe/Lisbon).
	const today = useClock("Europe/Lisbon");
	const todayKind = $derived(today.current.dayKind);

	const sharedMax = $derived(profile ? niceCeil(profileMax(profile) * 1.05) : undefined);

	const workdayReadings = $derived(
		profile?.workday.reduce((sum, s) => sum + s.n, 0) ?? 0,
	);
	const weekendReadings = $derived(
		profile?.weekend.reduce((sum, s) => sum + s.n, 0) ?? 0,
	);

	function formatDay(iso: string) {
		return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short",
			timeZone: "UTC",
		});
	}
</script>

<h1>Daily consumption profile</h1>
<p class="subtitle">
	Average Wh per 15-minute slot over the last {data.days} available days
	{#if data.range.start && data.range.end}
		({formatDay(data.range.start)} – {formatDay(data.range.end)}, {data.range.count} readings)
	{/if}
</p>

{#if data.range.count === 0}
	<p class="status">No cached readings yet. Fetch some from E-REDES first.</p>
{:else if profile}
	<div class="charts">
		{#if todayKind === "workday"}
			<DailyProfileChart
				title="Weekdays (Mon–Fri) — today"
				stats={profile.workday}
				maxWh={sharedMax}
			/>
		{:else}
			<DailyProfileChart
				title="Weekends (Sat–Sun) — today"
				stats={profile.weekend}
				maxWh={sharedMax}
			/>
		{/if}
	</div>

	<p class="note">
		{data.range.dayCount} days ({workdayReadings.toLocaleString("en-GB")} weekday and
		{weekendReadings.toLocaleString("en-GB")} weekend readings) aggregated from the local cache.
		Slots average only the days that have data for that slot.
	</p>
{/if}

<style>
	h1 {
		margin-bottom: 0.25rem;
	}
	.subtitle {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.875rem;
	}
	.status {
		color: #4b5563;
		font-size: 0.875rem;
	}
	.charts {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.charts > :global(*) {
		flex: 1 1 420px;
		max-width: 700px;
	}
	.note {
		margin-top: 1rem;
		color: #6b7280;
		font-size: 0.75rem;
	}
</style>
