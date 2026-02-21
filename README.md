# Voice Scheduling Agent (Deployed Assignment)

Browser-based voice scheduling assistant that:

- Initiates a conversation.
- Collects user name, preferred date/time, and optional meeting title.
- Confirms details.
- Creates a real Google Calendar event.
- Works with voice input in Chrome and text fallback everywhere.

## Deployed Links

- GitHub Repository: `https://github.com/JustChaos10/voice-scheduling-agent`
- Frontend (Vercel): `ADD_YOUR_VERCEL_URL`
- Backend API (Railway): `ADD_YOUR_RAILWAY_URL`
- Demo video (OBS/Loom): `ADD_YOUR_VIDEO_LINK`

## Repository Structure

```text
apps/
  api/   Fastify + Groq + Google Calendar
  web/   Next.js browser voice UI
docs/
  screenshots/
```

## Tech Stack

- Frontend: Next.js (App Router), Web Speech API (`SpeechRecognition` + `speechSynthesis`)
- Backend: Fastify + TypeScript + Zod
- LLM extraction: Groq (OpenAI-compatible API)
- Date parsing: `chrono-node` + `luxon` with fixed timezone
- Calendar provider: Google Calendar API (service account)
- Deployment targets: Vercel (web) + Railway (api)

## API Contract

- `POST /v1/session/start`
  - Input: `{}`
  - Output: `{ sessionId, assistantMessage, state }`
- `POST /v1/session/message`
  - Input: `{ sessionId, userMessage }`
  - Output: `{ assistantMessage, state, extractedFields, readyToConfirm }`
- `POST /v1/session/confirm`
  - Input: `{ sessionId, confirmed }`
  - Output: `{ assistantMessage, eventCreated, eventLink, state }`
- `GET /health`
  - Output: `{ ok: true }`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy and fill values:

```bash
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Required API values:

- `GROQ_API_KEY`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_CALENDAR_ID`

Set web env:

- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`

### 3. Run both apps

```bash
npm run dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:8080`

## How To Test The Agent

1. Open the web app URL.
2. Click `Start Session`.
3. Speak (or type) your:
   - Name
   - Preferred date + time
   - Optional title (or say `skip`)
4. On confirmation prompt, say `yes` to create the event.
5. Verify event link in UI and event in Google Calendar.

## Calendar Integration Explained

- Uses a Google service account with Calendar API.
- The target calendar is configured by `GOOGLE_CALENDAR_ID`.
- Service account must have write access to that calendar.
- Event payload includes:
  - `summary`: meeting title
  - `description`: includes requestor name
  - `start/end`: ISO datetime in configured timezone (`DEFAULT_TIMEZONE`)
- Default meeting duration is `30` minutes (`DEFAULT_DURATION_MIN`).

## Google Calendar Setup (Service Account)

1. In Google Cloud, enable Google Calendar API.
2. Create a service account and JSON key.
3. Share your target Google Calendar with service-account email as `Make changes to events`.
4. Put credentials in `apps/api/.env`.

## Deployment

### Backend to Railway

1. Create a Railway project and connect this repo.
2. Set root directory to `apps/api` or use `npm run start -w @voice-agent/api`.
3. Add env vars from `apps/api/.env.example`.
4. Deploy and copy public API URL.

### Frontend to Vercel

1. Import repo into Vercel.
2. Set project root to `apps/web`.
3. Add env var:
   - `NEXT_PUBLIC_API_BASE_URL=<your_railway_api_url>`
4. Deploy and verify end-to-end flow.

## Test Scenarios Covered

1. Happy path voice booking creates event.
2. Missing title path defaults to `Meeting with <name>`.
3. Ambiguous/missing time triggers clarifying prompt.
4. Reject confirmation (`no`) then update details.
5. Browser without speech recognition uses text fallback.
6. Invalid or expired session returns controlled API errors.
7. Event timezone follows fixed configured timezone.

## Commands

```bash
npm run dev
npm run build
npm run test
```

## Submission Artifacts

- Demo walkthrough video (OBS/Loom): `ADD_YOUR_VIDEO_LINK`
- Screenshot of created event: add under `docs/screenshots/` and reference here.

Example screenshot reference:

`docs/screenshots/event-created.png`

## Notes

- Assignment submission target date: Saturday, February 21, 2026.
- For best voice behavior, use Google Chrome with microphone permission enabled.
