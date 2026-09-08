# Contract model and invoice estimation

Status: proposal — no code changed. Rev 2 — incorporates review feedback (2026-09-08).

## Objective

Answer two questions with the data we already cache:

1. **What is my invoice so far?** — the running cost of the current invoice period, before tax.
2. **What could it be if I changed my contract?** — the same readings priced under a candidate contract, side by side with the current one.

The base unit stays the **Reading** (15 minutes). Every 15-minute period is priced independently; totals are sums. Tax (IVA) is out of scope for now — it can only be computed per invoice period, never per 15-minute period, because the 6%/23% tiers depend on cumulative kWh within the period.

## Settled vocabulary

- **Cycle** keeps its existing meaning: the counting cycle (ciclo de contagem: diário/semanal). Never "billing cycle".
- **Invoice period** — the billing window (promoted from future scope in CONTEXT.md to current).
- **Contract anchor date** — the Lisbon calendar date the contract's billing cycle started. Every invoice period is derived from it; the day-of-month is derived, never stored (Stripe's `billing_cycle_anchor` model).
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
  contractAnchorDate: string; // "YYYY-MM-DD", Lisbon — the date the billing cycle started
  contractedPowerKva: number;
  powerPricePerDay: number; // €/day per kVA (covers network-access power charge)
  validFrom: string; // "YYYY-MM-DD", Lisbon date
  validTo: string | null; // null = still in force
  pricing:
    | { kind: "fixed"; pricesPerBilledPeriod: Record<BilledPeriod, number> } // €/kWh
    | { kind: "indexed"; formula: IndexationFormula }; // reserved — shape unspecified until phase 4
};
```

- **Effective-dated** like tariff versions: a contract switch is a new row with `validFrom` = the switch date. History is kept, so past invoices can be recomputed with the contract that was actually in force.
- **Contract change mid-period (settled):** each contract applies only to the slice of the invoice period where it is active. The calculator splits the period at validity boundaries; every Reading is priced by the contract in force at its own timestamp; the power term is pro-rated by active days per contract. No reading is ever priced by a contract that was not in force at that moment.
- **Prices stored as integers** in 10⁻⁴ €/kWh (see "Price precision evidence" below). `BilledPeriod` values reuse `periods.ts` (`unico`, `vazio`, `fora de vazio`, `cheias`, `ponta`). Power prices use the same 10⁻⁴ € integer per day per kVA.

### Price precision evidence

- Retail source of truth: ERSE's offer-simulator CSV (and commercializers' standard offer sheets, which it mirrors) publishes energy prices in **€/kWh with four decimals** — e.g. `0,1548` (see `docs/erse-periodic-pull.md`). Integer 10⁻⁴ €/kWh stores that **exactly**, with no float drift.
- Market source of truth: OMIE public files publish prices in **EUR/MWh** (see OMIE/OMIClear file-format specs; the public day-ahead files use two decimals, e.g. `72,34`). When phase 4 lands, OMIE prices keep their **native €/MWh unit in their own table** and are converted only at calculation time — 2 decimals in €/MWh = 10⁻⁵ €/kWh, finer than our contract-price unit, so nothing is lost.
- So: contract prices → integer 10⁻⁴ €/kWh; OMIE prices (future) → native €/MWh in a separate table. One unit per source of truth, conversion at the calculator boundary.

### Invoice period

- Half-open `[start, end)` in **Europe/Lisbon local time** (start at 00:00 local on the anchor day), converted to true UTC for storage and querying (ADR 0002).
- **Anchor rule (settled):** periods are derived from the contract's **anchor date**, monthly. The day-of-month is the anchor date's own day; when a month does not have it (anchors 29–31), the period starts on that month's **last day** — the closest existing date. Example: anchor Dec 31, 2025 → periods start Dec 31, Jan 31, **Feb 28** (29 in leap years), Mar 31, Apr 30. The anchor's day is used again as soon as the month has it — no permanent drift. This matches Stripe's billing-cycle anchor rule ("If a month does not have the anchor day, it will be billed on the last day of the month"). Edge case for the tests: anchor **Feb 29** clamps to Feb 28 in non-leap years.
- **Partial first period:** a contract that starts mid-cycle (switch date before its first anchor occurrence) bills a partial first period — like Stripe prorating from subscription start to the anchor. The "each contract bills only within its validity" rule already implies this; it is a named, tested case, not an error.
- **Current invoice period** = the latest period whose start is ≤ now. Its end is a projection, not a bill.

### Cost calculator (pure module, no DB)

New `src/lib/contract/` module, mirroring the shape of `src/lib/tariff/`:

```ts
type CostReading = {
  ts: string;      // UTC ISO-8601, mirrors the readings table (register A+ only)
  valueWh: number;
  status: string;  // "real" / "estimated" / ... — feeds the coverage layer
};

