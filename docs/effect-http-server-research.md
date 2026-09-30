# Research: going full Effect for the HTTP server / routing

**Question.** Should we move the whole project to Effect — using the Effect API for the main HTTP server and routing? Goals: **minimize dependencies, solid error checks, observability out of the box**.

**TL;DR — recommendation.** Don't replace SvelteKit routing with an Effect HTTP server. Stay with SvelteKit as the HTTP edge, and keep deepening Effect inside it (already done for services). Full-replacement would _add_ dependencies and risk to get things SvelteKit already gives for free, contradicting all three stated goals. The one Effect piece worth adopting at the edge is `HttpApi` (schema-first endpoint definitions) _bridged into_ SvelteKit handlers — and even that is optional.

---

## 1. Where the project already is

The premise "move to Effect" is half-done already, and done well:

- `effect@4.0.0-rc.109` is the only runtime dependency of interest; SvelteKit owns the HTTP edge (`src/routes/api/*/+server.ts`, `+page.server.ts`).
- All server logic is Effect: `ERedes` (HTTP client via `effect/unstable/http` HttpClient + Schema decoding), `ReadingsRepo`, `ContractsRepo`, `ConsumptionGateway`, composed in `src/lib/server/runtime.ts` as a `Layer` graph served through `ManagedRuntime`, with a `run()` bridge to SvelteKit handlers.
- Observability is already "out of the box": `Otlp.layerJson` from `effect/unstable/observability` exports traces + logs via OTLP/HTTP, wired to the local Grafana `otel-lgtm` stack in `docker-compose.yaml`. Zero extra npm dependencies (the OTel SDK is not needed in v4).
- Error checking is typed: tagged `Schema.TaggedError` classes (`ERedesAuthenticationError`, …) flow through the Effect error channel, and route handlers map them to HTTP status codes in a small `catch` block.

So the real question is narrower: **should the HTTP routing layer itself become Effect?**

## 2. The three options

### Option A — replace SvelteKit with a standalone Effect server (`HttpRouter.serve` + `NodeHttpServer` or `HttpRouter.toWebHandler`)

Effect v4 has a complete server story in-repo: `HttpRouter`, `HttpServer`, and `HttpApi`/`HttpApiBuilder`/`HttpApiScalar` (OpenAPI + Scalar docs) all live in `effect/unstable/http` and `effect/unstable/httpapi` — the separate `@effect/platform` package is gone in v4 ([MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)). A minimal program tree-shakes to ~6.3 KB gzipped (~15 KB with Schema).

**But this project is a SvelteKit app.** The UI is Svelte 5 runes-mode pages (`/consumption`) with `+page.server.ts` loads. Replacing the server means:

- Losing file-based routing, SSR of Svelte pages, form actions, `+page.server.ts` loads, `$env/dynamic/*`, SvelteKit middleware/hooks, `svelte-kit sync`/`svelte-check` integration, and the `vp dev` workflow — none of which Effect provides. You'd rebuild or dual-run them.
- Two servers (Effect API server + SvelteKit frontend) or a custom reverse-proxy setup: more moving parts, more dependencies (e.g. `@effect/platform-node`), not fewer.
- The API surface here is 3 small endpoints + 1 page load (~290 lines total across route files). There is no routing complexity that would justify a router migration.

**Verdict: bad idea for this project.** It optimizes for Effect purity at the cost of the actual goals.

### Option B — SvelteKit edge, Effect everything behind it (status quo, deepened)

Keep `+server.ts` handlers as thin bridges: parse/validate → `run(program)` → map typed errors → `json(...)`.

- **Dependencies:** already minimal — one package (`effect`), no `@effect/platform-node` needed because SvelteKit is the server.
- **Error checks:** the `run()` bridge currently hides the error channel (it throws at runtime), forcing per-route `try/catch` instanceof ladders (see `src/routes/api/consumption/+server.ts`). The one real improvement available: make `run()` type-level honest (require the caller to `Effect.catchTag`/`squash` all errors before crossing the bridge, or return a discriminated result) so the compiler, not the `catch` block, proves every error is handled. That closes the only gap between "Effect-typed errors" and "solid error checks" at the edge.
- **Observability:** already done; each request could get a span via a tiny SvelteKit `hooks.server.ts` wrapper (`Effect.withSpan` around `run`), giving end-to-end traces into Grafana with zero new dependencies.

**Verdict: this is the right default.** It is mostly what the repo already does; the cost is the small hand-written bridge per route.

### Option C — hybrid: `HttpApi` definitions bridged into SvelteKit

