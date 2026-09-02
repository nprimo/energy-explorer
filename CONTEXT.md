# Energy Explore

Local-first web app for exploring personal electricity consumption. Users pull 15-min interval data from E-REDES, cache it locally, and analyze patterns and costs.

## E-Redes

**App user** — the person authenticated in your application.

**E-REDES connection** — an authorization held by the app for one E-REDES account.

**Credential bundle** — AAT plus any required session cookies.

**Meter point** — the CPE associated with a connection.

**Connection status** — connected, expired, invalid, or reauthentication-required.

**Reading cache** — consumption data already pulled into your database.

**Authorization** — permission to access E-REDES, separate from cached readings.

The most important distinction is:

> A reading cache is not a credential store.

## Consumption domain

**Reading** — a single 15-minute interval measurement from the meter. The raw atomic unit. Fields: timestamp, valueWh, status, register, CPE.

_Avoid_: Measurement, data point, interval (use Reading)

**Consumption** — an aggregation of readings over a time range. Always derived, never raw. Can be a total, average, curve, or any other computed summary.

_Avoid_: Usage, consumption data, consumption readings (use Consumption or Reading as appropriate)

**Consumption curve** — the time-ordered sequence of 15-min readings for a single day (96 readings). The canonical shape of one day's electricity use.

_Avoid_: Load profile, daily curve (use Consumption curve)

**Register** — the meter channel. Currently only `A+` (active import). Future: `A-` (active export for solar), `R+`/`R-` (reactive).

**Period** — the time window for analysis. Primary periods: day, week, month, quarter, year. Each period maps to a specific visualization.

**Aggregated curve** — a consumption curve computed by averaging/combining multiple consumption curves. Example: "average workday curve for January" = average of all January weekday curves at each 15-min slot. Computed per-slot: each 15-min slot averages only the days that have data for that slot. Partial days contribute their available slots; missing slots are skipped, not interpolated. Curves are always conceptualized in local time (Europe/Lisbon) — slot 0 is always midnight local time, regardless of UTC offset.

_Avoid_: Average curve, mean curve (use Aggregated curve)

**Day classification** — a day is classified as workday (Mon-Fri) or weekend (Sat-Sun). Portuguese public holidays are treated as weekends for tariff-aligned analysis. Classification is used for aggregation grouping and tariff period alignment.

**Partial day** — a day with fewer than 96 readings. Partial days are excluded from daily total calculations but their available slots still contribute to per-slot aggregated curves.

**Invoice period** — a billing cycle that may not align with civil months (e.g., 22nd to 21st). Useful for tariff-aligned analysis. Currently future scope; civil months are used for now.

_Avoid_: Billing period, billing cycle (use Invoice period)

**Calendar heatmap** — a visualization where blocks represent time periods (day or 15-min slot) with color intensity encoding a metric (e.g., total kWh). Block granularity (day vs slot) is to be prototyped.

_Avoid_: GitHub blocks, heat map (use Calendar heatmap)

**Local time** — always Europe/Lisbon. The user's physical location does not affect time zone. E-REDES returns timestamps in local Lisbon time. Stored timestamps must be converted to true UTC for storage, then converted back to local time for display and analysis.

## Tariff domain

**Tariff period** — the label assigned to each moment of the day and week for pricing (ERSE's "período horário"). Umbrella term covering both regulated and billed periods. Bare "Period" stays reserved for analysis windows.
_Avoid_: time-of-use period, posto

**Regulated period** — one of the four periods defined by the ERSE directives for Portugal continental: ponta, cheias, vazio normal, super vazio. Depends on the date and the contract's cycle, not on the contract's option. Values use the directive's own Portuguese names.
_Avoid_: time band, price period

**Billed period** — the period a contract's option collapses regulated periods into for pricing: vazio, fora de vazio, cheias, ponta, or único (simples).
_Avoid_: bucket, bracket

**Tariff structure** — the contract knowledge needed to price energy: the option (simples, bi-horário, tri-horário) and, for bi-horário and tri-horário, the cycle. A simples contract has no cycle.
_Avoid_: contract type, plan

**Cycle** — the counting cycle (ciclo de contagem): diário (tariff periods identical every day) or semanal (tariff periods differ between weekdays, Saturdays, Sundays, and seasons). A property of the contract, chosen by the consumer.
_Avoid_: cadence, schedule

**Season** — the legal-time half of the year a date falls in: hora legal de inverno or hora legal de verão, per Decreto-Lei n.º 17/96. Some cycles differentiate tariff periods by season; others do not.
_Avoid_: semester, epoch (use época only when quoting the directive's ciclo semanal por épocas)
