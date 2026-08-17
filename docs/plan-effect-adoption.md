# Effect adoption plan

Status: proposal — no code changed. Review before deciding.

Pinned version: **`effect@beta`** (currently `4.0.0-beta.103`) — v4 release line. Imports below use the v4 API: single `Schema` export, `Schema.Class` consolidation, `Schema.TaggedError`, `Layer.Service`. Do not pin to `latest` (v3) — surface drift.

## Current state recap

- Server: SvelteKit endpoint `GET /api/consumption` (~85 LOC).
- DB: `better-sqlite3` (sync). DAO at `src/lib/server/db/readings.ts` with hand-written SQL + UPSERT.
- API client: `src/lib/server/eredes.ts`. Bare `fetch`, manual response typing via TS interfaces (`RawResponse`) but **no runtime validation**.
- Error model: 3 custom `Error` subclasses (`ERedesAuthenticationError` / `ERedesConnectionError` / `ERedesError`). Try/catch boilerplate at the endpoint.
- One provider (E-Redes). Schema has a `register` column already ("A+" / "A-") hinting at future expansion.
- Dependency wiring: `new ERedesClient(aat)` constructed inline in the endpoint.

## Two questions to answer

1. **Effect Schema** at (a) the SQL boundary and (b) the E-Redes HTTP boundary — worth it?
2. **Provider abstraction** — design now for E-Redes as one of N future sources?

---

## 1. Effect Schema at the SQL boundary

### What we have today

```ts
return db.prepare(GET_RANGE_SQL).all({ ... }) as ReadingRow[];
```

- `all()` returns `unknown[]`. We `as`-cast it. If SQLite returns a row with `value_wh` as a string (sqlite is dynamically typed — a future migration bug could do this), it propagates silently.
- UPSERT bind parameters (`@cpe`, `@register`, ...) are unchecked. Wrong key name = silent no-op or runtime error.

### What Effect Schema adds

- Decoded/encoded with explicit failure modes. `Schema.decodeUnknown(Schema.struct({...}))(raw)` returns either typed row or `ParseError` with a path (`/value_wh` expected number, got string). No more blind cast.
- Schema becomes the **single source of truth** for the `readings` row shape. Migration SQL column types map to schema fields. Today the SQL DDL and the TS type drift independently.
- `@effect/sql` (or `@effect/sqlite`) integrates: declares a `Database` service, runs migrations, exposes repositories keyed by Schema. Bind parameters get type-checked against the schema at the call site.

### Cost

- New dep: `effect` + `@effect/sql` (Rust-bound DB layer). Bundle size matters less server-side.
- `better-sqlite3` is sync; `@effect/sql`-SQLite is async. Replaces the existing lib — non-trivial migration of the DAO file (small file, ~70 LOC, manageable).
- Learning curve: Schema APIs (`Schema.struct`, `Schema.decodeUnknownSync`).

### Verdict

**Worth it, even before multi-provider.** The SQL boundary is currently a silent-failure zone. The cost is one file rewrite and one dep. Risk is low because the surface is narrow.

---

## 2. Effect Schema at the E-Redes HTTP boundary

### What we have today

```ts
const data = (await response.json()) as RawResponse;
return this.parseResponse(cpe, data, ...);
```

- `RawResponse` is a structural TS type with optional fields. At runtime, nothing checks the shape.
- If E-Redes renames `Body.Result.utilitiesDevices` or sends an error envelope inside a `200` (already kind of happens with `"Success": false`), we silently return `readings: []`. Users see "0 readings" with no clue why.

### What Effect Schema adds

- A `RawResponseSchema` validated at the boundary. Surprises become typed `ParseError`s instead of silently empty arrays.
- `Schema.decodeUnknownEither(RawResponseSchema)(json)` — explicit Either, lose the `as` cast.
- Can attach a custom refinement: `Success: true` → `Body.Result.utilitiesDevices` must exist. Failures become a real error not "warning + empty array".
- Status-code-aware error effect: `Effect.tryCatchPromise` would map HTTP status to typed `ERedesAuthError | ERedesUpstreamError` — replaces the hand-rolled `ERedesAuthenticationError/etc` classes.

### Cost

