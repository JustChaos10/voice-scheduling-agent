import { randomUUID } from "node:crypto";

import type { SessionState } from "./types.js";

interface SessionRecord {
  state: SessionState;
  touchedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;

  constructor(ttlMinutes: number) {
    this.ttlMs = ttlMinutes * 60 * 1000;

    const timer = setInterval(() => {
      this.cleanup();
    }, 60_000);

    timer.unref();
  }

  create(initialState: Omit<SessionState, "sessionId">): SessionState {
    const sessionId = randomUUID();
    const state: SessionState = { ...initialState, sessionId };
    this.sessions.set(sessionId, { state, touchedAt: Date.now() });
    return state;
  }

  get(sessionId: string): SessionState | null {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return null;
    }

    if (Date.now() - record.touchedAt > this.ttlMs) {
      this.sessions.delete(sessionId);
      return null;
    }

    record.touchedAt = Date.now();
    return record.state;
  }

  save(state: SessionState): void {
    this.sessions.set(state.sessionId, { state, touchedAt: Date.now() });
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, record] of this.sessions.entries()) {
      if (now - record.touchedAt > this.ttlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

