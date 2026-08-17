# ERSE offer data periodic pull

Status: proposal - no code changed.

## Objective

Make Portugal electricity offers available to the site for search, filtering,
comparison, and estimated-cost calculations.

ERSE states that its simulator includes all offers in the liberalized market in
mainland Portugal for contracted powers up to 41.4 kVA.

This does not guarantee coverage of Madeira, Azores, private or invitation-only
offers, offers outside the power range, or offers that commercializers have not
supplied to ERSE.

## 1. Fetch ERSE data

### Source discovery

Do not hard code the CSV ZIP filename. ERSE publishes the current path through:

```text
GET https://simuladorprecos.erse.pt/config/Settings.json
```

Read the `csvPath` property:

```json
{
  "csvPath": "https://simuladorprecos.erse.pt/Admin/csvs/... CSV.zip"
}
```

The URL changes when ERSE publishes a new dataset.

### Current ZIP contents

The ZIP contains two files:

```text
csv\\CondComerciais.csv
csv\\Precos_ELEGN.csv
```

The files use semicolon delimiters. Numeric values use Portuguese decimal
commas, for example `0,1548`.

### `CondComerciais.csv`

Contains offer metadata and commercial conditions:

- Commercializer code and offer code
- Offer name
- Market segment: domestic or non-domestic
- Supply type: electricity or gas
- Offer validity dates
- Contract duration and loyalty period
- Contracting methods
- Billing and payment methods
- Discounts and reimbursements
- Fixed-price and indexed-price flags
- Renewable-energy flag
- Social-tariff eligibility
- New-customer eligibility
- Additional-service requirements
- Restrictions and restriction descriptions
- Commercializer URLs
- Standard offer-sheet and contract-condition URLs
- Contact information

Important columns include `COM`, `COD_Proposta`, `NomeProposta`,
`Fornecimento`, `Data ini`, `Data fim`, `FiltroFidelizacao`,
`FiltroPrecosIndex_ELE`, `FiltroRenovavel_ELE`, `FiltroNovosClientes`,
`LinkOfertaCom`, `LinkFichaPadrao`, and `LinkCondicoesGerais`.

### `Precos_ELEGN.csv`

Contains prices by offer variant:

- Commercializer code
- Offer code
- Contracted power
- Tariff cycle
- Fixed term price
- Energy price
- Peak price
- Off-peak price
- Super-off-peak price
- Gas price fields where applicable

Important columns include `COM`, `COD_Proposta`, `Pot_Cont`, `Contagem`, `TF`,
`TV`, `TVFV|TVP`, and `TVV|TVC`.

### Import schedule

Run the importer daily. More frequent polling is unnecessary unless ERSE publication frequency requires it.

For each run:

1. Fetch `Settings.json`.
2. Read `csvPath`.
3. Compare the URL and content hash with the latest import.
4. Download the ZIP only when the dataset changed.
5. Store the original ZIP and import metadata.
6. Parse both CSV files.
7. Filter electricity rows using `Fornecimento == ELE`.
8. Validate dates, prices, required identifiers, and joins.
9. Mark no-longer-valid offers unavailable; do not delete them.
10. Log row counts, malformed values, unknown columns, and failed joins.

The importer should use a descriptive user agent, low request volume, timeouts,
retries with back off, and cached downloads.

## 2. Storage strategy

Use both raw storage and normalized database tables.

### Raw archive

Store:

- Original ZIP
- Extracted CSV files, if useful for operations
- Source `csvPath`
- Fetch timestamp
- Dataset hash
- ERSE publication timestamp, when available

Raw data provides:

- Auditability
- Reprocessing after parser changes
- Recovery after schema changes
- Historical comparisons
- Evidence of the original source values

Raw files should not be parsed on every website request.

### Normalized data

Suggested entities:

```text
offer_imports
commercializers
offers
offer_prices
offer_conditions
offer_links
```

Suggested `offers` fields:

```text
id
source_offer_code
commercializer_id
name
segment
supply_type
valid_from
valid_to
contract_duration_months
loyalty_required
indexed_price
fixed_price
renewable_energy
new_customer_only
social_tariff_available
status
import_id
```

Suggested `offer_prices` fields:

```text
offer_id
contracted_power_kva
tariff_cycle
fixed_term_price
energy_price
peak_price
off_peak_price
super_off_peak_price
valid_from
valid_to
import_id
```

Keep raw source values for fields whose meaning is uncertain, for example in
`raw_conditions` or `raw_price_row` JSON columns.

### Why normalize?

Normalized data makes common site queries straightforward:

- Find valid electricity offers
- Filter by contracted power and tariff cycle
- Compare fixed and indexed offers
- Search by commercializer
- Filter new-customer-only offers
- Show renewable offers
- Track price changes
- Calculate estimated annual cost

Using CSV files directly would require every request to parse files, convert
decimal formats, join offer and price records, interpret flags, handle expiry,
and apply filters. That is slower, harder to validate, and couples the website
to ERSE's file format.

### Keep source prices, not only calculated totals

Do not store only one calculated annual bill. Store source price components and
calculate estimates from the user's profile:

```text
consumption
contracted_power
tariff_cycle
fixed_term_price
energy_price
taxes
discounts
services
```

This supports different consumption profiles and makes calculations explainable.

## 3. Data life cycle

Use imports as immutable dataset versions.

Each normalized row should reference `import_id`. When a new dataset arrives:

1. Create a new import record.
2. Load and validate new rows.
3. Run comparison checks against the previous import.
4. Publish the new import atomically.
5. Keep previous imports for history and rollback.

Useful comparison metrics:

- Added offers
- Removed offers
- Changed validity dates
- Changed price components
- Changed restrictions
- Commercializers added or removed
- Offers with broken source links

## 4. ERSE simulator API

The simulator also exposes:

```text
POST https://simuladorprecos.erse.pt/connectors/simular_eletricidade/
```

It returns scenario-specific rankings and calculated totals. Use it as a
secondary integration for validating calculations or reproducing ERSE rankings.

Do not use it as the primary offer catalogue because results depend on
consumption parameters and filters. The CSV dataset is better for bulk offer
storage.

## 5. Proposed architecture

```text
ERSE Settings.json
        |
        v
Scheduled importer
        |
        +--> Raw ZIP/CSV archive
        |
        +--> Normalized offer database
                    |
                    +--> Price calculation service
                    |
                    +--> Website search/comparison UI
```

## References

- ERSE simulator scope: <https://www.erse.pt/simuladores/precos-de-energia/>
- ERSE simulator: <https://simuladorprecos.erse.pt/eletricidade/>
- Simulator settings: <https://simuladorprecos.erse.pt/config/Settings.json>
- Simulator manual: <https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf>
