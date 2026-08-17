import { Effect, Layer, ManagedRuntime } from "effect";
import { env } from "$env/dynamic/private";
import { ERedes } from "$lib/server/eredes";

// ---------------------------------------------------------------------------
// ServerLive: the composition of every app service layer.
//
// Today it is just ERedes; each migrated service gets `Layer.merge`-ed in here.
// ---------------------------------------------------------------------------
function buildServerLive(): Layer.Layer<ERedes> {
  const aat = env.EREDES_AAT ?? "";
  return ERedes.withAccessToken(aat);
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
export const run: <A, E>(program: Effect.Effect<A, E, ERedes>) => Promise<A> = (program) =>
  runtime.runPromise(program);

// Release scoped resources on process shutdown.
const shutdown = () => {
  void runtime.dispose();
};
if (typeof process !== "undefined") {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
