import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { Data, Effect } from "effect";
import { run } from "$lib/server/runtime";
import { ContractsRepo } from "$lib/server/contracts";
import { ReadingsRepo } from "$lib/server/readings";
import { ContractDataError } from "$lib/server/contracts";
import {
  IndexedPricingNotSupportedError,
  NoContractInForceError,
  OverlappingContractsError,
  computeCost,
} from "$lib/contract/cost";

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

  let result;
  try {
    result = await run(
      Effect.gen(function* () {
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
      }),
    );
  } catch (ex) {
    if (ex instanceof NoContractInForceError) {
      throw error(404, `No contract in force for ${cpe} (${ex.at}). Seed the contracts table.`);
    }
    if (ex instanceof NoCachedReadingsError) {
      throw error(404, `No cached readings for ${cpe} — pull data first, or pass ?from=&to=.`);
    }
    if (ex instanceof OverlappingContractsError) {
      throw error(500, `Overlapping contracts on ${ex.date}: ${ex.contractIds.join(", ")}`);
    }
    if (ex instanceof ContractDataError) {
      throw error(500, `Invalid contract data (${ex.contractId}): ${ex.reason}`);
    }
    if (ex instanceof IndexedPricingNotSupportedError) {
      throw error(501, `Indexed pricing is not supported yet (contract ${ex.contractId}).`);
    }
    throw ex;
  }

  return json({ cpe, register: "A+", ...result });
};
