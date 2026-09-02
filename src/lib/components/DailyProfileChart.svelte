<script lang="ts">
	// Standard line chart of the daily consumption profile: x is the time of
	// day, y the consumption. Encodings — mean line, ±1 std-dev band, ±2
	// std-dev band (lighter shade), tariff-period background areas and a
	// "now" marker — on a standard time axis.
	import { Chart } from "@tanstack/charts/svelte";
	import { defineChart } from "@tanstack/charts";
	import { tooltip } from "@tanstack/charts/tooltip";
	import { areaY, lineY, rect, ruleX } from "@tanstack/charts";
	import { scaleLinear } from "d3-scale";
	import { SLOTS_PER_DAY, type SlotStat } from "$lib/consumption/profile";
	import { computeSlotPeriods } from "$lib/tariff/slot-periods";
	import type { Cycle, DisplayPeriod } from "$lib/tariff/periods";
	import { useClock } from "$lib/time/clock.svelte";

	type Props = {
		title: string;
		stats: readonly SlotStat[];
		/** Shared y-domain maximum (Wh). Falls back to this chart's own max. */
		maxWh?: number;
		/** Counting cycle used to classify tariff periods. Defaults to semanal
		 *  (the sensible default while contracts are not wired in: simples has no
		 *  cycle, and the display periods are option-independent anyway). */
		cycle?: Cycle;
	};

	let { title, stats, maxWh, cycle = "semanal" }: Props = $props();

	const MEAN_COLOR = "#2563eb";
	// Same hue, two shades: the inner ±1 std band is darker than the outer ±2.
	const BAND1_COLOR = "#3b82f6";
	const BAND2_COLOR = "#93c5fd";
	const NOW_COLOR = "#dc2626";

	// Presentation-only mapping (the tariff module stays UI-free): green baixa,
	// orange cheia, red ponta. Mirrored by the CSS custom properties below.
	const PERIOD_FILL: Readonly<Record<DisplayPeriod, string>> = {
		baixa: "#16a34a",
		cheia: "#ea580c",
		ponta: "#dc2626",
	};
	const PERIOD_LABEL: Readonly<Record<DisplayPeriod, string>> = {
		baixa: "baixa (vazio)",
		cheia: "cheias",
		ponta: "ponta",
	};

	// Slot 0 is local midnight — same anchoring as computeDailyProfile.
	// 24 h × 60 min: the unit of useClock's `minutes` reading (0–1439).
	const MINUTES_PER_DAY = 24 * 60;
	const lisbon = useClock("Europe/Lisbon");

	type SlotRow = {
		kind: "slot";
		slot: number;
		mean: number;
		low1: number;
		high1: number;
		low2: number;
		high2: number;
		n: number;
		std: number;
		min: number;
		max: number;
		period: DisplayPeriod;
	};
	type PeriodRow = {
		kind: "period";
		x1: number;
		x2: number;
		y1: number;
		y2: number;
		period: DisplayPeriod;
	};
	type PeriodSlice = { period: DisplayPeriod; rows: readonly PeriodRow[] };
	type NowRow = { kind: "now"; x: number; label: string };

	const domainMax = $derived.by(() => {
		if (maxWh !== undefined) return maxWh;
		return Math.max(1, ...stats.map((s) => s.mean + 2 * s.std));
	});

	// Slot rows plus one wrap row at slot 96 (== next midnight) so the mean
	// line and bands reach the right edge of the plot. Bands clamp at zero:
	// consumption cannot go negative.
	const slotRows = $derived.by<readonly SlotRow[]>(() => {
		const periods = computeSlotPeriods(cycle);
		const rows = stats.map(
			(s): SlotRow => ({
				kind: "slot",
				slot: s.slot,
				mean: s.mean,
				low1: Math.max(0, s.mean - s.std),
				high1: s.mean + s.std,
				low2: Math.max(0, s.mean - 2 * s.std),
				high2: s.mean + 2 * s.std,
				n: s.n,
				std: s.std,
				min: s.min,
				max: s.max,
				period: periods[s.slot] ?? "baixa",
			}),
		);
		if (rows.length === 0) return rows;
		return [...rows, { ...rows[0], slot: SLOTS_PER_DAY }];
	});

	type PeriodRun = { start: number; end: number; period: DisplayPeriod };

	// Contiguous slots sharing a period become one background band. One rect
	// mark per run (rect fill is a constant), spanning the full y domain.
	const periodSlices = $derived.by<readonly PeriodSlice[]>(() => {
		const periods = computeSlotPeriods(cycle);
		const runs: PeriodRun[] = [];
		for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
			const period = periods[slot];
			const last = runs[runs.length - 1];
			if (last && last.period === period) last.end = slot + 1;
			else runs.push({ start: slot, end: slot + 1, period });
		}
		return runs.map((run) => ({
			period: run.period,
			rows: [
				{
					kind: "period",
					x1: run.start,
					x2: run.end,
					y1: 0,
					y2: domainMax,
					period: run.period,
				},
			],
		}));
	});

	const nowRows = $derived.by<readonly NowRow[]>(() => [
		{
			kind: "now",
			x: (lisbon.current.minutes / MINUTES_PER_DAY) * SLOTS_PER_DAY,
			label: lisbon.current.label,
		},
	]);

	const HOUR_TICKS = [0, 12, 24, 36, 48, 60, 72, 84];

	function formatHour(slot: number) {
		return `${String(Math.floor(slot / 4)).padStart(2, "0")}:00`;
	}

	const chartDef = $derived(
		defineChart({
			marks: [
				// Tariff period bands at the bottom of the stack, so the std-dev
				// bands and mean line read on top of them.
				...periodSlices.map((slice) =>
					rect(slice.rows, {
						x1: "x1",
						x2: "x2",
						y1: "y1",
						y2: "y2",
						fill: PERIOD_FILL[slice.period],
						fillOpacity: 0.14,
					}),
				),
				// Bands first (outer ±2 std in the lighter shade, then inner ±1 std
				// painted on top), so the mean line reads over both.
				areaY(slotRows, {
					x: "slot",
					y1: "low2",
					y2: "high2",
					fill: BAND2_COLOR,
					fillOpacity: 0.55,
				}),
				areaY(slotRows, {
					x: "slot",
					y1: "low1",
					y2: "high1",
					fill: BAND1_COLOR,
					fillOpacity: 0.3,
				}),
				lineY(slotRows, {
					x: "slot",
					y: "mean",
					stroke: MEAN_COLOR,
					strokeWidth: 2,
				}),
				// Live-time marker: ruleX spans the full plot height. Rules emit no
				// interaction points, so "now" is disclosed via the legend instead.
				ruleX(nowRows, {
					x: "x",
					stroke: NOW_COLOR,
					strokeWidth: 1.5,
					strokeOpacity: 0.9,
				}),
			],
			x: {
				scale: () => scaleLinear().domain([0, SLOTS_PER_DAY]),
				grid: false,
				axis: {
					label: "hour of day (Europe/Lisbon)",
					ticks: { values: HOUR_TICKS, format: formatHour },
				},
			},
			y: {
				scale: () => scaleLinear().domain([0, domainMax]),
				nice: false,
				grid: true,
				axis: { label: "Wh per 15 min" },
			},
			tooltip,
		}),
	);

	function formatSlot(slot: number) {
		const minutes = (slot * 15) % (24 * 60);
		const start = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
		const endMinutes = minutes + 15;
		const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
		return `${start}–${end}`;
	}
