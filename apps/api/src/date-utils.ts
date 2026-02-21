import * as chrono from "chrono-node";
import { DateTime } from "luxon";

export interface DateTimeParseResult {
  iso: string | null;
  error: string | null;
}

function normalizeDateInput(input: string): string {
  const trimmed = input.trim();
  const dayAfterMatch = trimmed.match(/\bday after\b(?!\s+tomorrow)\s*(.*)$/i);
  if (dayAfterMatch) {
    const rawTail = (dayAfterMatch[1] ?? "").trim();
    if (!rawTail) {
      return "in 2 days";
    }

    const normalizedTail = rawTail.toLowerCase().startsWith("at ") ? rawTail : `at ${rawTail}`;
    return `in 2 days ${normalizedTail}`.trim();
  }

  return trimmed.replace(/\bafter tomorrow\b/gi, "in 2 days");
}

export function parseDateTimeInZone(
  input: string,
  timezone: string,
  nowInZone: DateTime = DateTime.now().setZone(timezone)
): DateTimeParseResult {
  const normalizedInput = normalizeDateInput(input);
  const results = chrono.parse(normalizedInput, nowInZone.toJSDate(), { forwardDate: true });
  if (!results.length) {
    return {
      iso: null,
      error: "I could not understand that date and time."
    };
  }

  const first = results[0];
  if (!first) {
    return {
      iso: null,
      error: "I could not understand that date and time."
    };
  }

  const components = first.start;
  if (!components.isCertain("hour")) {
    return {
      iso: null,
      error: "Please include a specific time, for example 3:30 PM."
    };
  }

  const dateTime = DateTime.fromObject(
    {
      year: components.get("year") ?? undefined,
      month: components.get("month") ?? undefined,
      day: components.get("day") ?? undefined,
      hour: components.get("hour") ?? undefined,
      minute: components.get("minute") ?? undefined,
      second: components.get("second") ?? undefined
    },
    { zone: timezone }
  );

  if (!dateTime.isValid) {
    return {
      iso: null,
      error: "That date and time was invalid. Please say it again."
    };
  }

  if (dateTime <= nowInZone.minus({ minutes: 1 })) {
    return {
      iso: null,
      error: "That time appears to be in the past. Please choose a future time."
    };
  }

  return {
    iso: dateTime.toISO({ suppressMilliseconds: true }),
    error: null
  };
}

export function formatDateTimeForConfirmation(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: timezone }).toFormat("cccc, LLLL d 'at' h:mm a");
}

export function buildDefaultTitle(name: string): string {
  return `Meeting with ${name}`;
}
