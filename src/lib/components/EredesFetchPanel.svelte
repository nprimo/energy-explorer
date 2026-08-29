<script lang="ts">
	import type { ConsumptionResponse } from "$lib/types/consumption";
	import { SvelteDate } from "svelte/reactivity";

	type Props = {
		onFetched?: (result: ConsumptionResponse, countsByDay: Record<string, number>) => void;
		initialStart?: string;
		initialEnd?: string;
	};

	const { onFetched, initialStart, initialEnd }: Props = $props();

	const today = new SvelteDate();
	today.setUTCHours(0, 0, 0, 0);
	const yesterday = new SvelteDate(today);
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);

	function formatDate(date: Date): string {
		const year = date.getUTCFullYear();
		const month = String(date.getUTCMonth() + 1).padStart(2, "0");
		const day = String(date.getUTCDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	function daysInRange(start: string, end: string): number {
		const s = new Date(start + "T00:00:00Z");
		const e = new Date(end + "T00:00:00Z");
		return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000));
	}

	// svelte-ignore state_referenced_locally
	let startDate = $state(initialStart ?? formatDate(yesterday));
	// svelte-ignore state_referenced_locally
	let endDate = $state(initialEnd ?? formatDate(today));

	let fetching = $state(false);
	let fetchError = $state<string | null>(null);
	let lastResult = $state<ConsumptionResponse | null>(null);

	const sourceMeta = $derived.by(() => {
		if (!lastResult) return null;
		const { source, fetchedDays } = lastResult;
		const totalDays = daysInRange(startDate, endDate);
		const fetched = fetchedDays.length;
		const cached = Math.max(0, totalDays - fetched);
		if (source === "cache") {
			return {
				label: "Served from cache",
				detail: `${totalDays} day${totalDays === 1 ? "" : "s"} already present — no E-REDES call`,
				color: "cache",
				fetched,
				cached,
			};
		}
		if (source === "api") {
			return {
				label: "Fetched from E-REDES",
				detail: `${fetched} day${fetched === 1 ? "" : "s"} pulled from E-REDES`,
				color: "api",
				fetched,
				cached,
			};
		}
		return {
			label: "Partially fetched",
			detail: `${fetched} day${fetched === 1 ? "" : "s"} from E-REDES · ${cached} from cache`,
			color: "partial",
			fetched,
			cached,
		};
	});

	async function handleFetch() {
		if (!startDate || !endDate || fetching) return;
		fetching = true;
		fetchError = null;

		try {
			const params = new URLSearchParams({ start: startDate, end: endDate });
			const response = await fetch(`/api/consumption?${params}`);
			if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
			const result = (await response.json()) as ConsumptionResponse;
			lastResult = result;

			const counts: Record<string, number> = {};
			for (const r of result.readings) {
				const day = r.timestamp.slice(0, 10);
				counts[day] = (counts[day] ?? 0) + 1;
			}
			onFetched?.(result, counts);
		} catch (e) {
			fetchError = e instanceof Error ? e.message : String(e);
			lastResult = null;
		} finally {
			fetching = false;
		}
	}
</script>

<section class="fetch-panel" aria-label="Fetch readings from E-REDES">
	<h2>Fetch from E-REDES</h2>
	<p class="panel-hint">
		Pulls the selected range. Days already cached are served locally; only missing or partial days hit
		E-REDES. The calendar above updates live when new days arrive.
	</p>

	<div class="controls">
		<label>
			Start
			<input type="date" bind:value={startDate} />
		</label>
		<label>
			End
			<input type="date" bind:value={endDate} />
		</label>
		<button class="fetch-btn" onclick={handleFetch} disabled={fetching}>
			{#if fetching}
				<span class="spinner" aria-hidden="true"></span> Fetching…
			{:else}
				Fetch
			{/if}
		</button>
	</div>

	{#if fetching}
		<p class="status fetching" role="status">
			<span class="dot pulse"></span>
			Fetching {daysInRange(startDate, endDate)} day(s) — checking cache then E-REDES for missing days…
		</p>
	{:else if fetchError}
		<p class="status error" role="alert">Could not fetch: {fetchError}</p>
	{:else if lastResult && sourceMeta}
		<div class="result-card">
			<div class="result-header">
				<span class="badge {sourceMeta.color}">{sourceMeta.label}</span>
				<span class="count">{lastResult.count} readings</span>
			</div>
			<p class="result-detail">{sourceMeta.detail}</p>
			<p class="result-range">
				<code>{lastResult.startDate.slice(0, 10)} → {lastResult.endDate.slice(0, 10)}</code>
				· <code>{lastResult.cpe}</code>
			</p>

			{#if lastResult.fetchedDays.length > 0}
				<details class="fetched-details">
					<summary>Fetched days ({lastResult.fetchedDays.length})</summary>
					<ul>
						{#each lastResult.fetchedDays as day (day)}
							<li><code>{day}</code> <span class="from-eredes">← E-REDES</span></li>
						{/each}
					</ul>
				</details>
				{#if sourceMeta.cached > 0}
					<p class="cached-note">
						{sourceMeta.cached} day(s) in range were already cached and not re-fetched.
					</p>
				{/if}
			{:else}
				<p class="cached-note">All days in range were already cached — no E-REDES request was needed.</p>
			{/if}
		</div>
	{:else}
		<p class="status idle">Choose a date range and press Fetch.</p>
	{/if}
</section>

<style>
	.fetch-panel {
		max-width: 900px;
		margin-top: 1.5rem;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: #f9fafb;
	}

	.fetch-panel h2 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		font-weight: 650;
	}

	.panel-hint {
		margin: 0 0 1rem;
		color: #6b7280;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: end;
		margin-bottom: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}
	input {
		padding: 0.4rem 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.4rem;
		background: white;
	}

	.fetch-btn {
		padding: 0.5rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #2563eb;
		color: white;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.fetch-btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.fetch-btn:hover:not(:disabled) {
		background: #1d4ed8;
	}

	.spinner {
		width: 0.85rem;
		height: 0.85rem;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		display: inline-block;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.status {
		margin: 0;
		font-size: 0.85rem;
	}
	.status.fetching {
		color: #1e40af;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.status.error {
		color: #b91c1c;
	}
	.status.idle {
		color: #6b7280;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #3b82f6;
		display: inline-block;
	}
	.dot.pulse {
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(0.9);
		}
	}

	.result-card {
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
	}

	.result-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.badge {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.badge.cache {
		background: #dcfce7;
		color: #166534;
		border: 1px solid #86efac;
	}
	.badge.api {
		background: #dbeafe;
		color: #1e40af;
		border: 1px solid #93c5fd;
	}
	.badge.partial {
		background: #fef3c7;
		color: #92400e;
		border: 1px solid #fcd34d;
	}

	.count {
		font-size: 0.8rem;
		color: #4b5563;
		font-weight: 600;
	}

	.result-detail {
		margin: 0.5rem 0 0.25rem;
		font-size: 0.85rem;
		color: #374151;
	}

	.result-range {
		margin: 0;
		font-size: 0.75rem;
		color: #6b7280;
	}

	.fetched-details {
		margin-top: 0.6rem;
		font-size: 0.8rem;
	}
	.fetched-details summary {
		cursor: pointer;
		color: #1e40af;
		font-weight: 600;
	}
	.fetched-details ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
		columns: 2;
	}
	.fetched-details li {
		margin-bottom: 0.15rem;
	}
	.from-eredes {
		color: #2563eb;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.cached-note {
		margin: 0.5rem 0 0;
		font-size: 0.75rem;
		color: #6b7280;
	}
</style>
