<script lang="ts">
	import * as Plot from "@observablehq/plot";
	import type { Markish } from "@observablehq/plot";
	import { onMount } from "svelte";

	type DayResult = { day: string; ok: boolean; count: number; error?: string };
	type PullSummary = {
		cpe: string;
		register: string;
		mode: "backfill" | "refresh";
		fromDay: string | null;
		toDay: string;
		latestDayBefore: string | null;
		requested: number;
		fetched: number;
		skipped: number;
		failed: number;
		results: DayResult[];
		message?: string;
	};

	type MonthPoint = {
		dayOfWeek: number;
		hour: number;
		minute: number;
		hourFloat: number;
		valueWh: number;
	};
	type MonthRow = {
		monthIso: string;
		year: number;
		month: number;
		label: string;
		points: MonthPoint[];
	};
	type MonthlyResponse = {
		cpe: string;
		register: string;
		months: MonthRow[];
	};

	const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const WEEKDAY_COLORS = [
		"#1f77b4",
		"#ff7f0e",
		"#2ca02c",
		"#d62728",
		"#9467bd",
		"#8c564b",
		"#e377c2",
	];
	const PLOT_W = 900;
	const PLOT_ML = 50;
	const PLOT_MR = 12;

	let data = $state<MonthlyResponse | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let pullLoading = $state<null | "backfill" | "refresh">(null);
	let pullSummary = $state<PullSummary | null>(null);
	let pullError = $state<string | null>(null);
	let showFailures = $state(false);

	// per-weekday visibility; default all on
	let visibleDays = $state<Set<number>>(
		new Set([1, 2, 3, 4, 5, 6, 7]),
	);

	type Slot = {
		hourFloat: number;
		mean: number;
		std: number;
		dayOfWeek: number;
	};

	// containers tracked by action; per-month it sets the SVG node
	let nodesByMonth = new Map<string, HTMLDivElement>();

	async function fetchMonthly() {
		loading = true;
		error = null;
		try {
			const res = await fetch("/api/monthly");
			if (!res.ok) {
				const txt = await res.text();
				throw new Error(`${res.status}: ${txt}`);
			}
			data = (await res.json()) as MonthlyResponse;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			data = null;
		} finally {
			loading = false;
		}
	}

	async function runPull(mode: "backfill" | "refresh") {
		pullLoading = mode;
		pullError = null;
		pullSummary = null;
		try {
			const url =
				mode === "backfill"
					? "/api/pull/backfill?days=365"
					: "/api/pull/refresh";
			const res = await fetch(url, { method: "POST" });
			if (!res.ok) {
				const txt = await res.text();
				throw new Error(`${res.status}: ${txt}`);
			}
			pullSummary = (await res.json()) as PullSummary;
			await fetchMonthly();
		} catch (e) {
			pullError = e instanceof Error ? e.message : String(e);
		} finally {
			pullLoading = null;
		}
	}

	function toggleDay(dow: number) {
		const next = new Set(visibleDays);
		if (next.has(dow)) next.delete(dow);
		else next.add(dow);
		// never allow empty selection
		if (next.size === 0) return;
		visibleDays = next;
		// re-render all plots since legend changed
		for (const m of data?.months ?? []) {
			renderPlotFor(m.monthIso);
		}
	}

	function fmtHour(h: number): string {
		const hh = Math.floor(h);
		const mm = Math.round((h - hh) * 60);
		return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
	}

	function mean(xs: number[]): number {
		return xs.reduce((a, b) => a + b, 0) / xs.length;
	}

	function std(xs: number[]): number {
		if (xs.length < 2) return 0;
		const m = mean(xs);
		return Math.sqrt(
			xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length,
		);
	}

	function aggregate(month: MonthRow): Slot[] {
		const bySlot = new Map<string, number[]>();
		for (const p of month.points) {
			const key = `${p.dayOfWeek}|${p.hourFloat}`;
			const arr = bySlot.get(key) ?? [];
			arr.push(p.valueWh);
			bySlot.set(key, arr);
		}
		const slots: Slot[] = [];
		for (const [key, vals] of bySlot) {
			const [dow, hf] = key.split("|").map(Number);
			slots.push({
				hourFloat: hf,
				mean: mean(vals),
				std: std(vals),
				dayOfWeek: dow,
			});
		}
		return slots;
	}

	function renderPlotFor(monthIso: string) {
		const month = data?.months.find((m) => m.monthIso === monthIso);
		const node = nodesByMonth.get(monthIso);
		if (!month || !node) return;
		node.innerHTML = "";
		if (month.points.length === 0) {
			node.innerHTML = "<p class='empty'>no data</p>";
			return;
		}

		const slots = aggregate(month);
		const visibleSlots = slots
			.filter((s) => visibleDays.has(s.dayOfWeek))
			.sort((a, b) =>
				a.dayOfWeek === b.dayOfWeek
					? a.hourFloat - b.hourFloat
					: a.dayOfWeek - b.dayOfWeek,
			);

		const areaData = visibleSlots.map((x) => ({
			hourFloat: x.hourFloat,
			lower: x.mean - x.std,
			upper: x.mean + x.std,
			dayOfWeek: x.dayOfWeek,
		}));
		const lineData = visibleSlots.map((x) => ({
			hourFloat: x.hourFloat,
			mean: x.mean,
			dayOfWeek: x.dayOfWeek,
		}));

		const marks: Markish[] = [
			Plot.areaY(areaData, {
				x: "hourFloat",
				y1: "lower",
				y2: "upper",
				fill: "dayOfWeek",
				fillOpacity: 0.12,
			}),
			Plot.lineY(lineData, {
				x: "hourFloat",
				y: "mean",
				stroke: "dayOfWeek",
				strokeWidth: 1.5,
				tip: "x",
			}),
		];

		// dim raw dots if their weekday is not visible
		const visiblePts = month.points.filter((p) =>
			visibleDays.has(p.dayOfWeek),
		);
		marks.push(
			Plot.dot(visiblePts, {
				x: "hourFloat",
				y: "valueWh",
				fill: "dayOfWeek",
				r: 1,
				fillOpacity: 0.15,
			}),
		);

		const plot = Plot.plot({
			width: PLOT_W,
			height: 360,
			marginTop: 12,
			marginBottom: 36,
			marginLeft: PLOT_ML,
			marginRight: PLOT_MR,
			x: {
				domain: [0, 24],
				ticks: [0, 3, 6, 9, 12, 15, 18, 21, 24],
				tickFormat: (d) => fmtHour(d as number),
				label: "Hour of day (Lisbon)",
			},
			y: { label: "Wh", nice: true },
			color: {
				domain: [1, 2, 3, 4, 5, 6, 7],
				range: WEEKDAY_COLORS,
				legend: false,
				tickFormat: (d) =>
					WEEKDAY_LABELS[(d as number) - 1] ?? String(d),
			},
			marks,
		});
		node.appendChild(plot);
	}

	function plotAction(node: HTMLDivElement, monthIso: string) {
		nodesByMonth.set(monthIso, node);
		renderPlotFor(monthIso);
		return {
			update(newMonthIso: string) {
				if (newMonthIso !== monthIso) {
					nodesByMonth.delete(monthIso);
					monthIso = newMonthIso;
					nodesByMonth.set(monthIso, node);
					renderPlotFor(monthIso);
				}
			},
			destroy() {
				nodesByMonth.delete(monthIso);
			},
		};
	}

	onMount(() => {
		fetchMonthly();
	});

	// when data arrives, ensure all plots rendered after DOM mount
	$effect(() => {
		const months = data?.months ?? [];
		if (months.length === 0) return;
		for (const m of months) renderPlotFor(m.monthIso);
	});
