# Store timestamps in true UTC, display in local time

E-REDES returns timestamps in local Lisbon time (no timezone offset). The current code incorrectly labels these as UTC by appending `Z` via `toISOString()`. This causes all stored timestamps to be wrong by +0 or +1 hour depending on DST status.

**Decision**: Store all timestamps in true UTC. Convert E-REDES local-time timestamps to UTC on ingestion. Convert back to Europe/Lisbon for display and aggregated curve computation.

**Evidence**: On 2026-03-29 (DST spring-forward day), E-REDES data skips the 01:xx hour entirely (00:45 → 02:00). This gap only exists if timestamps are local time — the skipped hour doesn't exist in local time. If timestamps were UTC, all 96 slots would be present.

**Rationale**:

- UTC storage avoids ambiguity and makes comparisons trivial (no DST offset math at query time).
- Aggregated curves are conceptualized in local time (slot 0 = midnight Lisbon). The conversion from stored UTC to display-local happens at read time.
- E-REDES does not provide timezone metadata. The only reliable signal is DST transition behavior in the data.

**Migration**: For readings in DST periods (late March → late October), subtract 1 hour from the stored timestamp to convert from mislabeled "UTC" to true UTC. Winter readings (UTC+0) are already correct. The E-REDES ingestion code must be updated to apply the correct UTC offset on parse.

**Consequences**:

- All existing readings with timestamps in DST periods are off by +1 hour. A data migration is required.
- The `ReadingsRepo` queries use string comparison on timestamps. After migration, all queries continue to work correctly since the ordering is preserved (subtracting 1 hour doesn't change relative order).
- Future ingestion must detect DST status for the timestamp's local date and apply the correct offset.
