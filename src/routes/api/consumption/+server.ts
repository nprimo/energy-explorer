import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  ERedesClient,
  ERedesAuthenticationError,
  ERedesConnectionError,
  ERedesError,
} from "$lib/server/eredes";

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export const GET: RequestHandler = async ({ url }) => {
  const cpe = env.EREDES_CPE;
  const aat = env.EREDES_AAT;
  if (!cpe || !aat) {
    throw error(500, "Missing EREDES_CPE or EREDES_AAT env vars. Copy .env.example to .env.");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const start = parseDateParam(url.searchParams.get("start"), yesterday);
  const end = parseDateParam(url.searchParams.get("end"), today);
  if (!start || !end) throw error(400, "Invalid date. Use YYYY-MM-DD.");
  if (start > end) throw error(400, "start must be <= end");

  const client = new ERedesClient(aat);
  try {
    const data = await client.getConsumption(cpe, start, end);
    return json(data);
  } catch (ex) {
    if (ex instanceof ERedesAuthenticationError) throw error(401, ex.message);
    if (ex instanceof ERedesConnectionError) throw error(502, ex.message);
    if (ex instanceof ERedesError) throw error(502, ex.message);
    throw ex;
  }
};
