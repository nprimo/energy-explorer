// ---------------------------------------------------------------------------
// Effect → SvelteKit HTTP bridge helpers.
//
// `run()` only accepts programs whose error channel is empty, so the compiler
// forces every route to decide what each domain error means in HTTP terms
// before crossing the bridge. These helpers turn that decision into a single,
// type-checked mapping instead of a per-route try/catch instanceof ladder.
// ---------------------------------------------------------------------------

import { error } from "@sveltejs/kit";
import { Cause, Effect } from "effect";
import type { ERedesServiceError } from "$lib/server/eredes";

/** How a domain error should surface as an HTTP response. */
export interface HttpFailure {
  readonly status: number;
  readonly message: string;
}

/**
 * Terminate a program by converting its typed error channel into a SvelteKit
 * HTTP error. The `toFailure` mapping must cover every error in the program's
 * channel — combine it with a `switch` on `_tag` and the usual
 * `e satisfies never` default so the compiler rejects unhandled additions.
 *
 * Defects (bugs, unexpected throws) are not mapped: they keep their original
 * cause and surface as a plain 500 from the SvelteKit edge.
 */
export function orHttpError<A, E, R>(
  program: Effect.Effect<A, E, R>,
  toFailure: (error: E) => HttpFailure,
): Effect.Effect<A, never, R> {
  return Effect.catchCause(program, (cause) =>
    Effect.sync(() => {
      const failure = Cause.findErrorOption(cause);
      if (failure._tag === "Some") {
        const { status, message } = toFailure(failure.value);
        throw error(status, message);
      }
      throw Cause.squash(cause);
    }),
  );
}

/** HTTP meaning of the E-REDES service errors, shared by every route that calls the gateway. */
export function eredesFailure(e: ERedesServiceError): HttpFailure {
  switch (e._tag) {
    case "ERedesAuthenticationError":
      return { status: 401, message: e.message };
    case "ERedesConnectionError":
    case "ERedesError":
      return { status: 502, message: e.message };
  }
}
