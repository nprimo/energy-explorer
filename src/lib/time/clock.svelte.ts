// Reactive wall-clock reading for a fixed IANA time zone. Returns an object
// whose `current` property updates on an interval, so any `$derived` or
// template reading it re-renders as time passes.
//
// Uses onMount (not $effect) because the interval has no reactive
// dependencies: it is a one-shot client-side setup with teardown on destroy.
// $state lives in a .svelte.ts module so the mutation is reactive.

import { onMount } from "svelte";
import type { DayKind } from "$lib/consumption/profile";

export type ClockReading = {
  /** Minutes since local midnight in the target zone (0–1439). */
  readonly minutes: number;
  /** Zero-padded "HH:MM" label in the target zone. */
  readonly label: string;
  /** Day classification in the target zone (see CONTEXT.md — "Day classification").
   *  Plain day-of-week only: a public holiday on a weekday still reads "workday". */
  readonly dayKind: DayKind;
};

export function useClock(
  timeZone: string,
  intervalMs = 10_000,
): { readonly current: ClockReading } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });

  function read(): ClockReading {
    const parts = formatter.formatToParts(new Date());
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const hour = part("hour") % 24;
    const minute = part("minute");
    const minutes = hour * 60 + minute;
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    return {
      minutes,
      label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      dayKind: weekday === "Sat" || weekday === "Sun" ? "weekend" : "workday",
    };
  }

  const clock = $state({ current: read() });

  onMount(() => {
    const id = setInterval(() => {
      clock.current = read();
    }, intervalMs);
    return () => clearInterval(id);
  });

  return {
    get current() {
      return clock.current;
    },
  };
}
