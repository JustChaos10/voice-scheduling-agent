import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { parseDateTimeInZone } from "./date-utils.js";

describe("parseDateTimeInZone", () => {
  it("parses explicit future date and time", () => {
    const now = DateTime.fromISO("2026-02-19T09:00:00", { zone: "America/New_York" });
    const result = parseDateTimeInZone("February 20 at 3:30 PM", "America/New_York", now);
    expect(result.iso).toBe("2026-02-20T15:30:00-05:00");
    expect(result.error).toBeNull();
  });

  it("rejects missing time", () => {
    const now = DateTime.fromISO("2026-02-19T09:00:00", { zone: "America/New_York" });
    const result = parseDateTimeInZone("next Friday", "America/New_York", now);
    expect(result.iso).toBeNull();
    expect(result.error).toContain("specific time");
  });

  it("treats 'day after' as day after tomorrow", () => {
    const now = DateTime.fromISO("2026-02-21T10:00:00", { zone: "Asia/Kolkata" });
    const result = parseDateTimeInZone("day after 1:00 a.m.", "Asia/Kolkata", now);
    expect(result.iso).toBe("2026-02-23T01:00:00+05:30");
    expect(result.error).toBeNull();
  });
});
