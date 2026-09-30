import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { Data, Effect } from "effect";
import { run } from "$lib/server/runtime";
import { orHttpError, type HttpFailure } from "$lib/server/http";
import { ContractsRepo } from "$lib/server/contracts";
import { ReadingsRepo } from "$lib/server/readings";
import { NoContractInForceError, computeCost } from "$lib/contract/cost";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** The cache is empty and no explicit ?from=&to= was given. */
class NoCachedReadingsError extends Data.TaggedError("NoCachedReadings")<{
  readonly cpe: string;
}> {}

/**
 * GET /api/cost?cpe=...&from=&to= — the pre-tax cost of the readings in the
 * given range (energy + power, no tax). When from/to are omitted, the range
 * defaults to the available readings (first to last cached timestamp).
 * Coverage in the response is the honesty layer — a cost over a range with
 * missing slots is a lower bound, never a real bill.
 */
export const GET: RequestHandler = async ({ url }) => {
  const cpe = url.searchParams.get("cpe") ?? env.EREDES_CPE;
  if (!cpe) {
    throw error(400, "Missing cpe — pass ?cpe=... or set EREDES_CPE.");
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from === null) !== (to === null)) {
    throw error(400, "Pass both ?from= and ?to= (UTC ISO-8601), or neither.");
  }
  if (from !== null && to !== null) {
    const startMs = Date.parse(from);
    const endMs = Date.parse(to);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw error(400, "from/to must be UTC ISO-8601 timestamps.");
    }
    if (startMs >= endMs) {
      throw error(400, "The range is empty — ?to= must be after ?from=.");
    }
  }

  const program = Effect.gen(function* () {
    const contractsRepo = yield* ContractsRepo;
    const readingsRepo = yield* ReadingsRepo;

    const contracts = yield* contractsRepo.getForCpe(cpe);
    if (contracts.length === 0) {
      return yield* Effect.fail(new NoContractInForceError({ at: "all ranges" }));
    }

    // Range: explicit from/to, or first-to-last cached reading.
    const range =
      from && to
        ? { start: from, end: to }
        : yield* Effect.gen(function* () {
            const bounds = yield* readingsRepo.getRangeBounds(cpe, "A+");
            if (!bounds.min || !bounds.max) {
              return yield* Effect.fail(new NoCachedReadingsError({ cpe }));
            }
            // Extend past the last instant's slot end so [start, end) covers it.
            const end = new Date(Date.parse(bounds.max) + FIFTEEN_MINUTES_MS).toISOString();
            return { start: bounds.min, end } as const;
          });

    const rows = yield* readingsRepo.getRange(cpe, "A+", range.start, range.end);
    return yield* computeCost(
      rows.map((row) => ({ ts: row.ts, valueWh: row.valueWh, status: row.status })),
      contracts,
      range,
    );
  });

  // The switch must stay exhaustive over the program's error channel — the
  // `satisfies never` default turns an unhandled error addition into a
  // compile error instead of a runtime fallthrough.
  const result = await run(
    orHttpError(program, (ex): HttpFailure => {
      switch (ex._tag) {
        case "NoContractInForce":
          return {
            status: 404,
            message: `No contract in force for ${cpe} (${ex.at}). Seed the contracts table.`,
          };
        case "NoCachedReadings":
          return {
            status: 404,
            message: `No cached readings for ${cpe} — pull data first, or pass ?from=&to=.`,
          };
        case "OverlappingContracts":
          return {
            status: 500,
            message: `Overlapping contracts on ${ex.date}: ${ex.contractIds.join(", ")}`,
          };
        case "ContractData":
          return {
            status: 500,
            message: `Invalid contract data (${ex.contractId}): ${ex.reason}`,
          };
        case "IndexedPricingNotSupported":
          return {
            status: 501,
            message: `Indexed pricing is not supported yet (contract ${ex.contractId}).`,
          };
        default:
          return ex satisfies never;
      }
    }),
  );

  return json({ cpe, register: "A+", ...result });
};
