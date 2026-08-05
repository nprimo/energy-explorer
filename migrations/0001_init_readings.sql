-- 0001_init_readings.sql
-- One row per 15-min load-curve point for one CPE + register.
--
-- PK (cpe, register, ts) dedupes re-fetches (UPSERT).
-- ts stored as ISO-8601 UTC TEXT ("2026-08-05T00:15:00Z"): sortable, JSON-native.
-- value_wh is the canonical value; kWh is recoverable as value_wh/1000.
-- status mirrors E-REDES meterLoadCurveStatus ("real" / "estimated" / ...).
-- inserted_at = when we cached the row, for cache-freshness diagnostics.

CREATE TABLE IF NOT EXISTS readings (
  cpe         TEXT    NOT NULL,
  register    TEXT    NOT NULL,     -- "A+" import, "A-" export (solar) later
  ts          TEXT    NOT NULL,
  value_wh    INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  inserted_at TEXT    NOT NULL,
  PRIMARY KEY (cpe, register, ts)
);

CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);