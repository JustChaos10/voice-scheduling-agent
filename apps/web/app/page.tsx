"use client";

import { FormEvent, useEffect, useState } from "react";

type Stage = "collect_name" | "collect_datetime" | "collect_title_optional" | "confirm" | "completed";

interface SessionState {
  sessionId: string;
  stage: Stage;
  name: string | null;
  meetingTitle: string | null;
  startAtIso: string | null;
  timezone: string;
  durationMin: number;
  pendingField: "name" | "startAtIso" | "meetingTitle" | null;
  readyToConfirm: boolean;
}

interface StartResponse {
  sessionId: string;
  assistantMessage: string;
  state: SessionState;
}

interface MessageResponse {
  assistantMessage: string;
  state: SessionState;
  extractedFields: {
    confirmationIntent?: "yes" | "no" | null;
  };
  readyToConfirm: boolean;
}

interface ConfirmResponse {
  assistantMessage: string;
  eventCreated: boolean;
  eventLink: string | null;
  state: SessionState;
}

type ConversationMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
let cachedVoiceName: string | null = null;

function detectConfirmIntent(text: string): boolean | null {
  const normalized = text.toLowerCase();
  if (
    /\b(yes|yeah|yep|yup|yas|yea|yesh|guess|correct|confirm|sounds good|sure|go ahead|do it|proceed|okay|ok)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  if (/\b(no|nope|nah|wrong|change|not right|don't)\b/.test(normalized)) {
    return false;
  }
  return null;
}

function getSpeechRecognition():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const withVendor = window as Window & {
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };

  return window.SpeechRecognition ?? withVendor.webkitSpeechRecognition ?? null;
}

function newMessage(role: ConversationMessage["role"], text: string): ConversationMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text
  };
}

function detectIntentFromExtraction(
  extractedFields: MessageResponse["extractedFields"]
): boolean | null {
  if (extractedFields.confirmationIntent === "yes") {
    return true;
  }
  if (extractedFields.confirmationIntent === "no") {
    return false;
  }
  return null;
}

function makeSpeakableText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "a calendar link in the chat")
    .replace(/\s+/g, " ")
    .trim();
}

function pickPreferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) {
    return null;
  }

  const preferredNames = [
    "Google UK English Female",
    "Google US English",
    "Microsoft Aria Online",
    "Microsoft Jenny Online",
    "Samantha"
  ];

  for (const preferred of preferredNames) {
    const match = voices.find((voice) => voice.name.includes(preferred));
    if (match) {
      return match;
    }
  }

  const englishVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  return englishVoice ?? voices[0] ?? null;
}