- Define schemas for: raw response, load-curve group, reading. ~3 schemas.
- Today the `_parse_consumption_response` method does ad-hoc parsing. Replacing it with `Schema.decode(...) + Schema.transform(...)` is conceptually cleaner but more LOC until you cross ~3 endpoints.
- Effect Schema's type-level error messages can be cryptic on first contact.

### Verdict

**Worth it.** E-Redes is an external untyped API — exactly the case Schema is designed for. The current silent-empty-on-server-error behavior will bite.

---

## 3. Multi-provider abstraction

Two layers worth separating, regardless of Effect:

```
            ┌─── Provider (adaptor) ───┐         ┌── Repository (cache) ──┐
  external  │  E-Redes  Solar  Shelly  │  →  normalize  │  readings table  │
  source    │  OeInfo   OCPP   …       │  →  to common   │  UPSERT/SELECT    │
            └──────────────────────────┘     shape         └───────────────────┘
```

- **Provider** = "how do I fetch raw readings for (cpe, start, end) from source X?". One per upstream.
- **Repository** = "how do I persist and query the normalized `readings` row?". Single, source-agnostic.

### Proposed `Provider` contract

```ts
import { Schema } from "effect"; // v4: single namespace, no S.*
import { Effect } from "effect";

// Normalized reading — same shape as the DB row, minus inserted_at
export class ConsumptionReading extends Schema.Class<ConsumptionReading>("ConsumptionReading")({
  timestamp: Schema.String,
  valueWh: Schema.Number,
  status: Schema.String,
}) {}

export class ConsumptionData extends Schema.Class<ConsumptionData>("ConsumptionData")({
  cpe: Schema.String,
  register: Schema.String, // "A+", "A-"
  startDate: Schema.String,
  endDate: Schema.String,
  readings: Schema.Array(ConsumptionReading),
}) {}

// Provider tagged error channel
export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  reason: Schema.String,
  code: Schema.String, // "auth" | "rate_limit" | "upstream" | ...
}) {}

export interface Provider {
  readonly name: string;
  readonly register: "A+" | "A-";
  getConsumption(input: {
    cpe: string;
    startDate: Date;
    endDate: Date;
  }): Effect.Effect<ConsumptionData, ProviderError>;
}
```

### Layered wiring (Effect)

Each provider is a `Layer`. The endpoint asks for the union service `Providers` (registered by name). A small router picks `provider="eredes"` (or chooses by CPE / user config later).

```ts
export class ERedesProvider extends Effect.Service<ERedesProvider>()("Provider/Eredes", {
  effect: Effect.gen(function* () {
    const aat = yield* Config.secret("EREDES_AAT");
    return Provider.of({ name: "eredes", register: "A+", getConsumption: ... });
  }),
});
```

(v4 `Effect.Service` is the consolidated `Layer.Service` — Service-as-Layer pattern. Same idea, import from `Effect`.)

### Provider candidates this enables

| Source       | Protocol          | Notes                                             |
| ------------ | ----------------- | ------------------------------------------------- |
| E-Redes      | HTTP + aat cookie | current                                           |
| Shelly EM    | local HTTP        | sub-second granularity, no token dance; real-time |
| EDP / OeInfo | portal scrape     | annual consumption totals                         |
| OCPP (CSMS)  | WebSocket         | EV chargers as load                               |
| Manual CSV   | file upload       | ad-hoc backfill                                   |

All map to the same `ConsumptionData` → same `upsertReadings` → same `/api/consumption`. Front-end never needs to know.

### Cost

- Adds `effect` runtime dependency. Migrates DTOs to `Schema.Class`. Replaces current `throw`-based error path with `Effect.fail(ProviderError)`.
- Endpoint becomes ~10 LOC longer: builds Effect, runs it, maps `Effect.runPromise` back to `Response`.

### Verdict

**Adopt.** The `register` column already in the schema signals the intent. The user pattern "I want to add real-time Shelly data alongside daily E-Redes" is the obvious next step and would otherwise require endpoint/client branching.

---

## Adoption tiers

Pick one. Costs scale linearly.

### Tier A — Schema only, no runtime (low cost, real wins)

- Add `effect` (Schema is a sub-export).
- Replace `RawResponse` TS interface with `RawResponseSchema = Schema.struct({...})`. Validate at boundary. Convert parse errors to 502.
- Replace `as ReadingRow[]` casts in DAO with `Schema.decodeUnknownSync(ReadingRowSchema)(row)`.
- Keep `better-sqlite3`, plain async/await, existing Error classes.
- Effort: ~30 minutes. Risk: low.

