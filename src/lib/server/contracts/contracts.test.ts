// Integration test for the contracts repo: applies the real migrations to a
// temp SQLite DB, seeds a contract row via SQL (the v1 way — no CRUD UI), and
// runs the calculator over the derived invoice period.

import { Effect, ManagedRuntime } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { computeInvoiceCost } from "$lib/contract/cost";
import { currentInvoicePeriod } from "$lib/contract/invoice-period";

// The db module reads EREDES_DB_PATH at import time — set it first.
const dbPath = join(mkdtempSync(join(tmpdir(), "contracts-repo-")), "test.db");
process.env.EREDES_DB_PATH = dbPath;

const { getDb } = await import("$lib/server/db/index.js");
const { ContractsRepo, ContractDataError } = await import("$lib/server/contracts");
import type { Contract } from "$lib/contract/types";

const CPE = "PT0002000037313307TL";

const SEED = `
	INSERT INTO contracts (
		id, cpe, tariff_option, counting_cycle, contract_anchor_date,
		contracted_power_kva, power_price_per_day, valid_from, valid_to, pricing
	) VALUES (
		'simples-2026-09', '${CPE}', 'simples', NULL, '2025-09-08',
		3.45, 1575, '2025-09-08', NULL,
		'{"kind":"fixed","pricesPerBilledPeriod":{"unico":1548,"vazio":0,"fora de vazio":0,"cheias":0,"ponta":0}}'
	);
`;

const runtime = ManagedRuntime.make(ContractsRepo.Live);

beforeAll(() => {
  // getDb applies every migration, 0002_contracts.sql included.
  getDb().exec(SEED);
});

afterAll(() => {
  void runtime.dispose();
});

describe("ContractsRepo", () => {
  it("decodes seeded rows into Contracts", async () => {
    const contracts = await runtime.runPromise(
      Effect.gen(function* () {
        const repo = yield* ContractsRepo;
        return yield* repo.getForCpe(CPE);
      }),
    );
    expect(contracts).toHaveLength(1);
    expect(contracts[0]).toEqual({
      id: "simples-2026-09",
      cpe: CPE,
      option: "simples",
      countingCycle: null,
      contractAnchorDate: "2025-09-08",
      contractedPowerKva: 3.45,
      powerPricePerDay: 1575,
      validFrom: "2025-09-08",
      validTo: null,
      pricing: {
        kind: "fixed",
        pricesPerBilledPeriod: {
          unico: 1548,
          vazio: 0,
          "fora de vazio": 0,
          cheias: 0,
          ponta: 0,
        },
      },
    } satisfies Contract);
  });

  it("fails with a typed error on malformed pricing JSON", async () => {
    getDb().exec(`
			INSERT INTO contracts (
				id, cpe, tariff_option, counting_cycle, contract_anchor_date,
				contracted_power_kva, power_price_per_day, valid_from, valid_to, pricing
			) VALUES (
				'broken', 'OTHER-CPE', 'bi-horario', 'diario', '2026-01-01',
				4.6, 1000, '2026-01-01', NULL, '{"kind":"fixed","pricesPerBilledPeriod":{"unico":1}}'
			);
		`);
    const error = await runtime.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const repo = yield* ContractsRepo;
          return yield* repo.getForCpe("OTHER-CPE");
        }),
      ),
    );
    expect(error).toBeInstanceOf(ContractDataError);
  });
});

describe("repo → current invoice (end to end, cache empty)", () => {
  it("computes the running power-only cost for the current period", async () => {
    const contracts = await runtime.runPromise(
      Effect.gen(function* () {
        const repo = yield* ContractsRepo;
        return yield* repo.getForCpe(CPE);
      }),
    );
    // Anchor Sep 8 → the period containing Feb 10, 2026 runs Feb 8 → Mar 8.
    const period = currentInvoicePeriod(
      contracts[0].contractAnchorDate,
      contracts[0].validFrom,
      new Date("2026-02-10T12:00:00Z"),
    );
    expect(period).toEqual({
      start: "2026-02-08T00:00:00Z",
      end: "2026-03-08T00:00:00Z",
    });

    const cost = await runtime.runPromise(computeInvoiceCost([], contracts, period));
    // No readings in the fresh DB: energy 0 €, power accrues by the day —
    // 0.1575 €/day/kVA × 3.45 kVA = 0.543375 €/day × 28 days = 15.2145 €.
    expect(cost.energy.totalEur).toBe(0);
    expect(cost.power.activeDaysPerContract).toEqual([
      { contractId: "simples-2026-09", days: 28, eur: 15.2145 },
    ]);
    expect(cost.coverage).toEqual({ slotsWithData: 0, slotsExpected: 0, estimatedReadings: 0 });
    expect(cost.totalEur).toBe(15.2145);
  });
});
