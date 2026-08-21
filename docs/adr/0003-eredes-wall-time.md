# E-REDES observations - hypothesis

When using the dashboard, the star datetime is always 00:15:00 -> I assume the
timestamp is referring to the end of the 15 min time period. E.g. 2025-03-01
00:15:00 - 23 Wh means that there was a consumption of 23 Wh between 00:00:00
and 00:15:00

Example of payload for march:

```json
{
    "loadCurveTimestamp": "2026-03-29T00:30:00Z",
    "meterLoadCurve": 0.01,
    "meterLoadCurveStatus": "1",
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2026-03-29T00:45:00Z",
    "meterLoadCurve": 0.009,
    "meterLoadCurveStatus": "1",
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2026-03-29T02:00:00Z",
    "meterLoadCurve": 0.008,
    "meterLoadCurveStatus": "1",
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2026-03-29T02:15:00Z",
    "meterLoadCurve": 0.007,
    "meterLoadCurveStatus": "1",
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2026-03-29T02:30:00Z",
    "meterLoadCurve": 0.007,
    "meterLoadCurveStatus": "1",
    "meterLoadCurveUnitMeasurement": "kwh"
},
```

Example of october:

```json
{
    "loadCurveTimestamp": "2025-10-26T00:30:00Z",
    "meterLoadCurve": 0.017,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T00:45:00Z",
    "meterLoadCurve": 0.016,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:00:00Z",
    "meterLoadCurve": 0.016,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:00:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:15:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:15:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:30:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:30:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:45:00Z",
    "meterLoadCurve": 0.015,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T01:45:00Z",
    "meterLoadCurve": 0.014,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T02:00:00Z",
    "meterLoadCurve": 0.014,
    "meterLoadCurveUnitMeasurement": "kwh"
},
{
    "loadCurveTimestamp": "2025-10-26T02:15:00Z",
    "meterLoadCurve": 0.013,
    "meterLoadCurveUnitMeasurement": "kwh"
},
```

In the payload, even if the timestamp finishes with 'Z', I assume it is
referring to the local time zone.
When pulling data for March, there is always a 1h gap when the time changes and
"jump forward": in UTC time there should be no gap - time is linear.
