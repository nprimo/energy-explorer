import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Otlp } from "effect/unstable/observability";
import { env } from "$env/dynamic/private";
import { ERedes } from "$lib/server/eredes";
import { ReadingsRepo } from "$lib/server/readings";
import { ConsumptionGateway } from "$lib/server/consumption";

// ---------------------------------------------------------------------------
// Observability (optional)
//
// When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, spans + logs are exported via
// OTLP/HTTP to that base URL (dev: http://localhost:4318 → Grafana; prod: your
// collector/vendor). When unset, no exporter is wired and spans are dropped —
// the runtime behaves exactly as before.
// ---------------------------------------------------------------------------

const SERVICE_NAME = "energy-explore";

function buildObservabilityLayer(): Layer.Layer<never> | null {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
  if (!endpoint) return null;
  return Otlp.layerJson({
    baseUrl: endpoint,
    resource: { serviceName: SERVICE_NAME },
  }).pipe(Layer.provide(FetchHttpClient.layer));
}

const ObservabilityLayer = buildObservabilityLayer();

// ---------------------------------------------------------------------------
// ServerLive: the composition of every app service layer.
//
// Today: ERedes + ReadingsRepo + ConsumptionGateway. Each migrated service
// gets `Layer.merge`-ed in here. The observability layer is merged in when
// configured (it provides `never` — it installs global tracer/logger exporters
// as a side effect).
// ---------------------------------------------------------------------------

function buildServerLive(): Layer.Layer<ConsumptionGateway> {
  const services = ConsumptionGateway.Live.pipe(
    Layer.provide(Layer.merge(ERedes.withAccessToken(env.EREDES_AAT ?? ""), ReadingsRepo.Live)),
  );
  return ObservabilityLayer ? Layer.merge(services, ObservabilityLayer) : services;
}

export const ServerLive = buildServerLive();

// Shared memo map so layers are built once even across re-imports (HMR) or
// additional runtimes (tests).
const appMemoMap = Layer.makeMemoMapUnsafe();

// ---------------------------------------------------------------------------
// runtime: the bridge between Effect programs and SvelteKit request handlers.
//
// Built lazily on first use, cached for the process, owns the scope of every
// service in `ServerLive`.
// ---------------------------------------------------------------------------
export const runtime = ManagedRuntime.make(ServerLive, { memoMap: appMemoMap });

/**
 * Run an Effect program against the server runtime from a non-Effect edge
 * (e.g. a SvelteKit `+server.ts` handler). Returns a Promise.
 */
export const run: <A, E>(program: Effect.Effect<A, E, ConsumptionGateway>) => Promise<A> = (
  program,
) => runtime.runPromise(program);

// Release scoped resources on process shutdown.
const shutdown = () => {
  void runtime.dispose();
};
if (typeof process !== "undefined") {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
