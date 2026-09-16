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

	/** Wh → kWh with one decimal. */
	function kwh(wh: number) {
		return `${(wh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kWh`;
	}

	/** Share of the period total, one decimal. */
	function share(wh: number) {
		const pct = (wh / data.energyByPeriod.totalWh) * 100;
		return `${pct.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
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

	<section class="breakdown">
		<h2>Total energy per tariff period</h2>
		<p class="breakdown-subtitle">
			ERSE regulated periods over the same window (ciclo semanal; baixa = vazio normal + super
			vazio, matching the chart colors).
		</p>
		<table>
			<thead>
				<tr><th>Period</th><th>Energy</th><th>Share</th></tr>
			</thead>
			<tbody>
				{#each data.energyByPeriod.display as entry (entry.period)}
					<tr>
						<td>{entry.period}</td>
						<td>{kwh(entry.wh)}</td>
						<td>{share(entry.wh)}</td>
					</tr>
				{/each}
				<tr class="total-row">
					<td>Total</td>
					<td>{kwh(data.energyByPeriod.totalWh)}</td>
					<td>100%</td>
				</tr>
			</tbody>
		</table>
		<details>
			<summary>Regulated periods</summary>
			<table>
				<thead>
					<tr><th>Period</th><th>Energy</th><th>Share</th></tr>
				</thead>
				<tbody>
					{#each data.energyByPeriod.regulated as entry (entry.period)}
						<tr>
							<td>{entry.period}</td>
							<td>{kwh(entry.wh)}</td>
							<td>{share(entry.wh)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</details>
	</section>
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
	.breakdown {
		margin-top: 1.5rem;
	}
	.breakdown h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}
	.breakdown-subtitle {
		margin: 0 0 0.75rem;
		color: #6b7280;
		font-size: 0.875rem;
	}
	.breakdown table {
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.breakdown th,
	.breakdown td {
		text-align: left;
		padding: 0.25rem 1.5rem 0.25rem 0;
		border-bottom: 1px solid #f3f4f6;
	}
	.breakdown th {
		color: #6b7280;
		font-weight: 500;
	}
	.total-row td {
		font-weight: 600;
		border-top: 1px solid #e5e7eb;
	}
	.breakdown details {
		margin-top: 0.75rem;
		font-size: 0.875rem;
	}
	.breakdown summary {
		color: #6b7280;
		cursor: pointer;
	}
</style>
