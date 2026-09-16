import { Context, Effect, Layer, Ref, Schema, flow } from "effect";
import * as Cookies from "effect/unstable/http/Cookies";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { FetchHttpClient } from "effect/unstable/http";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://balcaodigital.e-redes.pt";
const API_PATH = "/ms/reading/data-usage/edm/get";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/consumptions/history`,
  "User-Agent-Context": "WEB",
  "Show-Loader": "true",
};

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export class ConsumptionReading extends Schema.Class<ConsumptionReading>(
  "eredes/ConsumptionReading",
)({
  timestamp: Schema.String,
  valueWh: Schema.Number,
  status: Schema.String,
}) {}

export class ConsumptionData extends Schema.Class<ConsumptionData>("eredes/ConsumptionData")({
  cpe: Schema.String,
  readings: Schema.Array(ConsumptionReading),
  startDate: Schema.String,
  endDate: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ERedesAuthenticationError extends Schema.TaggedError<ERedesAuthenticationError>()(
  "ERedesAuthenticationError",
  { message: Schema.String },
) {}

export class ERedesConnectionError extends Schema.TaggedError<ERedesConnectionError>()(
  "ERedesConnectionError",
  { message: Schema.String },
) {}

export class ERedesError extends Schema.TaggedError<ERedesError>()("ERedesError", {
  message: Schema.String,
}) {}

export type ERedesServiceError = ERedesAuthenticationError | ERedesConnectionError | ERedesError;

// ---------------------------------------------------------------------------
// Raw upstream shapes
// ---------------------------------------------------------------------------

class RawLoadCurve extends Schema.Struct({
  loadCurveTimestamp: Schema.optional(Schema.String),
  meterLoadCurve: Schema.optional(Schema.Number),
  meterLoadCurveUnitMeasurement: Schema.optional(Schema.String),
  meterLoadCurveStatus: Schema.optional(Schema.String),
}) {}

class RawMeterLoadCurveGroup extends Schema.Struct({
  register: Schema.optional(Schema.String),
  loadCurves: Schema.optional(Schema.Array(RawLoadCurve)),
}) {}

class RawUtilitiesDevice extends Schema.Struct({
  meterLoadCurves: Schema.optional(Schema.Array(RawMeterLoadCurveGroup)),
}) {}

class RawResponse extends Schema.Struct({
  Body: Schema.optional(
    Schema.Struct({
      Success: Schema.optional(Schema.Boolean),
      Result: Schema.optional(
        Schema.Struct({
          utilitiesDevices: Schema.optional(Schema.Array(RawUtilitiesDevice)),
        }),
      ),
    }),
  ),
}) {}

const decodeRawResponse = Schema.decodeUnknownEffect(RawResponse);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a `Cookie`-style header into a record of name -> value. */
function parseCookies(cookieString: string): Record<string, string> {
  return Cookies.parseHeader(cookieString);
}

/** Normalize an access token into a cookie record, ensuring `aat` is present. */
function normalizeCookies(accessToken: string): Record<string, string> {
  const stripped = accessToken.trim();
  const cookies = parseCookies(stripped);
  if (!("aat" in cookies)) {
    const bare = stripped.replace(/;+\s*$/, "").trim();
    if (bare) cookies.aat = bare;
  }
  return cookies;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const LISBON_TZ = "Europe/Lisbon";

/** Offset for a UTC instant in a given IANA zone: wallMs - utcMs. */
function getTzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const wallMs = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return wallMs - date.getTime();
}

/** Convert a Lisbon wall time (Y,M,D,h,m,s) to the correct UTC instant. */
function lisbonWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Iterate to converge when offset changes across DST transition.
  let utcMs = wallMs - getTzOffsetMs(new Date(wallMs), LISBON_TZ);
  utcMs = wallMs - getTzOffsetMs(new Date(utcMs), LISBON_TZ);
  return new Date(utcMs);
}

function lastSundayOfOctober(year: number): number {
  const dow = new Date(Date.UTC(year, 9, 31)).getUTCDay(); // 9=Oct, 0=Sun
  return 31 - dow; // 25..31
}

function isFallBackAmbiguousWall(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): boolean {
  return (
    m === 10 &&
    d === lastSundayOfOctober(y) &&
    h === 1 &&
    (mi === 0 || mi === 15 || mi === 30 || mi === 45) &&
    s === 0
  );
}

/** Parse a wall string to components, returns null if format invalid. */
function parseWallComponents(
  s: string,
): { y: number; m: number; d: number; h: number; mi: number; se: number } | null {
  const normalized = s.endsWith("Z") ? s.slice(0, -1) : s;
  const withT = normalized.includes(" ") ? normalized.replace(" ", "T") : normalized;
  const mm = withT.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!mm) return null;
  const [, Y, Mo, D, h, mi, se] = mm;
  return { y: +Y, m: +Mo, d: +D, h: +h, mi: +mi, se: +se };
}

/** Same as parseResponse but also returns warnings for unexpected duplicates. */
function parseResponseWithDiagnostics(
  cpe: string,
  data: Schema.Schema.Type<typeof RawResponse>,
  startDate: Date,
  endDate: Date,
): { data: ConsumptionData; warnings: string[] } {
  const readings: ConsumptionReading[] = [];
  const warnings: string[] = [];
  const body = data.Body;
  if (!body?.Success) {
    return {
      data: new ConsumptionData({
        cpe,
        readings,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }),
      warnings,
    };
  }
  // Track duplicates in payload order — only 01:00-01:45 on last Sunday of Oct is expected x2.
  const wallSeen = new Map<string, number>();
  const utcSeen = new Set<string>();
  const devices = body.Result?.utilitiesDevices ?? [];
  for (const device of devices) {
    for (const group of device.meterLoadCurves ?? []) {
      if (group.register !== "A+") continue;
      for (const curve of group.loadCurves ?? []) {
        const ts = curve.loadCurveTimestamp;
        const val = curve.meterLoadCurve;
        if (!ts || val === undefined || val === null) continue;
        const comp = parseWallComponents(ts);
        if (!comp) continue;
        const { y, m, d, h, mi, se } = comp;
        const isAmbiguous = isFallBackAmbiguousWall(y, m, d, h, mi, se);
        let parsed: Date | null = null;
        const seen = wallSeen.get(ts) ?? 0;
        if (isAmbiguous) {
          // Ordered: #1 = WEST (+1, earlier UTC), #2 = WET (+0, later UTC)
          const wallMs = Date.UTC(y, m - 1, d, h, mi, se);
          if (seen === 0) parsed = new Date(wallMs - 3600_000);
          else if (seen === 1) parsed = new Date(wallMs);
          else {
            warnings.push(
              `eredes duplicate: >2 occurrences for fallback wall=${ts} cpe=${cpe} occ=${seen + 1}`,
            );
            parsed = new Date(wallMs); // keep as WET for extras
          }
          wallSeen.set(ts, seen + 1);
        } else {
          if (seen > 0) {
            warnings.push(
              `eredes duplicate: wall=${ts} cpe=${cpe} occ=${seen + 1} outside fallback window (expected only 01:00-01:45 on last Sunday of Oct)`,
            );
          }
          wallSeen.set(ts, seen + 1);
          parsed = lisbonWallToUtc(y, m, d, h, mi, se);
        }
        if (!parsed || Number.isNaN(parsed.getTime())) continue;
        const iso = parsed.toISOString();
        if (utcSeen.has(iso)) {
          warnings.push(`eredes duplicate UTC: utc=${iso} wall=${ts} cpe=${cpe}`);
        }
        utcSeen.add(iso);
        const unit = (curve.meterLoadCurveUnitMeasurement ?? "").toLowerCase();
        const valueWh = Math.round(unit === "kwh" ? val * 1000 : val);
        const status = curve.meterLoadCurveStatus ?? "unknown";
        readings.push(
          new ConsumptionReading({
            timestamp: iso,
            valueWh,
            status,
          }),
        );
      }
    }
  }
  readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    data: new ConsumptionData({
      cpe,
      readings,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }),
    warnings,
  };
}

function errorToString(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Map an HttpClientError (transport / status) into the domain error union. */
function toDomainError(error: HttpClientError.HttpClientError): ERedesServiceError {
  switch (error.reason._tag) {
    case "TransportError":
      return new ERedesConnectionError({
        message: `Failed to fetch data: ${errorToString(error.reason.cause)}`,
      });
    case "StatusCodeError":
      return statusToDomainError(error.reason.response.status);
    default:
      return new ERedesError({ message: error.message });
  }
}

function statusToDomainError(status: number): ERedesServiceError {
  if (status === 401)
    return new ERedesAuthenticationError({
      message: "Token expired - please update your token",
    });
  if (status === 403)
    return new ERedesAuthenticationError({
      message: "Access denied - invalid token",
    });
  return new ERedesError({ message: `API request failed with status ${status}` });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ERedes extends Context.Service<
  ERedes,
  {
    readonly getConsumption: (
      cpe: string,
      startDate: Date,
      endDate: Date,
    ) => Effect.Effect<ConsumptionData, ERedesServiceError>;
  }
>()("eredes/ERedes") {
  /**
   * Build a live layer seeded with a specific E-Redes access token.
   *
   * The access token is either a full `Cookie` header or a bare `aat` value.
   * Cookies (including the rotating `PHPSESSID`) are maintained across
   * requests via the client's cookie ref.
   */
  static withAccessToken(accessToken: string): Layer.Layer<ERedes> {
    const cookies = normalizeCookies(accessToken);
    return Layer.effect(
      ERedes,
      Effect.gen(function* () {
        const cookiesRef = yield* Ref.make(
          Cookies.fromIterable(
            Object.entries(cookies).map(([k, v]) => Cookies.makeCookieUnsafe(k, v)),
          ),
        );
        const aatToken = cookies.aat ?? "";

        const client = (yield* HttpClient.HttpClient).pipe(
          HttpClient.mapRequest(
            flow(
              HttpClientRequest.prependUrl(BASE_URL),
              HttpClientRequest.setHeaders(COMMON_HEADERS),
              HttpClientRequest.setHeader("Authorization-Request", aatToken),
            ),
          ),
          HttpClient.withCookiesRef(cookiesRef),
          HttpClient.retryTransient({ times: 3 }),
        );

        const getConsumption = (
          cpe: string,
          startDate: Date,
          endDate: Date,
        ): Effect.Effect<ConsumptionData, ERedesServiceError> =>
          Effect.gen(function* () {
            const startIso = startDate.toISOString();
            const endIso = endDate.toISOString();
            yield* Effect.logInfo(`e-redes fetch: cpe=${cpe} range=[${startIso} → ${endIso}]`);

            const payload = {
              cpe,
              request_type: "3",
              start_date: formatDate(startDate),
              end_date: formatDate(endDate),
              wait: true,
              formatted: false,
              nif_requester: null,
              serial_number: "",
              nif: null,
            };

            const request = HttpClientRequest.post(API_PATH).pipe(
              HttpClientRequest.bodyJsonUnsafe(payload),
            );

            const response = yield* client
              .execute(request)
              .pipe(Effect.mapError((error) => toDomainError(error)));

            const result = yield* HttpClientResponse.matchStatus(response, {
              "2xx": () =>
                Effect.gen(function* () {
                  const body = yield* response.json.pipe(
                    Effect.mapError(
                      (cause) =>
                        new ERedesError({
                          message: `Failed to read response body: ${errorToString(cause)}`,
                        }),
                    ),
                  );
                  const raw = yield* decodeRawResponse(body).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ERedesError({
                          message: `Failed to decode response: ${errorToString(cause)}`,
                        }),
                    ),
                  );
                  const parsed = parseResponseWithDiagnostics(cpe, raw, startDate, endDate);
                  for (const w of parsed.warnings) {
                    yield* Effect.logWarning(w);
                  }
                  if (parsed.warnings.length > 0) {
                    yield* Effect.logInfo(
                      `eredes diagnostics: cpe=${cpe} warnings=${parsed.warnings.length} readings=${parsed.data.readings.length}`,
                    );
                  }
                  return parsed.data;
                }),
              [401]: () =>
                Effect.fail(
                  new ERedesAuthenticationError({
                    message: "Token expired - please update your token",
                  }),
                ),
              [403]: () =>
                Effect.fail(
                  new ERedesAuthenticationError({
                    message: "Access denied - invalid token",
                  }),
                ),
              orElse: (r) =>
                Effect.fail(
                  new ERedesError({
                    message: `API request failed with status ${r.status}`,
                  }),
                ),
            });

            yield* Effect.logInfo(
              `e-redes fetch ok: cpe=${cpe} range=[${startIso} → ${endIso}] n=${result.readings.length}`,
            );
            return result;
          }).pipe(
            Effect.catchTags({
              ERedesAuthenticationError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `e-redes fetch failed: cpe=${cpe} range=[${startDate.toISOString()} → ${endDate.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
              ERedesConnectionError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `e-redes fetch failed: cpe=${cpe} range=[${startDate.toISOString()} → ${endDate.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
              ERedesError: (err) =>
                Effect.gen(function* () {
                  yield* Effect.logError(
                    `e-redes fetch failed: cpe=${cpe} range=[${startDate.toISOString()} → ${endDate.toISOString()}] ${err._tag}: ${err.message}`,
                  );
                  return yield* Effect.fail(err);
                }),
            }),
            Effect.withSpan("ERedes.getConsumption", {
              attributes: {
                cpe,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
              },
            }),
          );

        return ERedes.of({ getConsumption });
      }),
    ).pipe(Layer.provide(FetchHttpClient.layer));
  }
}
