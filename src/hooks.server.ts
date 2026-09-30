import type { Handle } from "@sveltejs/kit";
import { Effect } from "effect";
import { run } from "$lib/server/runtime";

// One span per server request, exported by the runtime's OTLP layer (Grafana
// in dev, see docker-compose.yaml). Route handlers that already use `run()`
// nest their service spans under this one, so a trace covers the full request.
export const handle: Handle = ({ event, resolve }) =>
  run(
    Effect.withSpan(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => Promise.resolve(resolve(event)));
        yield* Effect.annotateSpans(Effect.void, {
          "http.response.status_code": response.status,
        });
        return response;
      }),
      `${event.request.method} ${event.route.id ?? event.url.pathname}`,
      {
        attributes: {
          "http.request.method": event.request.method,
          "url.path": event.url.pathname,
          "sveltekit.route": event.route.id ?? "unmatched",
        },
      },
    ),
  );
