# Contract model and cost estimation

Status: plan — Rev 3 (2026-09-08). Simplified scope: **no invoice periods** and **pre-tax costs only**. Costs are computed over any analysis period, not per billing month. The code written under Rev 2 still contains invoice-period logic (`src/lib/contract/invoice-period.ts`, `contractAnchorDate`) that this revision removes.

## Objective

Answer two questions with the data we already cache:

1. **What did my electricity cost over a period?** — pre-tax cost of any analysis range (day, week, month, quarter, year) from the cached readings.
2. **What could it cost under a different contract?** — the same readings priced under a candidate contract, side by side with the current one.

The base unit stays the **Reading** (15 minutes). Every 15-minute period is priced independently; totals are sums. Totals are always **pre-tax** — tax (IVA) is out of scope.

### Why no invoice period (settled)

For a low-voltage consumer, the interesting unit of comparison is the **quarter or the year**, not the billing month. A single month is not representative of a year: seasonal behaviour reshapes the curve profile — AC runs by day in summer, heating runs at night in winter — so consumption per tariff period shifts with the season. Since tax is also out of scope, there is nothing left that requires a per-invoice-period computation. Costs are computed over the same **analysis Period** used everywhere else in the app; comparing like-for-like ranges (e.g. January vs January, or full years) is the user's job, supported by any range query.

Consequence: the contract needs no **anchor date**, and all monthly-derivation arithmetic (day 29–31 clamping, Feb-29 anchors, partial first periods) is gone.

## Settled vocabulary

- **Cycle** keeps its existing meaning: the counting cycle (ciclo de contagem: diário/semanal). Never "billing cycle".
- **Cost** — pre-tax cost over an analysis range. Avoid "invoice"/"bill": the app never produces a real bill.
- **Energy price** — the €/kWh value per billed period (never bare "tariff").
- **Indexation formula** — reserved term: how an indexed contract derives its energy price. Deliberately unspecified until the phase 4 OMIE plan.

## Domain model

### Contract (stored in SQLite, migration `0002_contracts.sql`)

User data, so it lives in the DB (unlike the checked-in tariff brackets, which are public data — ADR 0004 logic). In v1 there is **no CRUD UI**: rows are inserted directly via SQL, and the repo is read-only. This keeps the data shape free to evolve while we play with results.

```ts
type Contract = {
  id: string;
  cpe: string;
  option: "simples" | "bi-horario" | "tri-horario";
  countingCycle: "diario" | "semanal" | null; // null when simples
  contractedPowerKva: number;
  powerPricePerDay: number; // €/day per kVA (covers network-access power charge)
  validFrom: string; // "YYYY-MM-DD", Lisbon date
  validTo: string | null; // null = still in force
  pricing:
    | { kind: "fixed"; pricesPerBilledPeriod: Record<BilledPeriod, number> } // €/kWh
    | { kind: "indexed"; formula: IndexationFormula }; // reserved — shape unspecified until phase 4
};
```

- **Effective-dated** like tariff versions: a contract switch is a new row with `validFrom` = the switch date. History is kept, so past costs can be recomputed with the contract that was actually in force.
- **Contract change mid-range (settled):** every Reading is priced by the contract in force at its own timestamp; the power term is pro-rated by active days per contract across validity boundaries. No reading is ever priced by a contract that was not in force at that moment.
- **Prices stored as integers** in 10⁻⁴ €/kWh (see "Price precision evidence" below). `BilledPeriod` values reuse `periods.ts` (`unico`, `vazio`, `fora de vazio`, `cheias`, `ponta`). Power prices use the same 10⁻⁴ € integer per day per kVA.

### Price precision evidence

- Retail source of truth: ERSE's offer-simulator CSV (and commercializers' standard offer sheets, which it mirrors) publishes energy prices in **€/kWh with four decimals** — e.g. `0,1548` (see `docs/erse-periodic-pull.md`). Integer 10⁻⁴ €/kWh stores that **exactly**, with no float drift.
- Market source of truth: OMIE public files publish prices in **EUR/MWh** (see OMIE/OMIClear file-format specs; the public day-ahead files use two decimals, e.g. `72,34`). When phase 4 lands, OMIE prices keep their **native €/MWh unit in their own table** and are converted only at calculation time — 2 decimals in €/MWh = 10⁻⁵ €/kWh, finer than our contract-price unit, so nothing is lost.
- So: contract prices → integer 10⁻⁴ €/kWh; OMIE prices (future) → native €/MWh in a separate table. One unit per source of truth, conversion at the calculator boundary.

### Cost range

- Half-open `[start, end)` in **true UTC** (ADR 0002), same shape as every other range query in the app. Displayed and reasoned about in Europe/Lisbon local time, like all analysis periods.
- There is no "current period" and no projection: the range is always explicit. The API defaults to the range of available readings when `from`/`to` are omitted.

### Cost calculator (pure module, no DB)

New `src/lib/contract/` module, mirroring the shape of `src/lib/tariff/`:

```ts
type CostReading = {
  ts: string;      // UTC ISO-8601, mirrors the readings table (register A+ only)
  valueWh: number;
  status: string;  // "real" / "estimated" / ... — feeds the coverage layer
};

type CostRange = { start: string; end: string }; // UTC ISO, half-open [start, end)

computeCost(
  readings: readonly CostReading[],
  contracts: readonly Contract[],  // effective-dated; sliced at validity boundaries
  range: CostRange,                // any analysis range, e.g. a quarter or a full year
): CostEstimate;

type CostEstimate = {
  rangeStart: string; rangeEnd: string;
  totalEur: number;              // pre-tax, energy + power
  energy: { totalEur, perBilledPeriod: { billedPeriod, kwh, eur }[] };
  power: { totalEur, activeDaysPerContract: { contractId, days, eur }[] };
  coverage: { slotsWithData, slotsExpected, estimatedReadings }; // honesty layer
  tariffVersionIds: string[];    // for cost-discrepancy debugging (ADR 0004)
};
```

(Renamed from Rev 2's `computeInvoiceCost`/`InvoiceCost`/`InvoicePeriodRange` — the "invoice" framing is gone along with the invoice period.)

**Energy term**, per Reading (the simplified formula from the request):

1. Layer 1: `resolveRegulatedPeriod(ts, countingCycle)` — existing code, using the contract in force at that reading's timestamp.
2. Layer 2: `toBilledPeriod(regulated, option)` — existing code. Simples skips layer 1 entirely.
3. Energy price: fixed → from the contract's `pricesPerBilledPeriod`.
4. Cost = `valueWh / 1000 × price`.

**Power term:** `powerPricePerDay × contractedPowerKva × active days`, split per contract across validity boundaries. Straightforward by design — it is a fixed daily amount, independent of readings.

**Extension point for indexed pricing (not implemented):** the calculator resolves a Reading's price through a single internal step (step 3 above). Phase 4's indexed pricing plugs in there — however the contract's **Indexation formula** defines it — without touching the summation, splitting, or coverage logic. The `pricing` union already reserves the variant, so it is an added variant, not a breaking change.

### What-if comparison

No new model: the same pure calculator with a **candidate contract passed as a payload** (nothing persisted). Response = one `CostEstimate` per contract (current + candidates) + deltas. This stays honest because both use the exact same readings. The `/cost` page form sends candidate contracts directly — contract rows in the DB are never written from the UI in v1.

### Coverage (the honesty layer)

A cost over a range with missing slots is a **lower bound** (ADR 0001 spirit: never extrapolate). The response always reports slots with data vs expected slots, and how many readings were estimated (estimated readings are **included** in totals, flagged — settled). The UI must show this; a silent underestimate reads as a real cost.

## What stays out of scope (v1)

- **Tax (IVA)** — permanently out of the calculator; totals are pre-tax so a tax layer can be added later without rework.
- **OMIE ingestion and indexed pricing** — phase 4, needs its own pull plan (like `docs/erse-periodic-pull.md`). Interface reserved as described above.
- **Other fixed terms** — monthly fixed fees, discounts, reimbursements. The power term is in; everything else that a real invoice carries stays out until the core settles.
- **Contract CRUD UI** — v1 seeds rows via SQL by hand.
- **ERSE offer catalogue integration** — candidates are entered by hand in v1; pulling real offers is the separate ERSE plan.

## Phases

1. **Pure domain module** — `src/lib/contract/`: types + `cost.ts` (energy + power, contract splitting over an arbitrary range). Delete `invoice-period.ts` and its tests. Unit tests: contract switch mid-range (readings and power days split correctly), simples/bi/tri on the same fixture readings, coverage reporting, range boundaries (DST transitions included). No DB, no UI.
2. **Persistence + range endpoint** — migration `0002_contracts.sql` stays as originally applied and migration `0003_drop_contract_anchor_date.sql` drops `contract_anchor_date` (keeps migration history truthful for existing DBs; fresh DBs create then drop it). Read-only contract repo, SQL seed of the current contract, `GET /api/cost?cpe=...&from=&to=` returning the pre-tax `CostEstimate` for the range (defaults to the available-reading range).
3. **What-if view** — `POST /api/cost/compare` (candidate contracts in the body) + a `/cost` route: cost card for the selected range, candidate form, comparison table with deltas and the coverage warning.
4. **Later, separate plans** — OMIE pull + indexed pricing; other fixed terms; ERSE offers as candidate source.

## Documentation to update (done in this revision)

- CONTEXT.md: **Invoice period** and **Contract anchor date** removed; **Billing domain** renamed to **Cost domain**; added **Cost**; **Contract** no longer lists an anchor date.
- data-flow.md: contract row no longer mentions anchor dates; the invoice-period open question is closed as "dropped".

## Remaining open questions

1. Are ERSE CSV energy prices pre-tax? (Assumed yes; verify when wiring the offers plan.)
2. Indexed formula details — deliberately deferred to the phase 4 OMIE plan; the variant's shape stays unspecified until then.
