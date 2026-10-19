# Tilly

**Live demo:** _coming soon_

Tilly is a farm memory you keep by talking. Tell Tilly what you did on the
farm, in your own words, and it turns that into confirmed, searchable farm
records and grounded follow-up actions.

Tilly is being built for the
[Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/)
in the **Best Apps and Agents** track.

## How it uses Nemotron and Nebius

Every farm note is interpreted at runtime by
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, called through Nebius Token
Factory's OpenAI-compatible API. Nemotron proposes structured events; the
application never trusts that output directly:

1. Zod validates the model's JSON, including real `YYYY-MM-DD` dates.
2. A deterministic policy marks each event `proposed` or `incomplete` based
   on the fields that activity requires.
3. If a required field is missing, Tilly asks one clarification question
   instead of guessing.
4. When a note refers to a confirmed field or crop, the application sends a
   small farm-memory list to Nemotron. Deterministic verification checks every
   cited value against that list before the UI explains which record supplied
   it; invented or ambiguous values become missing and trigger clarification.

## Current status

Working today:

- **Agent mode: save first, ask almost never.** A farmer types a message;
  `POST /api/agent` decides the intent (record, correct, delete, question, report)
  and which farm it is about with one Nemotron call (a second call happens
  only when the message names a different farm, so its memory is used).
  Nemotron Nano is asked in fast mode (thinking off, about 3 s) and asked
  again with thinking on only when its answer looks doubtful; greetings
  and thanks are answered in code with no model call. Only the activity is required to save — crop,
  field, and a specific time are kept when said and left empty when not,
  and a missing date is assumed to be today. The record saves at once as
  `confirmed`, and the receipt names any gap ("Recorded: spraying · today
  (field not given)"). There are no Edit, Confirm, Reject, or Save-for-later
  buttons.
- **One question, at most, per note.** The agent asks only when an
  "important" detail (the date always; crop/field for most activities; an
  ambiguous memory reference) is missing, in a single question covering
  everything missing at once — phrased by Nemotron, with a fixed fallback
  if it leaves the phrasing blank. The next message always ends that
  question: it either answers it (merged and saved at once, gaps and all)
  or turns out to be a new note, in which case the pending one is saved
  with its gaps first. A farmer can correct a gap at any time by saying so.
- **Gap reminders.** `POST /api/agent/nudge` surfaces at most one light
  reminder per session for an agent-saved record with a gap, using fixed
  wording, no more than once every 24 hours; answering it corrects that
  record, and "stop asking" silences it for good.
- Spoken-style corrections ("no, it was the north field") and deletion
  ("delete that") apply to the farmer's most recently acted-on record, with a
  full correction history. If a correction says no new value ("that's
  wrong"), the agent asks "What should I change it to?" once, and the answer
  changes only that record.
- One-tap Undo on every reported action (`POST /api/events/[id]/undo`),
  checked against the record's current state; undoing a correction targets
  the specific correction that produced the record's current values, not
  just "the latest row".
- Deterministic duplicate detection (same farm, activity, field, and event
  date) saves a likely repeat and flags it ("Looks like a repeat. Undo?")
  instead of asking first.
- Optional time of day: a stated time ("at 4pm") or a vague one ("this
  morning") is kept and shown in receipts and history; time is never a gap
  and never nudged about.
- `saved_by` provenance (`agent` or `farmer`) on every record.
- **A WhatsApp-style chat.** One conversation fills the screen: the
  farmer's messages on the right, Tilly's receipts, questions, and
  answers on the left, each with a time. A new conversation opens with
  a greeting for the time of day that names the farm and its last record
  ("Good morning! The last thing you recorded on River Farm was weeding in
  North Field on 15 Oct. What did you do today?"). A header menu opens **My records** (loaded only
  when opened, in plain words: "Needs a detail", "Corrected"), **Farms**
  (switch or add a farm), and **Voice settings**, each in a drawer that is
  a bottom sheet on phones and a side panel on desktop.
- **Voice input.** The round button beside the message box is a mic when
  the box is empty and Send when it has text. **Tap to speak** puts the
  transcript in the box so the farmer can check it before sending.
  **Hands-free** listens until stopped and sends only what follows the
  farm's wake word ("Hey Tilly", "OK Tilly", "Hey Farm", or a custom
  phrase), with a chime when it hears it. Hold the mic to open voice
  settings. Speech recognition is the browser's own (Chrome and Edge; Token
  Factory has no speech models on this account): **the browser vendor's
  speech service (Google in Chrome, Microsoft in Edge) hears everything
  said while the mic is on.** Wake word matching runs in the browser, so
  only the words after the wake word are sent to Tilly. Browsers without
  speech recognition, such as Firefox, show only the Send button.
- **Multiple farms.** A farmer can add farms and switch between them, or
  name one in a message ("I weeded at River Farm"); code checks the name
  against the farms that browser owns, and asks when it is unknown or
  ambiguous.
- **Smart suggestions** after a record, computed by code with no model
  call: fields not weeded for 14+ days, recurring activities, and common
  follow-ups (spraying → weeding).
- PostgreSQL persistence through Drizzle, browser-scoped anonymous farms, and
  soft delete with a reversible correction trail.
- Phase 4's confirmed-history retrieval for contextual references, with
  deterministic evidence verification and provenance tracking, feeds the
  agent's memory resolution.
- **Phase 6: Ask and report.** Farmer can ask about their farm ("when did I
  last spray?") or request a report ("what did I do this week?"). The agent
  extracts a restricted filter (activity, crop, field, date range), runs
  deterministic SQL to count and group records, then Nemotron Ultra (or
  Super) writes a short plain-language answer citing the specific records.
  Extraction uses `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` via
  `NEBIUS_MODEL_EXTRACTION`; answer wording uses `NEBIUS_MODEL_ANSWER` (or
  Super). "I can't tell from your records" when records don't answer.
- `/api/extract-event`, `POST /api/events`, and the `confirm`/`reject`/`PATCH`
  event routes still work and are covered by tests, but the UI no longer calls
  them; they remain for direct API use (for example the earlier
  proposal/confirm flow, or scripted access). They keep the older, blocking
  required-field policy; only agent mode follows the save-first rules above.
- Run `pnpm db:migrate` after pulling to apply the `date_assumed`,
  `event_time`/`time_of_day`, `last_nudged_at`/`nudges_stopped`, multi-farm,
  and `wake_word`/`wake_word_enabled` columns, and migration 0006, which
  moves farms on the old "Hey FarmMind" default to "Hey Tilly".
- **A sample farm.** An empty farm's welcome message and the Farms drawer
  offer "Try a sample farm": a farm named "Sample Farm" with 15 records from
  the past three weeks (one with a missing field, one corrected), so there
  is something to ask about straight away. It is created without a model
  call, with dates counted back from today, and a second tap opens the same
  farm.
- **Rate limits on model calls.** `POST /api/agent` and
  `POST /api/extract-event` allow 10 requests a minute and 100 an hour per
  session, and 30 a minute and 300 an hour per IP; a request must pass
  both. Across all users, Nebius calls are capped at 3,000 a day
  (`MODEL_DAILY_LIMIT`), counted per call, so the thinking-mode retry counts
  twice and greetings answered in code do not count. Over a limit the route
  returns `429` with `Retry-After`, and the chat shows "Tilly is busy right
  now" as an ordinary reply. The counts are in memory, so they are per
  container and reset on restart; that is fine for one demo instance.
- **Ready to host.** A Docker image, a database health check, and one log
  line per model-backed request with no personal content (see
  [Deployment](#deployment)).

Not built yet: the hosted demo itself (the image is ready; the endpoint is
not created yet), a farm recovery code (deferred), reminders delivered
outside the app (Phase 11), and evaluation results (Phase 13).

## Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- A Nebius Token Factory API key
- The exact permitted NVIDIA model identifier available to your account

## Getting Nebius credentials

The `NEBIUS_API_KEY` comes from Nebius Token Factory, not from this project:

1. Open [Nebius Token Factory](https://tokenfactory.nebius.com/).
2. Create or sign in to your account.
3. Open the API-key/authentication area in the Token Factory console.
4. Create an API key and copy it once into your local `.env` file.
5. Choose a permitted NVIDIA open-source model that is available to your
   account and set its exact identifier as `NEBIUS_MODEL`.

The application uses Nebius Token Factory's OpenAI-compatible endpoint:
`https://api.tokenfactory.nebius.com/v1/`.

Do not paste the key into source code, commit it, or share it in chat. The
`.gitignore` file excludes `.env`.

## Setup

Install pnpm globally:

```powershell
npm install -g pnpm@10.18.2
```

Or enable corepack (requires admin):

```powershell
corepack enable
```

Then install dependencies:

```powershell
pnpm install
Copy-Item .env.example .env
```

Set `NEBIUS_API_KEY`, `NEBIUS_MODEL_EXTRACTION`, and `NEBIUS_MODEL_ANSWER` in `.env`. Never commit `.env`.

Set `DATABASE_URL` to a PostgreSQL connection string, then apply the committed
migrations:

```powershell
pnpm db:migrate
```

Run `pnpm db:migrate` again after pulling later schema migrations.

The browser receives an anonymous farm cookie. Clearing browser data starts a
new farm; there is no login in this phase.

## Commands

```powershell
pnpm dev            # development server
pnpm typecheck      # tsc --noEmit
pnpm build          # production build (next build, standalone output)
pnpm start          # serve the production build
pnpm test
pnpm lint
pnpm format
pnpm extract-event
```

`pnpm extract-event` makes a live model request, so it requires valid Nebius
credentials and consumes model credits.

`pnpm build` writes a standalone server to `.next/standalone`; run it with
`node .next/standalone/server.js` (copy `.next/static` into
`.next/standalone/.next/static` first, and `public` if there is one). `pnpm start`
still works but Next prints a warning for standalone output. On Windows the
standalone step creates symlinks, so it fails with `EPERM` unless Developer
Mode is on; build in Docker, WSL, or CI instead.

## Model routing

Tilly follows the hackathon guidance: Nemotron Nano for fast, everyday
calls (intent/filter extraction) and Nemotron Ultra (or Super) for reasoning
over farm history when generating answers. Each role has its own environment
variable:

- `NEBIUS_MODEL_EXTRACTION` — Nano model (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`)
  for intent detection and filter extraction from farmer messages. This runs on
  every user message.
- `NEBIUS_MODEL_ANSWER` — Ultra or Super model for writing plain-language
  answers from deterministic SQL results. This runs only when the farmer asks
  a question or requests a report.

Both are required. Without `NEBIUS_MODEL_EXTRACTION` (or the older
`NEBIUS_MODEL`) no message can be read; without `NEBIUS_MODEL_ANSWER`,
questions and reports fail. In either case Tilly replies with an error
naming the missing variable instead of guessing a model.

## Deployment

The app ships as one Docker image that runs the Next.js standalone server
on port 3000 as a non-root user. It is planned to run on a Nebius
Serverless AI endpoint (CPU, public), but nothing in the image is
Nebius-specific; any Docker host works.

### Build the image

```powershell
docker build -t tilly .
```

The image contains no `.env` and no secrets (`.dockerignore` excludes them,
and the Dockerfile has no `ARG` or `ENV` for them).

### Environment variables

Set these on the host or endpoint at runtime:

| Variable                  | Required | Purpose                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL`            | yes      | PostgreSQL connection string (Neon)                              |
| `NEBIUS_API_KEY`          | yes      | Token Factory API key                                            |
| `NEBIUS_MODEL_EXTRACTION` | yes      | Nano model for reading messages                                  |
| `NEBIUS_MODEL_ANSWER`     | yes      | Ultra or Super model for answers and reports                     |
| `NEBIUS_BASE_URL`         | no       | Defaults to `https://api.tokenfactory.nebius.com/v1/`            |
| `MODEL_DAILY_LIMIT`       | no       | Nebius calls allowed per UTC day across all users (default 3000) |

To try the image locally:

```powershell
docker run -p 3000:3000 --env-file .env tilly
```

`docker --env-file` keeps quotes as part of the value, unlike dotenv, so
write values in that file without quotes (`DATABASE_URL=postgresql://...`).

### Migrations

The container never migrates on start. Run migrations from a laptop
against the production database before deploying a version that needs
them:

```powershell
$env:DATABASE_URL = "<production connection string>"
pnpm db:migrate
```

### Health check

`GET /api/health` returns `200 {"status":"ok"}` when the database answers
`select 1` and `503 {"status":"error"}` when it does not. It never calls a
model, never returns error details, and is not cached. The image's Docker
`HEALTHCHECK` uses it.

### Rate limits

| Limit                   | Per minute | Per hour | Per day     |
| ----------------------- | ---------- | -------- | ----------- |
| Each session (cookie)   | 10         | 100      |             |
| Each client IP          | 30         | 300      |             |
| All users, Nebius calls |            |          | 3,000 (env) |

They apply to `POST /api/agent` and `POST /api/extract-event`, the only
routes that reach Nebius. The client IP is the first `x-forwarded-for`
value. The counts live in the container's memory: they reset when it
restarts and are not shared between containers, so run one instance (or
move them to a shared store first).

### Logs

Each model-backed request writes one JSON line with the route, status,
duration, model roles used, number of model calls, and whether the
thinking retry ran. Logs never contain message text, prompts, model
output, farm or field names, cookies, or IPs; in production, server errors
are logged by type and status only.

## License

Tilly is released under the [MIT License](LICENSE).