Effect v4's `HttpApi` is schema-first: endpoint groups with request/response schemas, error-to-status mapping, generated typed clients, OpenAPI/Scalar docs, and in-memory testing (`HttpApiTest.groups` runs the full HTTP pipeline without a server — the ai-docs testing example shows 404/401 assertions with no HTTP server). `HttpRouter.toWebHandler` produces a plain Fetch `(Request) => Promise<Response>`, and v4 `HttpEffect` explicitly "turns Effect HTTP server handlers into Web `Request` handlers" — which is exactly the shape SvelteKit endpoints live at.

A pragmatic bridge: define the API once in `HttpApi`, then in each `+server.ts` convert the incoming SvelteKit `RequestEvent` into a Web `Request` and delegate to the `HttpApi` web handler, prefixing `/api`. You get:

- schema validation of query/body params (replacing hand-rolled `parseDateParam`),
- error → status mapping declared once per endpoint instead of per route,
- OpenAPI docs and a typed client for free,
- tests that exercise real routing/decoding (`HttpApiTest`).

Costs/risks:

- One extra indirection layer per endpoint, and a slightly unusual SvelteKit setup to maintain.
- `http`/`httpapi` are **unstable modules** in v4 — they may receive breaking changes even after `effect` 4.0 stable ([MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)). The RC blog post says interfaces are "presumed final" and stable targets Q3/Q4 2026, but unstable-module churn is a real maintenance tax.
- With 3 endpoints, the payoff is modest today; it grows if the API surface grows (periodic pull endpoints, forecast endpoints, etc. — see `todo.md`).

**Verdict: good idea, but not urgent.** Adopt when the API surface reaches the point where hand-written param parsing and error mapping outweigh the bridge cost; or adopt now for the `/api/*` routes only if the OpenAPI/typed-client/test story is wanted.

## 3. Goal-by-goal scorecard

| Goal                         | Full Effect server (A)                                                             | SvelteKit + Effect (B)                                                            | SvelteKit + HttpApi bridge (C)                                    |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Minimize dependencies        | ❌ adds `@effect/platform-node`, loses SvelteKit-managed infra, likely dual-server | ✅ already minimal (single `effect` pkg; v4 merged `@effect/platform` in)         | ✅ no new npm deps, but adds a custom bridge to maintain          |
| Solid error checks           | ✅ typed error channel end to end                                                  | ⚠️ typed until the `run()` bridge; fixable by making the bridge type-honest       | ✅ schema validation + declared error→status mapping per endpoint |
| Observability out of the box | ✅                                                                                 | ✅ already wired (Otlp layer + otel-lgtm); add a span hook for per-request traces | ✅ router adds request logging/spans middleware for free          |

## 4. Timing notes

- `effect@4.0.0-rc.109` is pinned; upstream `main` is at `4.0.0-rc.117`. The RC announcement states no broad breaking changes are planned and stable is targeted Q3/Q4 2026; staying current on `rc` is low-risk and the team is actively fixing migration-feedback issues.
- There are community integrations for closer SvelteKit/Effect coupling (`@thomasfosterau/effect-sveltekit`, `sveltekit-effect-runtime`), but adopting a third-party glue package contradicts the minimize-dependencies goal; the hand-written `run()` bridge is ~40 lines and already understood.

## 5. Concrete next steps (recommended path)

1. Make `run()` type-honest so the error channel can't be silently dropped (option B's main gap).
2. Add `hooks.server.ts` (or extend `run`) to open a span per request with route + status attributes — closes the observability loop for HTTP requests.
3. Extract shared error→status mapping into one helper instead of per-route `instanceof` ladders.
4. Revisit option C when: (a) the API grows past ~6–8 endpoints, or (b) a typed client / OpenAPI spec becomes genuinely useful (e.g. for the planned periodic-pull or forecast features).

## Sources

- [Effect 4.0 RC announcement](https://effect.website/blog/releases/effect/40-rc) — RC meaning, no broad breaking changes planned, stable target Q3/Q4 2026, unstable-module caveat.
- [v3→v4 MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) — package consolidation (`@effect/platform` → `effect`), unstable modules list, bundle sizes, `Runtime<R>` removal.
- [HttpRouter API (v4)](https://effect.website/docs/v4/api/effect/unstable/http/HttpRouter) — `toWebHandler`, `serve`, schema-validated params, route middleware.
- [HttpApi getting started / testing fixtures](node_modules/effect/ai-docs/src/51_http-server/) — schema-first API, Scalar docs, `HttpApiTest` in-memory client tests (bundled with the installed `effect` package).
- [Observability docs + Otlp modules](https://effect.website/docs/v4/api/effect/unstable/observability/Otlp) and `node_modules/effect/ai-docs/src/08_observability/` — built-in tracing/logging with zero-dependency OTLP export.
- Local evidence: `src/lib/server/runtime.ts`, `src/routes/api/consumption/+server.ts`, `src/routes/consumption/+page.server.ts`, `docker-compose.yaml`, `package.json`.
