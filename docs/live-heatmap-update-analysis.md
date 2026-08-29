# Live update for YearlyCalendarHeatmap — options analysis

## Context

- `YearlyCalendarHeatmap.svelte` shows per-day availability by querying `GET /api/readings/calendar?cpe&register&start&end` once per month (12 requests per year). Colours: empty / partial / complete.
- Fetching new data happens via `GET /api/consumption?start&end` which goes through `ConsumptionGateway.get()` — it checks `readings` in SQLite, backfills missing/partial days via `ERedes.getConsumption`, upserts, and returns `{ rows, source, fetchedDays }`.
- Today the two flows are disconnected: after a fetch in `EnergyChart` (now removed), the heatmap keeps its stale `readingCounts` until the user changes year or reloads.
- Requirement (point 3): heatmap reflects newly fetched days _live_, without manual interaction. Also want a visual distinction between "just fetched from E-REDES" vs "already cached".

## What we already changed (points 1 & 2)

- Removed `EnergyChart` load visualization from `+page.svelte`. The page now is: heatmap + a lightweight fetch panel.
- `GET /api/consumption` now returns `fetchedDays: string[]` (alongside `source: cache|api|partial`) so the UI can say _which_ days hit E-REDES vs cache.
- `YearlyCalendarHeatmap` now accepts `highlightDays` and `incrementalCounts` props + shows "Fetched from E-REDES" in tooltip and a banner for the current year.
- `+page.svelte` owns the fetch, computes `countsByDay` from the returned readings, and passes them as `incrementalCounts` for an instant patch.

This document evaluates the remaining options for keeping the heatmap in sync — from cheapest to most complete — and recommends a path.

---

## Option A — Parent-driven incremental patch (implemented)

**How:** `+page.svelte` after `fetch("/api/consumption")` groups `readings` by `YYYY-MM-DD`, builds `Record<string, number>`, and passes it as `incrementalCounts` to the heatmap. Heatmap has an `$effect` that merges relevant keys for `selectedYear` into `readingCounts`. `highlightDays` (=== `fetchedDays`) drives tooltip/banner highlight, cleared after ~30s.

```svelte
// +page.svelte
const counts: Record<string, number> = {};
for (const r of result.readings) counts[r.timestamp.slice(0,10)] = (counts[...] ?? 0)+1;
incrementalCounts = counts;
highlightDays = [...result.fetchedDays];
```

```svelte
// YearlyCalendarHeatmap.svelte
$effect(() => {
  const patch = incrementalCounts;
  if (!Object.keys(patch).length) return;
  readingCounts = { ...readingCounts, ...relevantForSelectedYear(patch) };
});
```

**Pros**

- Zero extra network requests — uses data already returned by the fetch.
- Instant (< 1 frame) visual feedback; cells flip from empty/partial to complete immediately.
- Minimal code, pure Svelte 5 runes, no new endpoint, no global state.
- Clear E-REDES vs cache indicator via `fetchedDays` + highlight.

**Cons**

- Only covers fetches initiated _on the same page_ in the same tab. External writers (cron, another tab, direct DB insert) are invisible.
- Optimistic on counts: assumes the fetch response is authoritative. If the DB has extra partial rows not returned (e.g., different register), counts could diverge — mitigated by falling back to a full reload on next year change.

**When to use:** default for local, user-initiated pulls. This is what we ship now.

---

## Option B — Full reload via `refreshKey`

**How:** Parent holds `refreshKey: number` and increments it after a fetch. Heatmap's `$effect` depends on `refreshKey` and re-runs `loadYear()` (12 calendar requests). Can be combined with A: patch instantly, then reload in background for correctness.

```svelte
$effect(() => { void refreshKey; void loadYear(...); })
```

**Pros**

- Authoritative — re-reads DB, handles DST edge cases (96 vs 100/92 readings on DST days) without client-side counting.
- Reuses existing endpoint, no new API.

**Cons**

- 12 HTTP requests per refresh, ~50–200 ms each. Flash of "Loading…" badge.
- Still only reacts to local parent increments, not external writers.

**When to use:** as a correctness fallback after A, or when `fetchedDays` spans multiple years.

---

## Option C — Shared Svelte store

**How:** Create `src/lib/stores/readings.ts` with `writable<{ counts: Record<string,number>, fetchedDays: string[], version: number }>` or a Svelte 5 `createContext` rune. Both fetch panel and heatmap subscribe. Fetch writes, heatmap reacts.

**Pros**

- Decouples components — any component can trigger a fetch or listen, without prop drilling.
- Easy to add multiple heatmaps (yearly + monthly) that stay in sync.

**Cons**

- Still in-memory, single-tab. Same external-writer blind spot as A/B.
- Adds indirection for a page that currently has only one heatmap.

**When to use:** if we keep `ReadingsCalendar` alongside `YearlyCalendarHeatmap` or add more consumers.

---

## Option D — SvelteKit `invalidate` / `depends`

**How:** Move calendar data loading into `+page.server.ts` `load()` with `depends('app:readings')`. Client does `invalidate('app:readings')` after fetch. SvelteKit re-runs `load` and pushes new `data`.

