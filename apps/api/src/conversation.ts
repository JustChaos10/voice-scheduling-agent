import type { FastifyBaseLogger } from "fastify";
import { DateTime } from "luxon";

import { createCalendarEvent } from "./calendar.js";
import type { AppConfig } from "./config.js";
import { buildDefaultTitle, formatDateTimeForConfirmation, parseDateTimeInZone } from "./date-utils.js";
import { FieldExtractor } from "./llm.js";
import { SessionStore } from "./session-store.js";
import type { ConfirmResponse, ExtractedFields, MessageResponse, SessionState, StartSessionResponse } from "./types.js";

export class ConversationEngine {
  private readonly extractor: FieldExtractor;

  constructor(
    private readonly config: AppConfig,
    private readonly store: SessionStore,
    private readonly logger: FastifyBaseLogger
  ) {
    this.extractor = new FieldExtractor(config);
  }

  startSession(requestedTimezone?: string): StartSessionResponse {
    const timezone = this.resolveTimezone(requestedTimezone);
    const state = this.store.create({
      stage: "collect_name",
      name: null,
      meetingTitle: null,
      startAtIso: null,
      timezone,
      durationMin: this.config.DEFAULT_DURATION_MIN,
      pendingField: "name",
      readyToConfirm: false
    });

    return {
      sessionId: state.sessionId,
      assistantMessage:
        "Hello. I can help schedule a meeting. What is your name?",
      state
    };
  }

  async handleMessage(sessionId: string, userMessage: string): Promise<MessageResponse> {
    const state = this.getSessionOrThrow(sessionId);
    const trimmed = userMessage.trim();
    if (!trimmed) {
      throw new Error("Message cannot be empty.");
    }

    if (state.stage === "completed") {
      return {
        assistantMessage: "Your meeting has already been scheduled in this session.",
        state,
        extractedFields: {},
        readyToConfirm: false
      };
    }

    const extractedFields = await this.extractor.extract(trimmed, state);
    let assistantMessage = "";

    switch (state.stage) {
      case "collect_name": {
        if (extractedFields.name && extractedFields.name.length > 1) {
          state.name = extractedFields.name;
          state.stage = "collect_datetime";
          state.pendingField = "startAtIso";
          assistantMessage = `Nice to meet you, ${state.name}. What date and time do you prefer for the meeting?`;
        } else {
          assistantMessage = "I did not catch your name. Please say your name clearly.";
        }
        break;
      }
      case "collect_datetime": {
        const parse = parseDateTimeInZone(extractedFields.datetimeText ?? trimmed, state.timezone);
        if (!parse.iso) {
          assistantMessage = `${parse.error} Please tell me the date and time again.`;
        } else {
          state.startAtIso = parse.iso;
          state.stage = "collect_title_optional";
          state.pendingField = "meetingTitle";
          assistantMessage = "Great. Do you want to add a meeting title? You can say skip.";
        }
        break;
      }
      case "collect_title_optional": {
        if (extractedFields.skipTitle) {
          state.meetingTitle = buildDefaultTitle(state.name ?? "Guest");
        } else if (extractedFields.meetingTitle && extractedFields.meetingTitle.length > 1) {
          state.meetingTitle = extractedFields.meetingTitle;
        } else {
          assistantMessage = "Please share a meeting title, or say skip.";
          break;
        }

        state.stage = "confirm";
        state.pendingField = null;
        state.readyToConfirm = true;
        assistantMessage = this.buildConfirmationMessage(state);
        break;
      }
      case "confirm": {
        const changed = this.applyConfirmStageEdits(state, extractedFields, trimmed);
        if (changed) {
          assistantMessage = this.buildConfirmationMessage(state);
        } else if (extractedFields.confirmationIntent) {
          assistantMessage =
            "I heard your confirmation intent. I will proceed when the confirm action is called.";
        } else {
          assistantMessage = "Tell me what to change: name, date and time, or title.";
        }
        state.readyToConfirm = true;
        break;
      }
    }

    this.store.save(state);
    return {
      assistantMessage,
      state,
      extractedFields,
      readyToConfirm: state.readyToConfirm
    };
  }

