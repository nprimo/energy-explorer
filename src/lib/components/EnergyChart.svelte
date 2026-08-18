<script lang="ts">
	import * as Plot from "@observablehq/plot";
	import { onMount } from "svelte";

	type Reading = { timestamp: string; valueWh: number; status: string };
	type Response = {
		cpe: string;
		register: string;
		startDate: string;
		endDate: string;
		source: "cache" | "api";
		count: number;
		readings: Reading[];
	};

	let container = $state<HTMLDivElement | null>(null);
	let start = $state("");
	let end = $state("");
	let data = $state.raw<Response | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	function defaultRange() {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		const fmt = (d: Date) => d.toISOString().slice(0, 10);
		start = fmt(yesterday);
		end = fmt(today);
	}

	async function fetchConsumption() {
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams({ start, end });
			const res = await fetch(`/api/consumption?${params}`);
			if (!res.ok) {
				const txt = await res.text();
				throw new Error(`${res.status}: ${txt}`);
			}
			data = (await res.json()) as Response;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			data = null;
		} finally {
			loading = false;
		}
	}

	function renderChart() {
		if (!container || !data || data.readings.length === 0) return;
		const readings = data.readings.map((r) => ({
			...r,
			date: new Date(r.timestamp),
		}));
		const plot = Plot.plot({
			marginTop: 20,
			marginBottom: 40,
			marginLeft: 50,
			// TODO: why can't I use "utc"/"time" instead of band?
			x: { type: "band", label: "Time", ticks: "hour" },
			y: { label: "Consumption (Wh)" },
			marks: [
				Plot.barY(readings, {
					x: "date",
					y: "valueWh",
					fill: "#3b82f6",
				}),
				Plot.ruleY([0]),
			],
		});
		container.innerHTML = "";
		container.appendChild(plot);
	}

	onMount(() => {
		defaultRange();
		fetchConsumption();
	});

	$effect(() => {
		renderChart();
	});
</script>

<header class="controls">
	<label>
		Start
		<input type="date" bind:value={start} />
	</label>
	<label>
		End
		<input type="date" bind:value={end} />
	</label>
	<button onclick={fetchConsumption} disabled={loading}>
		{loading ? "Loading..." : "Fetch"}
	</button>
	{#if error}
		<span class="error">{error}</span>
	{/if}
</header>

{#if data}
	<p>
		{data.count} readings ({data.source}) for <code>{data.cpe}</code>
		({data.startDate} → {data.endDate})
	</p>
{/if}

<div class="chart" bind:this={container}></div>

<style>
	.controls {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1rem;
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
	button {
		padding: 0.4rem 0.8rem;
		margin-top: 1.125rem;
	}
	.error {
		color: #dc2626;
		margin-top: 1.125rem;
		font-size: 0.875rem;
	}
	.chart {
		max-width: 1000px;
	}
	.chart :global(svg) {
		width: 100%;
		height: auto;
	}
</style>
