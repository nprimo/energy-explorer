import { Context, Data, Effect, Layer, Schema } from "effect";
import { getDb } from "../db/index.js";
import type { Contract } from "$lib/contract/types";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// pricing JSON column → the ContractPricing union (all 5 billed-period keys
// required for fixed; the indexed variant is reserved for phase 4).
const BilledPeriodPrice = Schema.Struct({
  unico: Schema.Number,
  vazio: Schema.Number,
  "fora de vazio": Schema.Number,
  cheias: Schema.Number,
  ponta: Schema.Number,
});

// pricing JSON column → the ContractPricing union (all 5 billed-period keys
// required for fixed; the indexed variant is reserved for phase 4).
const PricingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("fixed"),
    pricesPerBilledPeriod: BilledPeriodPrice,
  }),
  Schema.Struct({
    kind: Schema.Literal("indexed"),
    formula: Schema.Any,
  }),
]);

const ContractSchema = Schema.Struct({
  id: Schema.String,
  cpe: Schema.String,
  option: Schema.Union([
    Schema.Literal("simples"),
    Schema.Literal("bi-horario"),
    Schema.Literal("tri-horario"),
  ]),
  countingCycle: Schema.NullOr(Schema.Union([Schema.Literal("diario"), Schema.Literal("semanal")])),
  contractAnchorDate: Schema.String,
  contractedPowerKva: Schema.Number,
  powerPricePerDay: Schema.Number,
  validFrom: Schema.String,
  validTo: Schema.NullOr(Schema.String),
  pricing: PricingSchema,
});

export class ContractDataError extends Data.TaggedError("ContractData")<{
  readonly contractId: string;
  readonly reason: string;
}> {}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ContractsRepo extends Context.Service<
  ContractsRepo,
  {
    /** All effective-dated contracts for a CPE, ordered by validFrom. */
    readonly getForCpe: (cpe: string) => Effect.Effect<ReadonlyArray<Contract>, ContractDataError>;
  }
>()("app/ContractsRepo") {
  static readonly Live: Layer.Layer<ContractsRepo> = Layer.sync(ContractsRepo, () =>
    ContractsRepo.of({
      getForCpe: (cpe) =>
        Effect.try({
          try: () => {
            const db = getDb();
            const rows = db.prepare(GET_FOR_CPE_SQL).all({ cpe });
            const decode = Schema.decodeUnknownSync(ContractSchema);
            return rows.map((row) => {
              const raw = row as Record<string, unknown>;
              try {
                const pricing = JSON.parse(raw.pricing as string);
                return decode({ ...raw, pricing }) as Contract;
              } catch (cause) {
                throw new ContractDataError({
                  contractId: String(raw.id),
                  reason: cause instanceof Error ? cause.message : String(cause),
                });
              }
            });
          },
          catch: (cause) =>
            cause instanceof ContractDataError
              ? cause
              : new ContractDataError({
                  contractId: "?",
                  reason: cause instanceof Error ? cause.message : String(cause),
                }),
        }).pipe(
          Effect.withSpan("ContractsRepo.getForCpe", {
            attributes: { cpe },
          }),
        ),
    }),
  );
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const GET_FOR_CPE_SQL = `
	SELECT
		id                   AS id,
		cpe                  AS cpe,
		tariff_option        AS option,
		counting_cycle       AS countingCycle,
		contract_anchor_date AS contractAnchorDate,
		contracted_power_kva AS contractedPowerKva,
		power_price_per_day  AS powerPricePerDay,
		valid_from           AS validFrom,
		valid_to             AS validTo,
		pricing              AS pricing
	FROM contracts
	WHERE cpe = @cpe
	ORDER BY valid_from ASC
`;
