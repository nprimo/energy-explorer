<script lang="ts">
	import { Chart } from "@tanstack/charts/svelte";
	import { defineChart } from "@tanstack/charts";
	import { tooltip } from "@tanstack/charts/tooltip";
	import { angleGrid, polar, radialArea, radialDot, radialGrid, radialLine, radialText } from "@tanstack/charts/polar";
	import { scaleLinear } from "d3-scale";
	import { SLOTS_PER_DAY, type SlotStat } from "$lib/consumption/profile";

	type Props = {
		title: string;
		stats: readonly SlotStat[];
		/** Shared radial domain maximum (Wh). Falls back to this chart's own max. */
		maxWh?: number;
		showDots?: boolean;
	};

	let { title, stats, maxWh, showDots = true }: Props = $props();

	const MEAN_COLOR = "#2563eb";
	const BAND_COLOR = "#3b82f6";

	type SlotRow = {
		kind: "slot";
		angle: number;
		slot: number;
		mean: number;
		low: number;
		high: number;
		n: number;
		std: number;
		min: number;
		max: number;
	};
	type DayRow = { kind: "day"; angle: number; slot: number; value: number };
	type HourRow = { angle: number; radius: number; text: string };
	type RingRow = { angle: number; radius: number; text: string };

	const domainMax = $derived.by(() => {
		if (maxWh !== undefined) return maxWh;
		return Math.max(1, ...stats.map((s) => Math.max(s.mean + s.std, s.max)));
	});

	const ringValues = $derived.by(() => {
		const steps = 4;
		return Array.from({ length: steps + 1 }, (_, i) => (domainMax / steps) * i);
	});

	// Slot rows plus one wrap row at angle 96 (== midnight) so the mean line
	// and band close seamlessly around the clock.
	const slotRows = $derived.by<readonly SlotRow[]>(() => {
		const rows = stats.map(
			(s): SlotRow => ({
				kind: "slot",
				angle: s.slot,
				slot: s.slot,
				mean: s.mean,
				low: Math.max(0, s.mean - s.std),
				high: s.mean + s.std,
				n: s.n,
				std: s.std,
				min: s.min,
				max: s.max,
			}),
		);
		if (rows.length === 0) return rows;
		const first = rows[0];
		return [...rows, { ...first, angle: SLOTS_PER_DAY }];
	});

	const dayRows = $derived.by<readonly DayRow[]>(() => {
		if (!showDots) return [];
		const rows: DayRow[] = [];
		for (const stat of stats) {
			for (const value of stat.values) {
				rows.push({ kind: "day", angle: stat.slot, slot: stat.slot, value });
			}
		}
		return rows;
	});

	const hourRows = $derived.by<readonly HourRow[]>(() =>
		[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
			angle: (hour / 24) * SLOTS_PER_DAY,
			radius: domainMax,
			text: String(hour).padStart(2, "0"),
		})),
	);

	// Ring value labels placed in the quiet early-morning sector.
	const ringRows = $derived.by<readonly RingRow[]>(() =>
		ringValues.map((value) => ({
			angle: (4.25 / 24) * SLOTS_PER_DAY,
			radius: value,
			text: String(Math.round(value)),
		})),
	);

	const chartDef = $derived(
		defineChart(
			{
				marks: [
					polar({
						radiusRatio: 0.8,
						angle: { scale: scaleLinear().domain([0, SLOTS_PER_DAY]) },
						radius: {
							scale: scaleLinear().domain([0, domainMax]),
							// Inner hole (clock face) at 26% of the full radius.
							range: [(ctx) => ctx.radius * 0.26, (ctx) => ctx.radius],
						},
						guides: [
							radialGrid({ values: ringValues, labels: false, stroke: "#f3f4f6" }),
							angleGrid({
								values: [0, 12, 24, 36, 48, 60, 72, 84],
								labels: false,
								stroke: "#e5e7eb",
							}),
						],
						marks: [
							radialArea(slotRows, {
								angle: "angle",
								radius1: "low",
								radius: "high",
								fill: BAND_COLOR,
								fillOpacity: 0.16,
							}),
							radialDot(dayRows, {
								angle: "angle",
								radius: "value",
								r: 1.8,
								fill: BAND_COLOR,
								fillOpacity: 0.35,
								strokeOpacity: 0,
							}),
							radialLine(slotRows, {
								angle: "angle",
								radius: "mean",
								stroke: MEAN_COLOR,
								strokeWidth: 2,
								strokeLinejoin: "round",
							}),
							radialText(hourRows, {
								angle: "angle",
								radius: "radius",
								radiusOffset: 14,
								text: "text",
								fill: "#6b7280",
								fontSize: 11,
								anchor: "middle",
								baseline: "middle",
							}),
							radialText(ringRows, {
								angle: "angle",
								radius: "radius",
								radiusOffset: -8,
								text: "text",
								fill: "#9ca3af",
								fontSize: 9,
								anchor: "middle",
								baseline: "middle",
							}),
						],
					}),
				],
				scales: { x: null, y: null },
				margin: 0,
				tooltip,
			},
			{ keyboard: true },
		),
	);

	function formatSlot(slot: number) {
		const minutes = slot * 15;
		const start = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
		const endMinutes = minutes + 15;
		const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
		return `${start}–${end}`;
	}
</script>

<figure class="clock">
	<figcaption>{title}</figcaption>
	<div class="plot">
		<Chart
			definition={chartDef}
			ariaLabel="{title}: average consumption by 15-minute slot"
			height={400}
			{tooltipBody}
		/>
	</div>
	<figcaption class="legend">
		<span class="swatch mean-swatch">mean</span>
		<span class="swatch band-swatch">± std dev</span>
		{#if showDots}<span class="swatch dots-swatch">per-day readings</span>{/if}
	</figcaption>
</figure>

{#snippet tooltipBody({ points, defaultBody }: { points: any; defaultBody: () => any })}
	{@const point = points?.[0]}
	{#if point}
		{@const datum = point.datum as SlotRow | DayRow}
		{#if datum.kind === "slot"}
			<div class="tooltip">
				<div class="tooltip-time">{formatSlot(datum.slot)}</div>
				<div class="tooltip-mean">
					{datum.mean.toFixed(1)} Wh <span>avg / 15 min</span>
				</div>
				<div class="tooltip-row">± {datum.std.toFixed(1)} Wh std dev</div>
				<div class="tooltip-row">
					min {datum.min.toFixed(1)} · max {datum.max.toFixed(1)} Wh
				</div>
				<div class="tooltip-row">{datum.n} day{datum.n === 1 ? "" : "s"}</div>
			</div>
		{:else}
			<div class="tooltip">
				<div class="tooltip-time">{formatSlot(datum.slot)}</div>
				<div class="tooltip-row">single day: {datum.value.toFixed(1)} Wh</div>
			</div>
		{/if}
	{:else}
		{@render defaultBody()}
	{/if}
{/snippet}

<style>
	.clock {
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
		max-width: 440px;
		margin: 0 auto;
	}

	.plot :global(svg) {
		max-width: 100%;
		height: auto;
	}

	.legend {
		display: flex;
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

	.band-swatch::before {
		background: var(--band-color, #3b82f6);
		opacity: 0.35;
	}

	.dots-swatch::before {
		background: var(--band-color, #3b82f6);
		opacity: 0.5;
		border-radius: 50%;
		width: 0.45rem;
		height: 0.45rem;
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
