const BASE_URL = "https://balcaodigital.e-redes.pt";
const API_URL = `${BASE_URL}/ms/reading/data-usage/edm/get`;

export interface ConsumptionReading {
  timestamp: string;
  valueWh: number;
}

export interface ConsumptionData {
  cpe: string;
  readings: ConsumptionReading[];
  startDate: string;
  endDate: string;
}

export class ERedesAuthenticationError extends Error {}
export class ERedesConnectionError extends Error {}
export class ERedesError extends Error {}

interface RawLoadCurve {
  loadCurveTimestamp?: string;
  meterLoadCurve?: number;
  meterLoadCurveUnitMeasurement?: string;
}

interface RawMeterLoadCurveGroup {
  register?: string;
  loadCurves?: RawLoadCurve[];
}

interface RawUtilitiesDevice {
  meterLoadCurves?: RawMeterLoadCurveGroup[];
}

interface RawResponse {
  Body?: {
    Success?: boolean;
    Result?: {
      utilitiesDevices?: RawUtilitiesDevice[];
    };
  };
}

function parseCookies(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) cookies[key] = val;
  }
  return cookies;
}

function normalizeCookies(accessToken: string): Record<string, string> {
  const stripped = accessToken.trim();
  const cookies = parseCookies(stripped);
  if (!("aat" in cookies)) {
    const bare = stripped.replace(/;+\s*$/, "").trim();
    if (bare) cookies.aat = bare;
  }
  return cookies;
}

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTimestamp(s: string): Date | null {
  const formats = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  ];
  if (!formats.some((re) => re.test(s))) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class ERedesClient {
  private cookies: Record<string, string>;
  private aatToken: string;
  private cookieHeader: string;

  constructor(accessToken: string) {
    this.cookies = normalizeCookies(accessToken);
    this.aatToken = this.cookies.aat ?? "";
    this.cookieHeader = buildCookieHeader(this.cookies);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/consumptions/history`,
      "User-Agent-Context": "WEB",
      "Show-Loader": "true",
      Cookie: this.cookieHeader,
    };
    if (this.aatToken) headers["Authorization-Request"] = this.aatToken;
    return headers;
  }

  async getConsumption(cpe: string, startDate: Date, endDate: Date): Promise<ConsumptionData> {
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

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (ex) {
      throw new ERedesConnectionError(
        `Failed to fetch data: ${ex instanceof Error ? ex.message : String(ex)}`,
      );
    }

    const setCookie = response.headers.get("set-cookie") ?? "";
    const m = setCookie.match(/PHPSESSID=([^;]+)/);
    if (m && m[1] !== (this.cookies.PHPSESSID ?? "")) {
      this.cookies.PHPSESSID = m[1];
      this.cookieHeader = buildCookieHeader(this.cookies);
    }

    if (response.status === 401)
      throw new ERedesAuthenticationError("Token expired - please update your token");
    if (response.status === 403)
      throw new ERedesAuthenticationError("Access denied - invalid token");
    if (response.status !== 200)
      throw new ERedesError(`API request failed with status ${response.status}`);

    const data = (await response.json()) as RawResponse;
    return this.parseResponse(cpe, data, startDate, endDate);
  }

  private parseResponse(
    cpe: string,
    data: RawResponse,
    startDate: Date,
    endDate: Date,
  ): ConsumptionData {
    const readings: ConsumptionReading[] = [];
    const body = data.Body;
    if (!body?.Success) {
      return { cpe, readings, startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    }
    const devices = body.Result?.utilitiesDevices ?? [];
    for (const device of devices) {
      for (const group of device.meterLoadCurves ?? []) {
        if (group.register !== "A+") continue;
        for (const curve of group.loadCurves ?? []) {
          const ts = curve.loadCurveTimestamp;
          const val = curve.meterLoadCurve;
          if (!ts || val === undefined || val === null) continue;
          const parsed = parseTimestamp(ts);
          if (!parsed) continue;
          const unit = (curve.meterLoadCurveUnitMeasurement ?? "").toLowerCase();
          const valueWh = unit === "kwh" ? val * 1000 : val;
          readings.push({ timestamp: parsed.toISOString(), valueWh });
        }
      }
    }
    readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { cpe, readings, startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  }
}