</script>

<header class="controls">
	<h1>Monthly consumption</h1>
	<button onclick={fetchMonthly} disabled={loading || pullLoading !== null}>
		{loading ? "Loading..." : "Reload"}
	</button>
	<button
		onclick={() => runPull("backfill")}
		disabled={loading || pullLoading !== null}
	>
		{pullLoading === "backfill" ? "Backfilling..." : "Backfill 1 year"}
	</button>
	<button
		onclick={() => runPull("refresh")}
		disabled={loading || pullLoading !== null}
	>
		{pullLoading === "refresh" ? "Refreshing..." : "Refresh latest"}
	</button>
	{#if error}
		<span class="error">{error}</span>
	{/if}
	{#if pullError}
		<span class="error">pull: {pullError}</span>
	{/if}
</header>

<div class="legend" role="group" aria-label="Weekday filter">
	{#each Array.from({ length: 7 }, (_, i) => i + 1) as dow (dow)}
		<button
			class="legend-pill"
			class:active={visibleDays.has(dow)}
			onclick={() => toggleDay(dow)}
		>
			<span class="swatch" style={`background:${WEEKDAY_COLORS[dow - 1]}`}></span>
			{WEEKDAY_LABELS[dow - 1]}
		</button>
	{/each}
</div>

{#if pullSummary}
	<p class="pull-summary">
		Pull <code>{pullSummary.mode}</code>:
		{pullSummary.fetched} fetched, {pullSummary.skipped} skipped,
		{pullSummary.failed} failed (of {pullSummary.requested} requested)
		{#if pullSummary.fromDay}
			— {pullSummary.fromDay} → {pullSummary.toDay}
		{/if}
		{#if pullSummary.failed > 0}
			<button
				class="fail-list-toggle"
				onclick={() => (showFailures = !showFailures)}
			>
				{showFailures ? "hide" : "show"} failures
			</button>
		{/if}
	</p>
	{#if showFailures && pullSummary.failed > 0}
		<ul class="fail-list">
			{#each pullSummary.results.filter((r) => !r.ok) as r (r.day)}
				<li>
					<code>{r.day}</code>: {r.error ?? "unknown"}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

{#if data && data.months.length === 0}
	<p>No data yet. Run <strong>Backfill</strong> to fetch up to 1 year.</p>
{/if}

{#each data?.months ?? [] as month (month.monthIso)}
	<section class="month-row">
		<h2>{month.label}</h2>
		<p class="count">{month.points.length} points</p>
		<div
			class="plot-container"
			role="img"
			aria-label={`Consumption chart for ${month.label}`}
			use:plotAction={month.monthIso}
		></div>
	</section>
{/each}

<style>
	.controls {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: 1.25rem;
		margin: 0;
	}
	button {
		padding: 0.4rem 0.75rem;
	}
	.error {
		color: #dc2626;
		font-size: 0.875rem;
	}
	.pull-summary {
		font-size: 0.875rem;
		color: #334155;
		margin-bottom: 1rem;
	}
	.fail-list {
		font-size: 0.8rem;
		color: #b91c1c;
		max-height: 8rem;
		overflow-y: auto;
	}
	.fail-list-toggle {
		margin-left: 0.5rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.75rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 1rem;
	}
	.legend-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		font-size: 0.78rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: transparent;
		color: #475569;
		cursor: pointer;
		opacity: 0.4;
		transition: opacity 80ms;
	}
	.legend-pill.active {
		opacity: 1;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		display: inline-block;
	}
	.month-row {
		margin-bottom: 2rem;
	}
	.month-row h2 {
		font-size: 1.05rem;
		margin: 0 0 0.25rem;
	}
	.count {
		font-size: 0.8rem;
		color: #64748b;
		margin: 0 0 0.5rem;
	}
	.plot-container {
		position: relative;
		width: 100%;
		overflow-x: auto;
	}
	.plot-container :global(svg) {
		display: block;
		max-width: 100%;
		height: auto;
	}
	.plot-container :global(.empty) {
		color: #94a3b8;
		font-size: 0.85rem;
	}
</style>