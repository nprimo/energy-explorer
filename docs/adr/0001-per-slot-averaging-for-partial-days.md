# Per-slot averaging for partial days

When computing aggregated curves (e.g., "average workday curve for January"), some days may have incomplete reading data (fewer than 96 readings). We need to decide how to handle these partial days in aggregation.

**Decision**: For aggregated curves, compute averages per 15-min slot. Each slot averages only the days that have data for that slot. Missing slots are skipped, not interpolated. For daily totals (kWh), exclude days below a minimum reading threshold.

**Rationale**:

- Per-slot averaging preserves useful data from partial days. If morning data is available but afternoon is missing, the morning slots still contribute meaningfully to the average curve.
- Interpolation introduces noise without evidence. Assuming consumption between known points is uniform or follows a pattern is speculative.
- Full-day exclusion loses potentially valuable partial data. A day with 80 readings is still informative for the slots it covers.
- Daily totals require more complete data to be meaningful. Summing 20 readings and extrapolating to a full day is unreliable.

**Consequences**:

- Aggregated curves may have varying confidence across slots. Some slots may have data from 20 days, others from 15. This should be surfaced (e.g., sample count per slot, confidence indicator).
- Daily totals are more conservative (require minimum data). The threshold can be tuned during prototyping.
- The implementation must track per-slot sample counts alongside averages.
