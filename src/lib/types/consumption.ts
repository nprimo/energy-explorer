// This is the JSON contract returned by /api/consumption. It stays separate from
// the server-only ReadingRow database model, whose fields and timestamp name differ.
export type ConsumptionReading = {
  timestamp: string;
  valueWh: number;
  status: string;
};

export type ConsumptionResponse = {
  cpe: string;
  register: string;
  startDate: string;
  endDate: string;
  source: "cache" | "api" | "partial";
  count: number;
  readings: ConsumptionReading[];
};
