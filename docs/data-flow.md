# Data flow map

Status: living document. Update whenever a source, access path, or
transformation changes.

The map has two parts:

1. A flow diagram: questions → data → sources → access → transformations.
2. A source table: one row per source, with frequency and access details.

## How to read the diagram

- Green = public / free access
- Orange = API key required (official, paid or rate-limited)
- Red = unofficial access (auth meant for humans, can break without notice)
- Blue = data we own (our DB, our aggregates)

```mermaid
flowchart LR
    classDef free stroke:#2e7d32,color:#2e7d32
    classDef key stroke:#ef6c00,color:#ef6c00
    classDef unofficial stroke:#c62828,color:#c62828
    classDef ours stroke:#1565c0,color:#1565c0

    subgraph questions[Questions we want to answer]
        q1[What did I consume per day / period?]
        q2[Is my tariff the right one?]
        q3[What is the CO2 of my consumption?]
        q4[When do I use the most power?]
    end

    subgraph data[Data we care about]
        d1[Reading<br/>15-min kWh, per CPE]
        d2[Tariff offers<br/>energy + power prices]
        d3[Spot price<br/>OMIE €/MWh hourly]
        d4[CO2 intensity<br/>g/kWh hourly]
    end

    subgraph sources[Sources]
        s1[E-REDES<br/>DSO portal]
        s2[ERSE price simulator]
        s3[OMIE market results]
        s4[ElectricityMaps]
    end

    subgraph access[Access path]
        a1[Unofficial API<br/>token from login flow]
        a2[Public CSV in ZIP<br/>no auth]
        a3[Public files<br/>no auth]
        a4[Official REST API<br/>API key]
    end

    subgraph transform[Transformations]
        t1[Auth flow:<br/>login → token → refresh]
        t2[Unmarshal + validate<br/>effect schema]
        t3[Local time Lisbon →<br/>true UTC for storage]
        t4[CSV: semicolon split,<br/>decimal comma → number]
        t5[Aggregate:<br/>Reading → Consumption<br/>curves, aggregated curve]
    end

    subgraph store[Our storage]
        db[(Reading cache DB)]
    end

    subgraph views[Views]
        v1[Consumption curve<br/>per day]
        v2[Calendar heatmap]
        v3[Tariff comparison]
        v4[CO2 overlay]
    end

    %% questions to data
    q1 --> d1
    q2 --> d2
    q2 --> d3
    q3 --> d4
    q3 --> d1
    q4 --> d1

    %% data to sources
    d1 --- s1
    d2 --- s2
    d3 --- s3
    d4 --- s4

    %% sources to access
    s1 --> a1
    s2 --> a2
    s3 --> a3
    s4 --> a4

    %% access to transforms
    a1 --> t1 --> t2
    a2 --> t4 --> t2
    a3 --> t2
    a4 --> t2
    t2 --> t3 --> db

    %% store to views via aggregation
    db --> t5
    t5 --> v1
    t5 --> v2
    t5 --> v3
    t5 --> v4

    class s1,a1,t1 unofficial
    class s2,a2,s3,a3 free
    class s4,a4 key
    class db,t5,store ours
```

## Source table

| Source          | Data                                              | Update frequency                             | Access                  | Auth                                                  | Notes                                                          |
| --------------- | ------------------------------------------------- | -------------------------------------------- | ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| E-REDES         | Reading (15-min kWh)                              | ~D+1, published per day                      | Unofficial API          | Session token from login flow; expires, needs refresh | Only `A+` register today; future `A-` for solar                |
| ERSE simulator  | Tariff offers (all liberalized offers ≤ 41.4 kVA) | Periodic re-publication (path changes)       | Public CSV ZIP, no auth | None                                                  | Discover path via `Settings.json` → `csvPath`; do not hardcode |
| OMIE            | Spot price €/MWh, hourly                          | Daily, after market close (~13:00–18:00 CET) | Public files, no auth   | None                                                  | Portugal + Spain zones                                         |
| ElectricityMaps | CO2 intensity g/kWh                               | Hourly (historical) / live (real-time)       | Official REST API       | API key, free tier is rate-limited                    | Zone PT                                                        |

## Open questions

- Estimated vs. real readings: which E-REDES flag marks them, and where do we
  store that?
- Does the tariff comparison need invoice periods (22nd–21st) or are civil
  months enough? (currently future scope)
- Which OMIE price applies: day-ahead hourly, or a fixed indexed formula?
