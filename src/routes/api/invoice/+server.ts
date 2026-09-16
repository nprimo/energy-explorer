import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { Effect } from "effect";
import { run } from "$lib/server/runtime";
import { ContractsRepo } from "$lib/server/contracts";
import { ReadingsRepo } from "$lib/server/readings";
import { ContractDataError } from "$lib/server/contracts";
import {
  IndexedPricingNotSupportedError,
  NoContractInForceError,
  OverlappingContractsError,
  computeInvoiceCost,
} from "$lib/contract/cost";
import { currentInvoicePeriod, lisbonDateOf } from "$lib/contract/invoice-period";

/**
 * GET /api/invoice?cpe=... — the running invoice cost of the current invoice
 * period (pre-tax): the latest period whose start is ≤ now. Its end is a
 * projection, not a bill. Coverage in the response is the honesty layer — a
 * silent underestimate reads as a real invoice.
 */
export const GET: RequestHandler = async ({ url }) => {
  const cpe = url.searchParams.get("cpe") ?? env.EREDES_CPE;
  if (!cpe) {
    throw error(400, "Missing cpe — pass ?cpe=... or set EREDES_CPE.");
  }

  let result;
  try {
    result = await run(
      Effect.gen(function* () {
        const contractsRepo = yield* ContractsRepo;
        const readingsRepo = yield* ReadingsRepo;

        const contracts = yield* contractsRepo.getForCpe(cpe);
        const today = lisbonDateOf(new Date());
        const current = contracts.find(
          (contract) =>
            contract.validFrom <= today && (contract.validTo === null || today <= contract.validTo),
        );
        if (!current) {
          return yield* Effect.fail(new NoContractInForceError({ at: today }));
        }

        const period = currentInvoicePeriod(current.contractAnchorDate, current.validFrom);
        const rows = yield* readingsRepo.getRange(cpe, "A+", period.start, period.end);
        return yield* computeInvoiceCost(
          rows.map((row) => ({ ts: row.ts, valueWh: row.valueWh, status: row.status })),
          contracts,
          period,
        );
      }),
    );
  } catch (ex) {
    if (ex instanceof NoContractInForceError) {
      throw error(404, `No contract in force for ${cpe} at ${ex.at}. Seed the contracts table.`);
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
