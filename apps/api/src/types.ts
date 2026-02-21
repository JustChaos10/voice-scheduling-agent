export type Stage =
  | "collect_name"
  | "collect_datetime"
  | "collect_title_optional"
  | "confirm"
  | "completed";

export type PendingField = "name" | "startAtIso" | "meetingTitle" | null;

export interface SessionState {
  sessionId: string;
  stage: Stage;
  name: string | null;
  meetingTitle: string | null;
  startAtIso: string | null;
  timezone: string;
  durationMin: number;
  pendingField: PendingField;
  readyToConfirm: boolean;
}

export interface ExtractedFields {
  name?: string;
  datetimeText?: string;
  meetingTitle?: string;
  confirmationIntent?: "yes" | "no" | null;
  skipTitle?: boolean;
}

export interface CreateEventInput {
  name: string;
  meetingTitle: string;
  startAtIso: string;
  timezone: string;
  durationMin: number;
}

export interface StartSessionResponse {
  sessionId: string;
  assistantMessage: string;
  state: SessionState;
}

export interface MessageResponse {
  assistantMessage: string;
  state: SessionState;
  extractedFields: ExtractedFields;
  readyToConfirm: boolean;
}

export interface ConfirmResponse {
  assistantMessage: string;
  eventCreated: boolean;
  eventLink: string | null;
  state: SessionState;
}

