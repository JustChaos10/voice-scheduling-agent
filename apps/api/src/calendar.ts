import { DateTime } from "luxon";
import { google } from "googleapis";

import type { AppConfig } from "./config.js";
import type { CreateEventInput } from "./types.js";

function requireCalendarConfig(config: AppConfig): void {
  if (!config.GOOGLE_CLIENT_EMAIL || !config.GOOGLE_PRIVATE_KEY || !config.GOOGLE_CALENDAR_ID) {
    throw new Error(
      "Google Calendar credentials are missing. Set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_CALENDAR_ID."
    );
  }
}

export async function createCalendarEvent(input: CreateEventInput, config: AppConfig): Promise<string | null> {
  requireCalendarConfig(config);

  const auth = new google.auth.JWT({
    email: config.GOOGLE_CLIENT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  const calendar = google.calendar({ version: "v3", auth });
  const start = DateTime.fromISO(input.startAtIso, { zone: input.timezone });
  const end = start.plus({ minutes: input.durationMin });

  const response = await calendar.events.insert({
    calendarId: config.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: input.meetingTitle,
      description: `Scheduled by Voice Scheduling Agent for ${input.name}.`,
      start: {
        dateTime: start.toISO(),
        timeZone: input.timezone
      },
      end: {
        dateTime: end.toISO(),
        timeZone: input.timezone
      }
    }
  });

  return response.data.htmlLink ?? null;
}