async function resolvePreferredVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  const synth = window.speechSynthesis;
  let voices = synth.getVoices();

  if (!voices.length) {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };

      const timeout = window.setTimeout(finish, 700);
      const onVoicesChanged = () => {
        window.clearTimeout(timeout);
        synth.removeEventListener("voiceschanged", onVoicesChanged);
        finish();
      };

      synth.addEventListener("voiceschanged", onVoicesChanged);
    });
    voices = synth.getVoices();
  }

  if (!voices.length) {
    return null;
  }

  if (cachedVoiceName) {
    const cached = voices.find((voice) => voice.name === cachedVoiceName);
    if (cached) {
      return cached;
    }
  }

  const chosen = pickPreferredVoice(voices);
  if (chosen) {
    cachedVoiceName = chosen.name;
  }
  return chosen;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }

  const voice = await resolvePreferredVoice();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(makeSpeakableText(text));
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function extractAlternatives(event: SpeechRecognitionEvent): string[] {
  const firstResult = event.results?.[0];
  if (!firstResult) {
    return [];
  }

  const options: string[] = [];
  for (let index = 0; index < firstResult.length; index += 1) {
    const transcript = firstResult[index]?.transcript?.trim();
    if (transcript) {
      options.push(transcript);
    }
  }
  return options;
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventLink, setEventLink] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognition()));
    void resolvePreferredVoice();
  }, []);

  const addMessage = (role: ConversationMessage["role"], text: string) => {
    setMessages((previous) => [...previous, newMessage(role, text)]);
  };

  const startSession = async () => {
    setIsBusy(true);
    setError(null);
    setEventLink(null);
    setMessages([]);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await postJson<StartResponse>("/v1/session/start", { timezone });
      setSessionId(response.sessionId);
      setState(response.state);
      addMessage("assistant", response.assistantMessage);
      await speak(response.assistantMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start session.");
    } finally {
      setIsBusy(false);
    }
  };

  const applyAssistantReply = async (
    response: MessageResponse | ConfirmResponse
  ): Promise<void> => {
    setState(response.state);
    addMessage("assistant", response.assistantMessage);
    if ("eventCreated" in response && response.eventCreated) {
      setEventLink(response.eventLink ?? null);
    }
    await speak(response.assistantMessage);
  };

  const sendUserMessage = async (rawMessage: string) => {
    if (!sessionId || !state) {
      return;
    }

    const userMessage = rawMessage.trim();
    if (!userMessage) {
      return;
    }

    addMessage("user", userMessage);
    setIsBusy(true);
    setError(null);

    try {
      if (state.stage === "confirm") {
        const intent = detectConfirmIntent(userMessage);
        if (intent !== null) {
          const confirmResponse = await postJson<ConfirmResponse>("/v1/session/confirm", {
            sessionId,
            confirmed: intent
          });
          await applyAssistantReply(confirmResponse);
          setInputValue("");
          return;
        }
      }

      const response = await postJson<MessageResponse>("/v1/session/message", {
        sessionId,
        userMessage
      });

      const extractedIntent = detectIntentFromExtraction(response.extractedFields);
      const canAutoConfirm =
        state.stage === "confirm" &&
        response.state.stage === "confirm" &&
        extractedIntent !== null;

      if (canAutoConfirm) {
        const confirmResponse = await postJson<ConfirmResponse>("/v1/session/confirm", {
          sessionId,
          confirmed: extractedIntent
        });
        await applyAssistantReply(confirmResponse);
      } else {
        await applyAssistantReply(response);
      }
      setInputValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setIsBusy(false);
    }
  };

  const captureVoice = async () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setError("Speech recognition is not available in this browser.");
      return;
    }
    if (!sessionId || !state) {
      setError("Start the session before using voice input.");
      return;
    }

    setError(null);
    setIsListening(true);

    try {
      const transcript = await new Promise<string>((resolve, reject) => {
        const recognition = new Recognition();
        recognition.lang = "en-US";
        recognition.maxAlternatives = 5;
        recognition.interimResults = false;
        recognition.continuous = false;
        let settled = false;

        const finish = (handler: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          handler();
        };

        const timeoutId = window.setTimeout(() => {
          try {
            recognition.stop();
          } catch {
            // no-op
          }
        }, 6500);

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const alternatives = extractAlternatives(event);
          if (!alternatives.length) {
            finish(() => reject(new Error("No clear speech detected. Please try again.")));
            return;
          }

          if (state.stage === "confirm") {
            for (const option of alternatives) {
              const intent = detectConfirmIntent(option);
              if (intent !== null) {
                finish(() => resolve(intent ? "yes" : "no"));
                return;
              }
            }
          }

          finish(() => resolve(alternatives[0] ?? ""));
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          finish(() => reject(new Error(event.error || "Speech recognition error")));
        };

        recognition.onnomatch = () => {
          finish(() => reject(new Error("No clear speech detected. Please try again.")));
        };

        recognition.addEventListener("end", () => {
          finish(() => reject(new Error("No clear speech detected. Please try again.")));
        });

        recognition.start();
      });

      if (!transcript) {
        setError("No speech detected. Please try again.");
      } else {
        await sendUserMessage(transcript);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not capture speech.");
    } finally {
      setIsListening(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendUserMessage(inputValue);
  };

  return (
    <main className="page">
      <header className="hero">
        <span className="tag">Voice Scheduling Agent</span>
        <h1>Book a meeting by talking to an assistant.</h1>
        <p className="subtitle">
          This assistant collects your name, preferred date/time, and optional title,
          confirms details, and creates a real Google Calendar event.
        </p>
      </header>

      <section className="panel">
        <div className="controls">
          <button className="btn-primary" onClick={startSession} disabled={isBusy}>
            {sessionId ? "Restart Session" : "Start Session"}
          </button>
          <button
            className="btn-secondary"
            onClick={captureVoice}
            disabled={!sessionId || isBusy || isListening || speechSupported !== true}
          >
            {isListening ? "Listening..." : "Speak"}
          </button>
          <button
            className="btn-plain"
            onClick={() => {
              window.speechSynthesis.cancel();
            }}
            disabled={isBusy}
          >
            Stop Voice
          </button>
        </div>

        <div className="status">
          <span className={`badge ${speechSupported ? "ok" : ""}`}>
            {speechSupported === null
              ? "Checking voice support..."
              : speechSupported
                ? "Voice input available"
                : "Text fallback mode"}
          </span>
          <span className="badge">{state ? `Stage: ${state.stage}` : "Stage: idle"}</span>
          <span className="badge">{isBusy ? "Status: processing" : "Status: ready"}</span>
        </div>

        <div className="messages">
          {messages.length === 0 && (
            <div className="message system">
              Click <strong>Start Session</strong> to begin.
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              {message.text}
            </div>
          ))}
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <input
            type="text"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Type your message here (fallback mode or manual edits)..."
            disabled={!sessionId || isBusy}
          />
          <button className="btn-primary" type="submit" disabled={!sessionId || isBusy}>
            Send
          </button>
        </form>

        {error && <p className="error">Error: {error}</p>}
        {eventLink && (
          <p className="event-link">
            Event link:{" "}
            <a href={eventLink} target="_blank" rel="noreferrer">
              {eventLink}
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
