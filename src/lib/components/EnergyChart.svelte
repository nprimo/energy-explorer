<script lang="ts">
	import * as Plot from "@observablehq/plot";
	import type { ConsumptionResponse } from "$lib/types/consumption";

	type Props = {
		startDate: string;
		endDate: string;
	};

	let { startDate, endDate }: Props = $props();

	let data = $state.raw<ConsumptionResponse | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let requestNumber = 0;

	function handleFetch() {
		if (!startDate || !endDate) return;
		void fetchConsumption(startDate, endDate);
	}

	async function fetchConsumption(requestedStart: string, requestedEnd: string) {
		const currentRequest = ++requestNumber;
		loading = true;
		error = null;

		try {
			const params = new URLSearchParams({ start: requestedStart, end: requestedEnd });
			const response = await fetch(`/api/consumption?${params}`);
			if (!response.ok) {
				throw new Error(`${response.status}: ${await response.text()}`);
			}

			if (currentRequest === requestNumber) {
				data = (await response.json()) as ConsumptionResponse;
			}
		} catch (cause) {
			if (currentRequest === requestNumber) {
				error = cause instanceof Error ? cause.message : String(cause);
				data = null;
			}
		} finally {
			if (currentRequest === requestNumber) loading = false;
		}
	}

	function renderChart(element: HTMLDivElement) {
		element.replaceChildren();
		if (!data || data.readings.length === 0) return;

		const readings = data.readings.map((reading) => {
			const date = new Date(reading.timestamp);
			return {
				...reading,
				date,
				endDate: new Date(date.getTime() + 15 * 60 * 1000),
			};
		});

		const plot = Plot.plot({
			marginTop: 20,
			marginBottom: 40,
			marginLeft: 50,
			x: { type: "utc", label: "Time", ticks: "hour" },
			y: { label: "Consumption (Wh)" },
			marks: [
				Plot.rect(readings, {
					x1: "date",
					x2: "endDate",
					y1: 0,
					y2: "valueWh",
					fill: "#3b82f6",
				}),
				Plot.ruleY([0]),
			],
		});
		element.appendChild(plot);

		return () => {
			plot.remove();
		};
	}
</script>

{#if loading}
	<p class="status">Loading readings...</p>
{:else if error}
	<p class="error" role="alert">Could not load readings: {error}</p>
{:else if data}
	<p class="status">
		{data.count} readings ({data.source}) for <code>{data.cpe}</code>
		({data.startDate} → {data.endDate})
	</p>
{:else}
	<p class="status">Choose a date range to load readings.</p>
{/if}

<button class="fetch" onclick={handleFetch} disabled={loading}>
	{loading ? "Loading..." : "Fetch"}
</button>

<div class="chart" {@attach renderChart}></div>

<style>
	.status {
		color: #4b5563;
		font-size: 0.875rem;
	}
	.error {
		color: #dc2626;
		font-size: 0.875rem;
	}
	.fetch {
		padding: 0.4rem 0.8rem;
		margin-bottom: 1rem;
	}
	.chart {
		max-width: 1000px;
	}
	.chart :global(svg) {
		width: 100%;
		height: auto;
	}
</style>