**Pros**

- Idiomatic SvelteKit, leverages built-in cache invalidation.
- Works with SSR.

**Cons**

- Requires restructuring: calendar currently fetches client-side month-by-month; moving to server means either returning a whole year (heavier) or still doing 12 fetches via `fetch` in `load`.
- Still needs a trigger — `invalidate` must be called by the fetcher, so same local-only coverage unless paired with polling/SSE.

**When to use:** if we want server-rendered initial calendar or to unify data loading.

---

## Option E — Polling

**How:** Heatmap `setInterval(() => loadYear(...), 30_000)` or poll `/api/readings/calendar` for the visible year.

**Pros**

- Catches external writers (cron that backfills nightly, another tab) without server push.
- Trivial to implement.

**Cons**

- Wasteful (12 requests × poll frequency), delayed (up to poll interval), battery unfriendly.
- No clear E-REDES vs cache provenance — just eventual consistency.

**When to use:** cheap fallback for multi-tab, or as a complement to A when background jobs exist.

---

## Option F — Server-Sent Events / WebSocket (complete)

**How:** Add `GET /api/readings/updates` as an SSE endpoint. Server watches SQLite (via `better-sqlite3` trigger, file watcher, or simply emits after each `ReadingsRepo.upsert`) and pushes `{ day, count }` or `fetchedDays` events. Heatmap opens `new EventSource("/api/readings/updates?cpe=...")` and patches `readingCounts` live.

```
Client                    Server
  |  EventSource ----------->|  (subscribe cpe)
  |<-- event: {day,count} ---|  (after ERedes fetch or cron)
  |  patch readingCounts     |
```

**Pros**

- Covers all writers: user fetch, nightly ERSE/ERedes cron, other tabs (via server broadcast).
- Low latency, efficient (one long-lived connection vs polling).
- Can carry provenance: `source: "eredes"` vs `"cache"` per day, so highlight is accurate.

**Cons**

- Most complex: needs SSE infrastructure, connection management, reconnection, auth filtering by CPE, and a way to detect DB changes (can't `LISTEN/NOTIFY` in SQLite — need app-level emit).
- Requires `better-sqlite3` hook or Effect pubsub.

**When to use:** when we add periodic background pulls (see `docs/erse-periodic-pull.md` and `todo.md` "have live update — implement pubsub") or multi-user.

**Sketch:**

```ts
// src/routes/api/readings/updates/+server.ts
export const GET: RequestHandler = async ({ url }) => {
  const cpe = url.searchParams.get("cpe");
  const stream = new ReadableStream(...);
  // subscribe to an Effect Hub / Node EventEmitter that ReadingsRepo.upsert publishes to
};
```

---

## Option G — Custom DOM event / callback

**How:** Heatmap exposes `export function refresh()` or dispatches `on:readingsUpdated`. Parent does `heatmapRef.refresh()` or `dispatch("fetched", { fetchedDays })`.

**Pros**

- Explicit, no global state.

**Cons**

- Imperative, couples parent to child ref (`bind:this`), harder to test.
- Same local-only coverage. Not better than props.

---

## Recommendation

1. **Ship A (incremental patch + highlight) now** — it's done. It gives the clear "E-REDES vs cache" indicator asked for in point 2 and satisfies point 3 for the common case (user fetches on the same page). No extra requests, instant feedback, tooltip + banner make provenance obvious.

2. **Keep B as a one-liner fallback**: if `fetchedDays` spans years or counts look suspicious, increment `heatmapRefreshKey` to force a full reload. Currently `heatmapRefreshKey` is wired but not auto-bumped; we can enable it with `heatmapRefreshKey++` after a fetch if we want authoritative reconciliation (cost: 12 requests). Keep it opt-in.

3. **When background pulls or multi-tab matter, add F (SSE) + E (polling fallback)**. Steps:
   - Introduce an Effect `Hub` or `EventEmitter` in `ReadingsRepo` that emits `ReadingsUpdated { cpe, day, count }` after `upsert`.
   - Add `GET /api/readings/updates` SSE route that filters by `cpe` and streams JSON events.
   - Heatmap subscribes on mount, patches `readingCounts`, and sets `highlightDays` from events with `source: "eredes"`.
   - Keep polling every 60s as fallback when `EventSource` disconnects.

This staged path keeps the current change small and reversible, while leaving a clear upgrade to true pubsub when the roadmap ("have live update — implement pubsub logics") becomes priority.

---

## Visual indicator already implemented

- **Heatmap cell colours**: `#e5e7eb` empty, `#fbbf24` partial, `#22c55e` complete — same as before, now with tooltip "Fetched from E-REDES" for highlighted days.
- **Fetch panel badge**: `Served from cache` (green), `Fetched from E-REDES` (blue), `Partially fetched` (amber) + detail line "X days from E-REDES · Y from cache" + expandable list of fetched `YYYY-MM-DD`.
- **Fresh banner in heatmap**: "3 days just fetched from E-REDES — 2024-03-01, 2024-03-02, …" for the visible year, fades after 30s.

No load curve is rendered anymore; `EnergyChart.svelte` is kept in repo but not imported.
