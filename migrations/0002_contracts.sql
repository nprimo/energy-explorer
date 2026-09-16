-- 0002_contracts.sql
-- Effective-dated electricity contracts (docs/contract-invoice-plan.md).
--
-- User data, so it lives in the DB (unlike the checked-in tariff brackets —
-- ADR 0004). Read-only in v1: rows are inserted via SQL by hand (see
-- data/seed-contracts.example.sql); no CRUD UI. A contract switch is a new
-- row whose valid_from is the switch date; history is kept.
--
-- contract_anchor_date: the Lisbon calendar date the billing cycle started —
-- every invoice period derives from it, monthly (never a stored day-of-month
-- per period).
-- Prices are integers in 10⁻⁴ units (ERSE publishes 4 decimals, e.g.
-- 0,1548 €/kWh → 1548): power_price_per_day is €/day/kVA × 10⁻⁴, and the
-- pricing JSON holds €/kWh × 10⁻⁴ per billed period.
-- pricing JSON shape:
--   {"kind":"fixed","pricesPerBilledPeriod":{"unico":n,"vazio":n,
--    "fora de vazio":n,"cheias":n,"ponta":n}}
--   {"kind":"indexed","formula":...}   -- reserved, phase 4 OMIE plan

CREATE TABLE IF NOT EXISTS contracts (
  id                   TEXT    PRIMARY KEY,
  cpe                  TEXT    NOT NULL,
  tariff_option        TEXT    NOT NULL, -- simples | bi-horario | tri-horario
  counting_cycle       TEXT,             -- diario | semanal | NULL (simples)
  contract_anchor_date TEXT    NOT NULL, -- "YYYY-MM-DD", Lisbon
  contracted_power_kva REAL    NOT NULL,
  power_price_per_day  INTEGER NOT NULL, -- 10⁻⁴ €/day/kVA
  valid_from           TEXT    NOT NULL, -- "YYYY-MM-DD", Lisbon, inclusive
  valid_to             TEXT,             -- inclusive; NULL = still in force
  pricing              TEXT    NOT NULL  -- JSON, see header
);

CREATE INDEX IF NOT EXISTS idx_contracts_cpe ON contracts(cpe, valid_from);
