# Forecasting and scenario analysis: pure statistics, no ML

Researched 2026-09-08. Answers two questions: how to estimate the next invoice, and how to assess whether PV / battery / load-shifting is worth it.

## TL;DR

- **Do not build a forecasting model.** Machine learning on a single household's 15-minute readings does not produce trusted predictions. Individual consumption is too noisy and breaks whenever life changes (new appliance, EV, remote work). This is documented, not an opinion.
- **Aggregate first, then use percentiles.** Predictability improves with aggregation. The 15-minute curve is unpredictable, but the _monthly total_ is much more stable. We only need the total (and per-tariff-period totals), because that is what the invoice uses.
- **Report scenarios, not a single number.** Use P10 / P50 / P90 percentiles from a bootstrap over historical daily totals. No model, few assumptions, honest uncertainty.
- **For PV / battery decisions, do not forecast at all — simulate.** We already own the best input: our real historical consumption curves. The sector-standard method (PVGIS + real consumption data) overlays our curves with simulated PV production for each historical weather year, and reports savings as a distribution (P10/P50/P90 payback), not one number.
- **Prices matter only for indexed tariffs.** On regulated or fixed-market tariffs, prices are constants. On OMIE-indexed contracts, price becomes a third curve — and it correlates with sunshine (midday solar depresses the Iberian spot price), which makes batteries more attractive than naive math suggests.

## Why per-household forecasting fails

- Forecast error shrinks with the number of aggregated customers; a single home sits at the bad end of the scaling law (Sevlian & Rajagopal, 2014).
- Household-level forecasting has "unique challenges": volatility and concept drift — life changes break models (survey, Artificial Intelligence Review, 2025).
- The research response to this is probabilistic treatment of individual households (Applied Energy, 2024) — i.e., distributions instead of point forecasts. Exactly our direction.

Practical consequence: build **scenario ranges** from history, not predictions. A P90 invoice estimate is a baseline "life stays the same" scenario — label it as such in the UI, because the real risk for an individual is structural change, which no Pxx captures.

## Use case 1: next invoice estimate (P10 / P50 / P90)

The method here follows the objective: the invoice is priced from tariff-period totals, so all we need is a distribution over those totals.

1. Compute **daily totals** from the reading cache. Exclude partial days (< 96 readings) — they are not comparable.
2. Build a pool of similar historical days: same calendar month in past years, plus adjacent months, split workday / weekend (holidays behave like weekends — existing day classification).
3. **Bootstrap** daily totals from that pool and sum over the number of days in the target month. The result is a distribution of plausible monthly totals.
4. Read **P10 / P50 / P90** from that distribution.
5. Do the same **per tariff period** (vazio / fora de vazio, or the contract's billed periods), not just for the grand total. The invoice is priced per period, and the vazio share drives bi-horário economics.

No training, no hyperparameters, no ML. With one to two years of history this is already usable; it improves as the cache grows.

## Use case 2: PV / battery investment assessment (simulation, not forecasting)

The method here also follows the objective: an investment decision needs years of plausible combinations of consumption and production, not a forecast — and the reading cache already provides the consumption side.

We do not need a consumption forecast because the historical reading cache _is_ the consumption scenario. The published sector methodology for residential prosumers is:

1. Take real historical 15-minute consumption curves as "the future".
2. Get PV production from **PVGIS** (EU JRC, free API): same coordinates, tilt, orientation. Do not use only the Typical Meteorological Year — request **each individual weather year** (2005–2020+). The spread across weather years is the PV probability curve (P10/P50/P90 production).
3. Overlay both curves per 15-minute slot and compute the two standard metrics:
   - **Self-consumption ratio (SCR)**: share of PV production used directly instead of exported.
   - **Self-sufficiency ratio (SSR)**: share of consumption covered by PV.
   - Residual import per slot → what is still bought from the grid, per tariff period.
4. Run every combination of (real consumption day × weather year) → a **distribution of annual savings** → P10/P50/P90 of payback, not a single number.
5. Add a battery as a simple dispatch rule on top (charge from PV surplus, discharge on deficit) and sweep capacities (e.g. 0 / 2 / 5 / 10 kWh) to find where the marginal euro stops paying.

This is the "curve intersection" in its most practical form: self-consumption _is_ the per-slot intersection between the consumption curve and the PV curve. The Pxx layer quantifies how robust that intersection is across weather years and across weekday/weekend and seasonal behavior.

Load-shifting assets (battery, smart water heater, EV charging timers) are evaluated with the same simulation: apply the shifting rule to the consumption curves and compare P50/P90 of cost before/after.

## Prices: when to care

- **Regulated / fixed-market tariff**: prices are constants — ignore spot markets entirely.
- **OMIE-indexed contract** (mercado liberalizado, indexed): cost = residual import (slot by slot) × hourly OMIE price. Price is a third curve and it is **negatively correlated with sunshine** (merit-order effect in Iberia). Two consequences: exported surplus sells cheap; evening imports are expensive. Both make batteries look _better_ than naive constant-price math suggests. OMIE publishes historical hourly prices that can be sampled the same way we sample weather years.

## Sources

Methodology / evidence:

- Hong & Fan, "Probabilistic electric load forecasting: A tutorial review", Int. J. Forecasting 2016 — the reference framing for probabilistic (Pxx) energy forecasts: https://www.sciencedirect.com/science/article/abs/pii/S0169207015001508
- Hong, Pinson et al., "Probabilistic energy forecasting: GEFCom 2014 and beyond", free PDF: http://pierrepinson.com/docs/Hongetal2016.pdf
- Sevlian & Rajagopal, "Short Term Electricity Load Forecasting on Varying Levels of Aggregation", 2014 — aggregation scaling law: https://arxiv.org/abs/1404.0058
- "AI-driven household electricity load forecasting" survey, Artificial Intelligence Review 2025 — why single households break point models: https://link.springer.com/article/10.1007/s10462-026-11583-w
- "A global probabilistic approach for short-term forecasting of individual households electricity consumption", Applied Energy 2024: https://www.sciencedirect.com/science/article/pii/S0306261924025522
- Ciocia et al., "Self-Consumption and Self-Sufficiency in PV Systems: Effect of Grid Limitation and Storage Installation", 2021 — PV + battery sizing for residential prosumers (open PDF): https://iris.polito.it/retrieve/e384c434-1797-d4b2-e053-9f05fe0a1d67/energies-14-01591-v2.pdf
- Alves e Silva, Lorenzo et al., "Sizing Photovoltaic Self-Consumption Systems for Sustainable Decision-Making" — PVGIS + real consumption data, Spanish (close to PT) context (open PDF): https://oa.upm.es/95740/1/10471146.pdf

Background / tools:

- PVGIS (EU JRC): https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en
- PVGIS TMY generator (and per-year data): https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/pvgis-5-tools/pvgis-typical-meteorological-year-tmy-generator_en
- Wikipedia: Self-consumption (SCR/SSR definitions): https://en.wikipedia.org/wiki/Self-consumption
- Wikipedia: Probabilistic forecasting: https://en.wikipedia.org/wiki/Probabilistic_forecasting
- Durante et al., "A Multivariate Dependence Analysis for Electricity Prices, Demand and Renewable Energy Sources", 2022 — price/load/renewables dependence via copulas: https://arxiv.org/abs/2201.01132
