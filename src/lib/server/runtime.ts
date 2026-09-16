import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Otlp } from "effect/unstable/observability";
import { env } from "$env/dynamic/private";
import { ERedes } from "$lib/server/eredes";
import { ReadingsRepo } from "$lib/server/readings";
import { ContractsRepo } from "$lib/server/contracts";
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

function buildServerLive() {
  const eredes = ERedes.withAccessToken(env.EREDES_AAT ?? "");
  const readingsRepo = ReadingsRepo.Live;
  const contractsRepo = ContractsRepo.Live;
  const gateway = ConsumptionGateway.Live.pipe(
    Layer.provide(Layer.mergeAll(eredes, readingsRepo, contractsRepo)),
  );
  // Merge every service into the top-level output so the runtime environment
  // provides all of them (gateway dependencies included), not just the gateway.
  const services = Layer.mergeAll(gateway, eredes, readingsRepo, contractsRepo);
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
 *
 * Accepts any program whose requirements the ServerLive layer graph builds
 * (ConsumptionGateway, ERedes, ReadingsRepo) — they are all constructed inside
 * the runtime even though the layer's declared success type is just
 * ConsumptionGateway.
 */
export const run = <A, E>(
  program: Effect.Effect<A, E, ConsumptionGateway | ERedes | ReadingsRepo | ContractsRepo>,
): Promise<A> => runtime.runPromise(program);

// Release scoped resources on process shutdown.
const shutdown = () => {
  void runtime.dispose();
};
if (typeof process !== "undefined") {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
