# Tariff calendar: effective-dated checked-in code, standalone module

The app needs to classify every Reading by tariff period (ERSE "período horário") for visualization and future cost calculations. The brackets come from ERSE directives and change rarely but do change (2009, 2024, and a new set approved by Diretiva n.º 3/2026, effective 2027). Sources and legal chain: `docs/periodos-horarios-source.md`.

**Decision**:

- Tariff period definitions live in a **standalone module** (`tariff calendar`), not inside a billing engine. A future cost calculator consumes it; the visualization consumes it directly.
- The data is **checked-in TypeScript, effective-dated**: each bracket set is a version with an id (e.g. `diretiva-1-2026`), a `sourceUrl` pointing at the directive PDF, and `validFrom`/`validTo`. No runtime fetching from ERSE. If SQL aggregation ever needs it, the module can be mirrored into a SQLite table, but the module stays the editing surface.
- Brackets are stored over the **directive's own four regulated periods** (ponta, cheias, vazio normal, super vazio), with the directive's Portuguese names as canonical values. The collapse into billed periods (vazio, fora de vazio, único) is code, not data: bi → vazio = vazio normal + super vazio, fora de vazio = cheias + ponta; tri → separate cheias and ponta; simples → único.
- **Two-layer classification**: layer 1 (Reading + cycle → regulated period) is contract-free except for the cycle; layer 2 (regulated period + option → billed period) is where contract knowledge enters. Simples contracts have no cycle and never reach layer 1.
- The classification result **carries the version id** for debugging invoice/cost discrepancies.

**Rationale**:

- Invoices are historical: recalculating a past invoice must use the brackets in force at that time. Effective-dating is the essential property; the storage engine is not.
- Bracket data changes about once per decade. A checked-in module is git-reviewable, typed, testable, offline-friendly, and fits the local-first model; runtime PDF scraping in the pricing path is fragile and untestable.
- The visualization needs classification without any user contract. Fusing classification into a billing engine would force contract knowledge where it is not needed.
- Storing the four regulated periods (instead of per-option labeled brackets) matches the directive's own structure and avoids duplicating brackets across bi/tri with drift.
- The cycle (diário/semanal) is the minimum contract knowledge classification legitimately needs: the same instant classifies differently under diário vs semanal.

**Consequences**:

- Renewal is a manual, yearly task (mid-November to mid-February, when ERSE publishes tariff directives). See the renewal checklist in `docs/periodos-horarios-source.md`. Bracket changes are preceded by an ERSE public consultation (CP) — that is the early-warning signal.
- The 2027 rollout is per-meter (July–December 2027), so version selection by date alone is insufficient for BTN from mid-2027. The classifier must accept a version override per user until the rollout completes.
- The holiday rule (how national holidays classify for BTN ciclo semanal) is still unverified against the directive text; it will be stored as data per version so fixing it is a data edit, not a code change.
- DST fall-back days (last Sunday of October) repeat one hour in wall-clock terms. Working rule until verified against actual invoice behaviour: classify each occurrence by its own wall-clock label. Related: ADR 0003 hypothesizes E-REDES timestamps mark the end of each 15-min slot — the slot anchor decision must be settled before implementing (one conversion point in the resolver).
- Bracket boundaries in all directives so far fall on quarter-hours, so a 15-min slot never straddles two brackets. A test should assert this per version so a future directive that breaks the invariant fails loudly instead of mispricing silently.
