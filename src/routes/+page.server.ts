import { env } from "$env/dynamic/private";
import { Cause, Effect } from "effect";
import { run } from "$lib/server/runtime";
import { ReadingsRepo } from "$lib/server/readings";

const REGISTER = "A+";

export async function load() {
  const cpe = env.EREDES_CPE ?? "";

  // Oldest cached reading day (YYYY-MM-DD, UTC) — cache-only, never backfills
  // from e-redes. A DB failure must not break the home page, so the failure is
  // logged first (full cause, same convention as `orHttpError` — it travels
  // through the runtime's OTLP layer like every other Effect log), then we
  // fall back to null and the client clamps to "one year ago" instead.
  const oldestAvailable = await run(
    Effect.gen(function* () {
      const repo = yield* ReadingsRepo;
      const bounds = yield* repo.getRangeBounds(cpe, REGISTER);
      return bounds.min ? bounds.min.slice(0, 10) : null;
    }).pipe(
      Effect.tapCause((cause) =>
        Effect.logError(`home load: range bounds unavailable: ${Cause.pretty(cause)}`),
      ),
      Effect.catchDefect(() => Effect.sync(() => null)),
    ),
  ).catch((error) => {
    // Promise edge (outside the runtime): layer construction or runtime failure.
    console.error(`home load: runtime failure:`, error);
    return null;
  });

  return { cpe, oldestAvailable };
}