</script>

<figure class="chart">
	<figcaption>{title}</figcaption>
	<div class="plot">
		<Chart
			definition={chartDef}
			ariaLabel="{title}: average consumption by 15-minute slot"
			height={340}
			{tooltipBody}
		/>
	</div>
	<figcaption class="legend">
		<span class="swatch mean-swatch">mean</span>
		<span class="swatch band1-swatch">±1 std dev</span>
		<span class="swatch band2-swatch">±2 std dev</span>
		{#each Object.keys(PERIOD_FILL) as period (period)}
			<span
				class="swatch period-swatch"
				style:background={PERIOD_FILL[period as DisplayPeriod]}
			>{PERIOD_LABEL[period as DisplayPeriod]}</span>
		{/each}
		<span class="swatch now-swatch">now {lisbon.current.label} Lisbon</span>
	</figcaption>
</figure>

{#snippet tooltipBody({ points, defaultBody }: { points: any; defaultBody: () => any })}
	{@const all = (points ?? []) as { datum: SlotRow | PeriodRow }[]}
	{@const main = all.find((p) => p.datum.kind !== "period")}
	{@const periodDatum = all.find((p) => p.datum.kind === "period")?.datum as PeriodRow | undefined}
	{#if main}
		{@const datum = main.datum}
		<div class="tooltip">
			{#if datum.kind === "slot"}
				<div class="tooltip-time">{formatSlot(datum.slot)}</div>
				<div class="tooltip-mean">
					{datum.mean.toFixed(1)} Wh <span>avg / 15 min</span>
				</div>
				<div class="tooltip-row">± {datum.std.toFixed(1)} Wh std dev</div>
				<div class="tooltip-row">
					min {datum.min.toFixed(1)} · max {datum.max.toFixed(1)} Wh
				</div>
				<div class="tooltip-row">{datum.n} day{datum.n === 1 ? "" : "s"}</div>
			{/if}
			{#if periodDatum}
				<div class="tooltip-row">tariff period: {PERIOD_LABEL[periodDatum.period]}</div>
			{/if}
		</div>
	{:else if periodDatum}
		<div class="tooltip">
			<div class="tooltip-time">{PERIOD_LABEL[periodDatum.period]}</div>
			<div class="tooltip-row">tariff period (ciclo {cycle})</div>
		</div>
	{:else}
		{@render defaultBody()}
	{/if}
{/snippet}

<style>
	.chart {
		margin: 0;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: white;
	}

	figcaption {
		font-size: 0.95rem;
		font-weight: 650;
		text-align: center;
	}

	.plot {
		max-width: 640px;
		margin: 0 auto;
	}

	.plot :global(svg) {
		max-width: 100%;
		height: auto;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		font-weight: 400;
		color: #6b7280;
	}

	.swatch::before {
		content: "";
		display: inline-block;
		width: 0.75rem;
		height: 0.45rem;
		margin-right: 0.3rem;
		border-radius: 0.15rem;
		vertical-align: middle;
	}

	.mean-swatch::before {
		background: var(--mean-color, #2563eb);
	}

	.band1-swatch::before {
		background: var(--band1-color, #3b82f6);
		opacity: 0.4;
	}

	.band2-swatch::before {
		background: var(--band2-color, #93c5fd);
		opacity: 0.6;
	}

	.now-swatch {
		color: var(--now-color, #dc2626);
	}

	.now-swatch::before {
		background: var(--now-color, #dc2626);
		border-radius: 50%;
		width: 0.45rem;
		height: 0.45rem;
	}

	.period-swatch::before {
		background: inherit;
	}

	.tooltip {
		padding: 0.25rem 0;
		font-size: 0.75rem;
		line-height: 1.45;
	}

	.tooltip-time {
		font-weight: 650;
	}

	.tooltip-mean {
		font-size: 0.85rem;
		font-weight: 650;
	}

	.tooltip-mean span {
		font-weight: 400;
		color: #9ca3af;
	}

	.tooltip-row {
		color: #6b7280;
	}
</style>
