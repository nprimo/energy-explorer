<script lang="ts">
	import { cell, colorLegend, defineChart } from "@tanstack/charts";
	import { scaleBand } from "d3-scale";
	import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
	import { utcSunday } from "d3-time";
	import { tooltip } from "@tanstack/charts/tooltip";
	import { Chart } from "@tanstack/charts/svelte";

	type Props = {
		cpe: string;
		register?: string;
		expectedReadingsPerDay?: number;
	};

	type CalendarRow = {
		date: Date;
		count: number;
		status: "empty" | "partial" | "complete";
	};

	const { cpe, register = "A+", expectedReadingsPerDay = 96 }: Props = $props();

	const now = new Date();
	const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

	let selectedYear = $state(now.getFullYear());
	let readingCounts = $state<Record<string, number>>({});
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let requestNumber = 0;

	const yearRange = $derived(() => {
		const current = now.getFullYear();
		return Array.from({ length: 5 }, (_, i) => current - i);
	});

	const expectedCount = $derived(Math.max(1, expectedReadingsPerDay));

	const calendarRows = $derived.by((): CalendarRow[] => {
		const yearStart = new Date(Date.UTC(selectedYear, 0, 1));
		const yearEnd = new Date(Date.UTC(selectedYear + 1, 0, 1));
		const rows: CalendarRow[] = [];
		const d = new Date(yearStart);

		while (d < yearEnd) {
			const key = formatKey(d);
			const count = readingCounts[key] ?? 0;
			rows.push({
				date: new Date(d),
				count,
				status: count === 0 ? "empty" : count >= expectedCount ? "complete" : "partial",
			});
			d.setUTCDate(d.getUTCDate() + 1);
		}

		return rows;
	});

	const calendarStart = $derived(new Date(Date.UTC(selectedYear, 0, 1)));

	const chartDef = $derived(
		defineChart({
			marks: [
				cell(calendarRows, {
					x: (d) => utcSunday.count(calendarStart, d.date),
					y: (d) => weekdays[d.date.getUTCDay()],
					color: "status",
					key: (d) => formatKey(d.date),
					inset: 1,
					radius: 2,
				}),
			],
			x: {
				scale: () =>
					scaleBand<number>()
						.paddingInner(0.06)
						.paddingOuter(0.03),
				axis: {
					line: false,
					ticks: { format: (v: number) => `W${v + 1}` },
					tickLabels: { fontSize: 10, opacity: 0.6 },
				},
			},
			y: {
				scale: scaleBand<string>()
					.domain(weekdays)
					.paddingInner(0.06)
					.paddingOuter(0.03),
				axis: false,
			},
			color: {
				scale: scaleOrdinal(
					["empty", "partial", "complete"],
					["#e5e7eb", "#fbbf24", "#22c55e"],
				),
				legend: colorLegend({ label: "Reading status" }),
			},
			tooltip,
		}),
	);

	$effect(() => {
		const year = selectedYear;
		void loadYear(cpe.trim(), register.trim() || "A+", year);
	});

	function formatKey(date: Date): string {
		const y = date.getUTCFullYear();
		const m = String(date.getUTCMonth() + 1).padStart(2, "0");
		const d = String(date.getUTCDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	function formatDateLong(date: Date): string {
		return date.toLocaleDateString("en-GB", {
			weekday: "short",
			day: "numeric",
			month: "short",
			year: "numeric",
			timeZone: "UTC",
		});
	}

	async function loadYear(selectedCpe: string, selectedRegister: string, year: number) {
		const currentRequest = ++requestNumber;
		readingCounts = {};
		loadError = null;

		if (!selectedCpe) {
			loadError = "A CPE is required.";
			return;
		}

		loading = true;

		try {
			const merged: Record<string, number> = {};

			for (let month = 0; month < 12; month++) {
				if (currentRequest !== requestNumber) return;

				const start = formatKey(new Date(Date.UTC(year, month, 1)));
				const end = formatKey(new Date(Date.UTC(year, month + 1, 1)));
				const params = new URLSearchParams({
					cpe: selectedCpe,
					register: selectedRegister,
					start,
					end,
				});

				const response = await fetch(`/api/readings/calendar?${params}`);
				if (!response.ok) {
					throw new Error(`${response.status}: ${await response.text()}`);
				}

				const result = (await response.json()) as { counts: Record<string, number> };
				Object.assign(merged, result.counts);
			}

			if (currentRequest === requestNumber) {
				readingCounts = merged;
			}
		} catch (error) {
			if (currentRequest === requestNumber) {
				loadError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (currentRequest === requestNumber) loading = false;
		}
	}
</script>

{#snippet tooltipBody({ points, defaultBody }: { points: any; defaultBody: () => any })}
	{@const point = points?.[0]}
	{#if point}
		{@const d = point.datum as CalendarRow}
		<div class="heatmap-tooltip">
			<div class="tooltip-date">{formatDateLong(d.date)}</div>
			<div class="tooltip-count">
				{d.count} of {expectedCount} readings
			</div>
			<div class="tooltip-status {d.status}">
				{d.status === "complete" ? "Complete" : d.status === "partial" ? "Partial" : "No data"}
			</div>
		</div>
	{:else}
		{@render defaultBody()}
	{/if}
{/snippet}

<section class="yearly-calendar" aria-label={`Yearly readings for ${cpe}`} aria-busy={loading}>
	<header class="calendar-header">
		<h2>Readings — {selectedYear}</h2>
		<div class="controls">
			<label class="year-select">
				<span class="sr-only">Select year</span>
				<select bind:value={selectedYear}>
					{#each yearRange() as year}
						<option value={year}>{year}</option>
					{/each}
				</select>
			</label>
			{#if loading}
				<span class="loading-badge" aria-label="Loading">Loading…</span>
			{/if}
		</div>
	</header>

	{#if loadError}
		<p class="error" role="alert">Could not load readings: {loadError}</p>
	{/if}

	<div class="chart-wrapper">
		<Chart
			definition={chartDef}
			ariaLabel={`Reading completion calendar for ${selectedYear}`}
			height={220}
			{tooltipBody}
		/>
	</div>
</section>

<style>
	.yearly-calendar {
		max-width: 900px;
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: white;
	}

	.calendar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 650;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.year-select select {
		padding: 0.35rem 0.6rem;
		border: 1px solid #d1d5db;
		border-radius: 0.4rem;
		background: white;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.loading-badge {
		font-size: 0.75rem;
		color: #6b7280;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.error {
		margin: 0 0 1rem;
		color: #b91c1c;
		font-size: 0.8rem;
	}

	.chart-wrapper {
		overflow-x: auto;
	}

	.heatmap-tooltip {
		padding: 0.25rem 0;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.tooltip-date {
		font-weight: 600;
		margin-bottom: 0.15rem;
	}

	.tooltip-count {
		color: #4b5563;
	}

	.tooltip-status {
		margin-top: 0.15rem;
		font-weight: 600;
		font-size: 0.75rem;
	}

	.tooltip-status.complete {
		color: #15803d;
	}

	.tooltip-status.partial {
		color: #d97706;
	}

	.tooltip-status.empty {
		color: #9ca3af;
	}

	@media (max-width: 520px) {
		.yearly-calendar {
			padding: 0.65rem;
		}

		.calendar-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}
	}
</style>