type InvoicePeriodRange = { start: string; end: string }; // UTC ISO, half-open [start, end)

computeInvoiceCost(
  readings: readonly CostReading[],
  contracts: readonly Contract[],  // effective-dated; sliced at validity boundaries
  period: InvoicePeriodRange,     // produced by invoice-period.ts (e.g. currentInvoicePeriod)
): InvoiceCost;

type InvoiceCost = {
  periodStart: string; periodEnd: string;
  totalEur: number;              // pre-tax, energy + power
  energy: { totalEur, perBilledPeriod: { billedPeriod, kwh, eur }[] };
  power: { totalEur, activeDaysPerContract: { contractId, days, eur }[] };
  coverage: { slotsWithData, slotsExpected, estimatedReadings }; // honesty layer
  tariffVersionIds: string[];    // for invoice-discrepancy debugging (ADR 0004)
};
```

**Energy term**, per Reading (the simplified formula from the request):

1. Layer 1: `resolveRegulatedPeriod(ts, countingCycle)` — existing code, using the contract in force at that reading's timestamp.
2. Layer 2: `toBilledPeriod(regulated, option)` — existing code. Simples skips layer 1 entirely.
3. Energy price: fixed → from the contract's `pricesPerBilledPeriod`.
4. Cost = `valueWh / 1000 × price`.

**Power term:** `powerPricePerDay × contractedPowerKva × active days`, split per contract across validity boundaries. Straightforward by design — it is a fixed daily amount, independent of readings.

**Extension point for indexed pricing (not implemented):** the calculator resolves a Reading's price through a single internal step (step 3 above). Phase 4's indexed pricing plugs in there — however the contract's **Indexation formula** defines it — without touching the summation, splitting, or coverage logic. The `pricing` union already reserves the variant, so it is an added variant, not a breaking change.

### What-if comparison

No new model: the same pure calculator with a **candidate contract passed as a payload** (nothing persisted). Response = one `InvoiceCost` per contract (current + candidates) + deltas. This stays honest because both use the exact same readings. The `/invoice` page form sends candidate contracts directly — contract rows in the DB are never written from the UI in v1.

### Coverage (the honesty layer)

"Invoice so far" is a **lower bound** when slots are missing (ADR 0001 spirit: never extrapolate). The response always reports slots with data vs expected slots, and how many readings were estimated (estimated readings are **included** in totals, flagged — settled). The UI must show this; a silent underestimate reads as a real invoice.

## What stays out of scope (v1)

- **IVA tiers** (6% on first 200 kWh, 23% on the rest, applied per invoice period) — deferred by the request. The calculator returns pre-tax totals so tax can be layered later without rework.
- **OMIE ingestion and indexed pricing** — phase 4, needs its own pull plan (like `docs/erse-periodic-pull.md`). Interface reserved as described above.
- **Other fixed terms** — monthly fixed fees, discounts, reimbursements. The power term is in; everything else that a real invoice carries stays out until the core settles.
- **Contract CRUD UI** — v1 seeds rows via SQL by hand.
- **ERSE offer catalogue integration** — candidates are entered by hand in v1; pulling real offers is the separate ERSE plan.

## Phases

1. **Pure domain module** — `src/lib/contract/`: types, `invoice-period.ts` (anchor-date arithmetic: monthly derivation, 29/30/31 clamping, Feb-29 anchor, partial first period), `cost.ts` (energy + power, contract splitting). Unit tests: anchor clamping across February/leap years/30-day months, partial first period on contract switch, DST boundary periods, contract switch mid-period (readings and power days split correctly), simples/bi/tri on the same fixture readings, coverage reporting. No DB, no UI.
2. **Persistence + current invoice** — migration `0002_contracts.sql`, read-only contract repo, SQL seed of the current contract, `GET /api/invoice?cpe=...` returning the running `InvoiceCost` for the current invoice period.
3. **What-if view** — `POST /api/invoice/compare` (candidate contracts in the body) + an `/invoice` route: current-invoice card, candidate form, comparison table with deltas and the coverage warning.
4. **Later, separate plans** — OMIE pull + indexed pricing; IVA tiers; other fixed terms; ERSE offers as candidate source.

## Documentation to update

- CONTEXT.md: add **Contract**, **Contract anchor date**, **Energy price**, **Indexation formula** (reserved); promote **Invoice period** from future scope to current.
- data-flow.md: contract storage row; open question "Does the tariff comparison need invoice periods?" gets answered (yes, via the contract's anchor date).

## Remaining open questions

1. Are ERSE CSV energy prices pre-tax? (Assumed yes; verify when wiring the offers plan.)
2. Indexed formula details — deliberately deferred to the phase 4 OMIE plan; the variant's shape stays unspecified until then.