  async handleConfirm(sessionId: string, confirmed: boolean): Promise<ConfirmResponse> {
    const state = this.getSessionOrThrow(sessionId);

    if (state.stage !== "confirm") {
      return {
        assistantMessage: "I still need the meeting details before confirmation.",
        eventCreated: false,
        eventLink: null,
        state
      };
    }

    if (!confirmed) {
      state.readyToConfirm = false;
      this.store.save(state);
      return {
        assistantMessage: "No problem. Tell me what to change: name, date and time, or title.",
        eventCreated: false,
        eventLink: null,
        state
      };
    }

    if (!state.name || !state.meetingTitle || !state.startAtIso) {
      return {
        assistantMessage: "I am missing required details. Please provide name, date/time, and title.",
        eventCreated: false,
        eventLink: null,
        state
      };
    }

    try {
      const eventLink = await createCalendarEvent(
        {
          name: state.name,
          meetingTitle: state.meetingTitle,
          startAtIso: state.startAtIso,
          timezone: state.timezone,
          durationMin: state.durationMin
        },
        this.config
      );

      state.stage = "completed";
      state.readyToConfirm = false;
      state.pendingField = null;
      this.store.save(state);

      return {
        assistantMessage: eventLink
          ? "Done. Your event is scheduled. I added the event link below."
          : "Done. Your event is scheduled.",
        eventCreated: true,
        eventLink,
        state
      };
    } catch (error) {
      this.logger.error({ error }, "Calendar event creation failed");
      return {
        assistantMessage:
          "I could not create the calendar event due to a calendar integration error. Please try again after checking credentials.",
        eventCreated: false,
        eventLink: null,
        state
      };
    }
  }

  private getSessionOrThrow(sessionId: string): SessionState {
    const state = this.store.get(sessionId);
    if (!state) {
      throw new Error("Session not found or expired.");
    }
    return state;
  }

  private buildConfirmationMessage(state: SessionState): string {
    if (!state.name || !state.meetingTitle || !state.startAtIso) {
      return "I still need complete details before confirmation. Please provide the missing information.";
    }
    const dateText = formatDateTimeForConfirmation(state.startAtIso, state.timezone);
    return `Please confirm the details: name ${state.name}, date and time ${dateText}, title ${state.meetingTitle}. Should I create the calendar event? Say yes or no.`;
  }

  private applyConfirmStageEdits(
    state: SessionState,
    extracted: ExtractedFields,
    fallbackMessage: string
  ): boolean {
    let changed = false;

    if (extracted.name && extracted.name !== state.name) {
      state.name = extracted.name;
      changed = true;
    }

    if (extracted.skipTitle && state.name) {
      const fallbackTitle = buildDefaultTitle(state.name);
      if (state.meetingTitle !== fallbackTitle) {
        state.meetingTitle = fallbackTitle;
        changed = true;
      }
    } else if (extracted.meetingTitle && extracted.meetingTitle !== state.meetingTitle) {
      state.meetingTitle = extracted.meetingTitle;
      changed = true;
    }

    if (extracted.datetimeText) {
      const parsed = parseDateTimeInZone(extracted.datetimeText ?? fallbackMessage, state.timezone);
      if (parsed.iso && parsed.iso !== state.startAtIso) {
        state.startAtIso = parsed.iso;
        changed = true;
      }
    }

    return changed;
  }

  private resolveTimezone(requestedTimezone?: string): string {
    const candidate = requestedTimezone?.trim();
    if (!candidate) {
      return this.config.DEFAULT_TIMEZONE;
    }

    const test = DateTime.now().setZone(candidate);
    if (test.isValid) {
      return candidate;
    }

    return this.config.DEFAULT_TIMEZONE;
  }
}