### Tier B — Schema + Effect runtime + Provider interface (recommended)

- Tier A.
- Define `Provider` contract above. Wrap `ERedesClient.getConsumption` in an Effect that Fails with `ProviderError` instead of throwing.
- Refactor endpoint to `Effect.gen` + `Effect.runPromise`. Use `Layer` to provide ERedes config (aat) and (later) a Shelly config.
- Repository stays as-is (no Effect runtime inside DAO; just `getDb()` calls inside `Effect.try`).
- Effort: ~2 hours. Risk: medium (Effect API familiarity). Adds the abstraction seam you'll need for Tier C.

### Tier C — Full Effect SQL (only if you want the typed query builder)

- Replace `better-sqlite3` with `@effect/sql` SQLite.
- Migrate to Effect's `Repository` / `Statement` API.
- Loses sync DB; gains a typed query DSL that share Schemas with the API boundary.
- Effort: ~4 hours. Risk: higher. **Not recommended** unless you want to dogfood Effect end-to-end. Tier B gets you 80% of the value (typed boundaries, typed errors, provider swap) at 20% of the cost.

---

## Concrete migration order if you choose Tier B

Throughout: install `pnpm add effect@beta`. Use v4 import shapes shown below — they differ from v3 in several surfaces (`Layer.Service` consolidation, `Schema.TaggedError` ergonomics, single `Schema` namespace, removed legacy `S.*` aliases).

1. `pnpm add effect@beta` (resolves to 4.0.0-beta.x).
2. Introduce `ConsumptionReading` / `ConsumptionData` as `Schema.Class`es in a new `src/lib/server/domain/consumption.ts`.
3. Migrate `eredes.ts`:
   - `RawResponse` → `RawResponseSchema`.
   - `parseResponse` becomes `Schema.decodeUnknownEither(RawResponseSchema).pipe(Effect.mapError(mapParseErr))`.
   - `getConsumption` returns `Effect.Effect<ConsumptionData, ProviderError>`.
   - Drop the 3 custom Error classes; replace with `ProviderError` tagged errors (code: `"auth"`, `"upstream"`, `"network"`).
4. Migrate `readings.ts`:
   - Add `ReadingRowSchema`.
   - Wrap sync DB calls in `Effect.try` so they integrate with the runtime.
5. Define `Provider` interface in `src/lib/server/providers/provider.ts`.
6. Implement `ERedesProvider` as an `Effect.Service`. Build its `Layer` from `Config.secret`.
7. Refactor `+server.ts`:
   - Resolve `Provider` from a router (currently hardcoded to `eredes`).
   - `Effect.gen` flow: `cache.get → else (provider.getConsumption → repository.upsert → cache.get) → map to Response`.
   - `Effect.runPromise` at the boundary convert to `error` calls.
8. Add a fresh endpoint `GET /api/providers` listing registered providers (proves the abstraction works).
9. Run corrupted-token test: ProviderError(code:"auth") maps to 401, exactly as today.

## Open design questions

Do not write code until these are settled:

1. **Provider selection signal.** Hard-coded `eredes` in endpoint? Per-CPE provider in config? Per-user later?
2. **CPE ownership.** When multiple providers exist, one CPE maps to one provider, or can both write? If both: dedupe by `register` (currently PK does this), but `status` semantics differ per source.
3. **Refresh semantics.** `?refresh=1` today forces a re-fetch from the active provider. With multiple providers writing the same (cpe, register, ts) key, does refresh re-fetch from one source or all configured sources?
4. **Where is Effect's runtime lifecycle?** SvelteKit's `handle` hook in `src/hooks.server.ts` is the natural place to construct the `Layer` once per cold start and reuse.

## Bottom line

- **Schema adoption: clear win** at both boundaries regardless of anything else. Tier A.
- **Full Provider abstraction: adopt if you'll add at least one more source in the next 3 months.** The cost is paid once. Tier B.
- **Tier C (full Effect SQL): wait.** Only revisit if you find yourself writing more than 5 hand-written SQL queries or wanting transactional semantics across providers.
