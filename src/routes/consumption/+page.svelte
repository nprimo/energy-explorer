<script lang="ts">
	import DailyProfileClock from "$lib/components/DailyProfileClock.svelte";
	import { niceCeil, profileMax } from "$lib/consumption/profile";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let showDots = $state(true);

	const profile = $derived(data.profile);

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
	<label class="dots-toggle">
		<input type="checkbox" bind:checked={showDots} />
		Show per-day readings
	</label>

	<div class="clocks">
		<DailyProfileClock
			title="Weekdays (Mon–Fri)"
			stats={profile.workday}
			maxWh={sharedMax}
			{showDots}
		/>
		<DailyProfileClock
			title="Weekends (Sat–Sun)"
			stats={profile.weekend}
			maxWh={sharedMax}
			{showDots}
		/>
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
	.dots-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 1rem;
		font-size: 0.8rem;
		color: #4b5563;
		cursor: pointer;
	}
	.clocks {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.clocks > :global(*) {
		flex: 1 1 380px;
		max-width: 500px;
	}
	.note {
		margin-top: 1rem;
		color: #6b7280;
		font-size: 0.75rem;
	}
</style>
