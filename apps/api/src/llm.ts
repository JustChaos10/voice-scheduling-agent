import OpenAI from "openai";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import type { ExtractedFields, SessionState } from "./types.js";

const rawExtractionSchema = z.object({
  name: z.string().nullable().optional(),
  datetimeText: z.string().nullable().optional(),
  meetingTitle: z.string().nullable().optional(),
  confirmationIntent: z.enum(["yes", "no"]).nullable().optional(),
  skipTitle: z.boolean().nullable().optional()
});

const yesPattern = /\b(yes|yeah|yep|yup|yas|yea|yesh|guess|correct|confirm|sounds good|that works|sure|go ahead|proceed|okay|ok)\b/i;
const noPattern = /\b(no|nope|nah|wrong|change|incorrect|not right|don't)\b/i;
const skipTitlePattern = /\b(skip|no title|none|untitled|no meeting title)\b/i;
const namePattern = /\b(my name is|i am|i'm)\s+([a-z][a-z '\-]{1,40})/i;
const dateTimeHintPattern =
  /\b(today|tomorrow|tonight|morning|afternoon|evening|am|pm|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|next|at)\b|\d{1,2}(:\d{2})?/i;

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function heuristicExtraction(userMessage: string, stage: SessionState["stage"]): ExtractedFields {
  const extracted: ExtractedFields = {};
  const trimmed = userMessage.trim();

  const nameMatch = trimmed.match(namePattern);
  if (nameMatch?.[2]) {
    extracted.name = titleCase(nameMatch[2].trim());
  } else if (stage === "collect_name") {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > 0 && words.length <= 3) {
      extracted.name = titleCase(trimmed.replace(/[^\w '\-]/g, "").trim());
    }
  }

  if (yesPattern.test(trimmed)) {
    extracted.confirmationIntent = "yes";
  } else if (noPattern.test(trimmed)) {
    extracted.confirmationIntent = "no";
  }

  if (skipTitlePattern.test(trimmed)) {
    extracted.skipTitle = true;
  }

  if (stage === "collect_datetime") {
    extracted.datetimeText = trimmed;
  } else if (stage === "confirm" && dateTimeHintPattern.test(trimmed)) {
    extracted.datetimeText = trimmed;
  }

  if (stage === "collect_title_optional" && !extracted.skipTitle && trimmed.length > 1) {
    extracted.meetingTitle = trimmed;
  }

  return extracted;
}

function normalizeText(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : undefined;
}

export class FieldExtractor {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: AppConfig) {
    this.model = config.GROQ_MODEL;
    this.client = config.GROQ_API_KEY
      ? new OpenAI({
          apiKey: config.GROQ_API_KEY,
          baseURL: "https://api.groq.com/openai/v1"
        })
      : null;
  }

  async extract(userMessage: string, state: SessionState): Promise<ExtractedFields> {
    const heuristic = heuristicExtraction(userMessage, state.stage);
    if (!this.client) {
      return heuristic;
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Extract scheduling fields from a single user utterance. Return only JSON with keys: name, datetimeText, meetingTitle, confirmationIntent, skipTitle. Use null for unknown."
          },
          {
            role: "user",
            content: JSON.stringify({
              stage: state.stage,
              knownState: {
                name: state.name,
                meetingTitle: state.meetingTitle,
                startAtIso: state.startAtIso
              },
              utterance: userMessage
            })
          }
        ]
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = rawExtractionSchema.parse(JSON.parse(raw));

      return {
        name: normalizeText(parsed.name) ?? heuristic.name,
        datetimeText: normalizeText(parsed.datetimeText) ?? heuristic.datetimeText,
        meetingTitle: normalizeText(parsed.meetingTitle) ?? heuristic.meetingTitle,
        confirmationIntent: parsed.confirmationIntent ?? heuristic.confirmationIntent ?? null,
        skipTitle: parsed.skipTitle ?? heuristic.skipTitle
      };
    } catch {
      return heuristic;
    }
  }
}
