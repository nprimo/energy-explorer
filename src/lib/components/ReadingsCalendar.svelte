<script lang="ts">
	type Props = {
		/** Meter point whose cached readings should be displayed. */
		cpe: string;
		register?: string;
		expectedReadingsPerDay?: number;
	};

	type CalendarResponse = {
		counts: Record<string, number>;
	};

	type DayStatus = "empty" | "partial" | "complete";
	type CalendarCell = {
		day: number;
		date: string;
		count: number;
		status: DayStatus;
	};

	let {
		cpe,
		register = "A+",
		expectedReadingsPerDay = 96,
	}: Props = $props();

	const today = new Date();
	const todayKey = formatDate(today);
	const expectedCount = $derived(Math.max(1, expectedReadingsPerDay));

	let viewYear = $state(today.getFullYear());
	let viewMonth = $state(today.getMonth());
	let readingCounts = $state<Record<string, number>>({});
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let requestNumber = 0;

	const monthLabel = $derived(
		new Date(viewYear, viewMonth, 1).toLocaleString("default", {
			month: "long",
			year: "numeric",
		}),
	);

	const calendarDays = $derived.by((): Array<CalendarCell | null> => {
		const firstOfMonth = new Date(viewYear, viewMonth, 1);
		const firstDay = firstOfMonth.getDay();
		const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: Array<CalendarCell | null> = Array(mondayOffset).fill(null);

		for (let day = 1; day <= daysInMonth; day++) {
			const date = formatDate(new Date(viewYear, viewMonth, day));
			const count = readingCounts[date] ?? 0;
			cells.push({ day, date, count, status: statusFor(count) });
		}

		return cells;
	});

	$effect(() => {
		// Reading these values here makes the request follow both month and CPE changes.
		const year = viewYear;
		const month = viewMonth;
		const selectedCpe = cpe.trim();
		const selectedRegister = register.trim() || "A+";
		void loadCounts(selectedCpe, selectedRegister, year, month);
	});

	function statusFor(count: number): DayStatus {
		if (count === 0) return "empty";
		return count >= expectedCount ? "complete" : "partial";
	}

	async function loadCounts(selectedCpe: string, selectedRegister: string, year: number, month: number) {
		const currentRequest = ++requestNumber;
		readingCounts = {};
		loadError = null;

		if (!selectedCpe) {
			loading = false;
			loadError = "A CPE is required.";
			return;
		}

		loading = true;
		const start = formatDate(new Date(year, month, 1));
		const end = formatDate(new Date(year, month + 1, 1));
		const params = new URLSearchParams({
			cpe: selectedCpe,
			register: selectedRegister,
			start,
			end,
		});

		try {
			const response = await fetch(`/api/readings/calendar?${params}`);
			if (!response.ok) {
				throw new Error(`${response.status}: ${await response.text()}`);
			}

			const result = (await response.json()) as CalendarResponse;
			if (currentRequest === requestNumber) {
				readingCounts = result.counts;
			}
		} catch (error) {
			if (currentRequest === requestNumber) {
				loadError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (currentRequest === requestNumber) loading = false;
		}
	}

	function previousMonth() {
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear--;
		} else {
			viewMonth--;
		}
	}

	function nextMonth() {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear++;
		} else {
			viewMonth++;
		}
	}

	function formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
</script>

<section class="readings-calendar" aria-label={`Readings for ${cpe}`} aria-busy={loading}>
	<header class="calendar-header">
		<button class="nav-button" onclick={previousMonth} aria-label="Previous month">‹</button>
		<h2>{monthLabel}</h2>
		<button class="nav-button" onclick={nextMonth} aria-label="Next month">›</button>
	</header>

	<div class="legend" aria-label="Reading status legend">
		<span><i class="swatch complete"></i>Complete ({expectedCount})</span>
		<span><i class="swatch partial"></i>Partial</span>
		<span><i class="swatch empty"></i>No data</span>
	</div>

	{#if loadError}
		<p class="error" role="alert">Could not load readings: {loadError}</p>
	{/if}

	<div class="weekday-row" aria-hidden="true">
		{#each ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as weekday}
			<span>{weekday}</span>
		{/each}
	</div>

	<div class="calendar-grid">
		{#each calendarDays as cell, index (cell?.date ?? `empty-${index}`)}
			{#if cell}
				<div
					class="day-block {cell.status}"
					class:today={cell.date === todayKey}
					title={`${cell.date}: ${cell.count} of ${expectedCount} readings`}
					aria-label={`${cell.date}: ${cell.count === 0 ? "no data" : `${cell.count} of ${expectedCount} readings`}`}
				>
					<span class="day-number">{cell.day}</span>
					<span class="day-status">
						{#if cell.status === "complete"}
							Complete
						{:else if cell.status === "partial"}
							Partial
						{:else}
							No data
						{/if}
					</span>
					<span class="reading-count">{cell.count}/{expectedCount}</span>
				</div>
			{:else}
				<span class="calendar-placeholder"></span>
			{/if}
		{/each}
	</div>
</section>

<style>
	.readings-calendar {
		max-width: 720px;
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

	.nav-button {
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 0.4rem;
		background: #f3f4f6;
		color: #374151;
		font-size: 1.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.nav-button:hover {
		background: #e5e7eb;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1rem;
		color: #4b5563;
		font-size: 0.75rem;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 0.2rem;
	}

	.swatch.complete {
		background: #15803d;
	}

	.swatch.partial {
		background: #d97706;
	}

	.swatch.empty {
		background: #e5e7eb;
	}

	.error {
		margin: 0 0 1rem;
		color: #b91c1c;
		font-size: 0.8rem;
	}

	.weekday-row,
	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.weekday-row {
		margin-bottom: 0.35rem;
		color: #6b7280;
		font-size: 0.7rem;
		font-weight: 650;
		text-align: center;
	}

	.day-block {
		min-width: 0;
		min-height: 5rem;
		padding: 0.45rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		text-align: center;
	}

	.day-block.complete {
		border-color: #86efac;
		background: #dcfce7;
		color: #166534;
	}

	.day-block.partial {
		border-color: #fcd34d;
		background: #fef3c7;
		color: #92400e;
	}

	.day-block.empty {
		border-color: #e5e7eb;
		background: #f9fafb;
		color: #6b7280;
	}

	.day-block.today {
		box-shadow: 0 0 0 2px #2563eb;
	}

	.day-number {
		font-size: 0.9rem;
		font-weight: 700;
	}

	.day-status {
		font-size: 0.65rem;
		font-weight: 600;
	}

	.reading-count {
		font-size: 0.65rem;
		opacity: 0.85;
	}

	.calendar-placeholder {
		min-height: 5rem;
	}

	@media (max-width: 520px) {
		.readings-calendar {
			padding: 0.65rem;
		}

		.calendar-grid,
		.weekday-row {
			gap: 0.2rem;
		}

		.day-block {
			min-height: 4.25rem;
			padding: 0.25rem;
		}

		.day-status {
			font-size: 0.58rem;
		}
	}
</style>
