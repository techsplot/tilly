# FieldLedger

FieldLedger is the project for FarmMind: a farm memory assistant that turns
everyday farm activity descriptions into confirmed, searchable farm records
and grounded follow-up actions.

FieldLedger is being built for the
[Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/)
in the **Best Apps and Agents** track. See the
[hackathon brief](.github/hackathon.md) for the rules, deadline, and
submission checklist.

## How it uses Nemotron and Nebius

Every farm note is interpreted at runtime by
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, called through Nebius Token
Factory's OpenAI-compatible API. Nemotron proposes structured events; the
application never trusts that output directly:

1. Zod validates the model's JSON, including real `YYYY-MM-DD` dates.
2. A deterministic policy marks each event `proposed` or `incomplete` based
   on the fields that activity requires.
3. If a required field is missing, FarmMind asks one clarification question
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
  only when the message names a different farm, so its memory is used). Only the activity is required to save — crop,
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
  farmer's messages on the right, FarmMind's receipts, questions, and
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
  farm's wake word ("Hey FarmMind", "OK Farm", "Hey Farm", or a custom
  phrase), with a chime when it hears it. Hold the mic to open voice
  settings. Speech recognition is the browser's own (Chrome and Edge; Token
  Factory has no speech models on this account): **the browser vendor's
  speech service (Google in Chrome, Microsoft in Edge) hears everything
  said while the mic is on.** Wake word matching runs in the browser, so
  only the words after the wake word are sent to FarmMind. Browsers without
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
  and `wake_word`/`wake_word_enabled` columns.

Not built yet: a hosted demo (Phase 10), reminders delivered outside the app
(Phase 11), and evaluation results (Phase 13). The
[implementation plan](.github/implementation-plan.md) tracks progress phase
by phase.

**An unfinished experiment:** `scripts/generate-wake-word-dataset.ts` and
`scripts/train-wake-word-model.ts` were written to fine-tune Nemotron Nano
as a wake word detector through Token Factory. That cannot run as written:
Token Factory does not offer Nemotron for fine-tuning, and only two Llama
models can be deployed per-token after fine-tuning. The scripts are kept
for reference; nothing in the app depends on them, and wake words are
matched in the browser instead.

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
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm format
pnpm extract-event
```

`pnpm extract-event` makes a live model request, so it requires valid Nebius
credentials and consumes model credits.

## What you learn by building FieldLedger

This project is intentionally a learning path, not just an application:

1. **LLM API fundamentals** — authentication, model selection, prompts,
   latency, token usage, failures, and cost.
2. **Structured generation** — turning uncertain model text into validated
   TypeScript data with Zod.
3. **AI product design** — deciding when to infer, clarify, confirm, or refuse.
4. **Context and memory** — retrieving the right farm history instead of
   sending an entire database to a model.
5. **Agent boundaries** — combining model reasoning with deterministic code,
   tools, permissions, and safety gates.
6. **Data modeling** — representing farms, fields, crops, events, corrections,
   reminders, and provenance.
7. **Evaluation** — building test cases and measuring extraction accuracy,
   ambiguity detection, hallucinations, and response time.
8. **Full-stack engineering** — connecting a Next.js interface to application
   services and infrastructure adapters.
9. **Production AI engineering** — environment configuration, observability,
   retries, deployment, background jobs, and responsible handling of user
   data.

Each fragment should leave you able to explain what the code does, why the
tool was chosen, what can fail, and how we measured the result.

For the project-specific learning and architecture instructions, use the
`FieldLedger Learning Engineer` custom agent in `.github/agents/`.

## Model routing

FarmMind follows the hackathon guidance: Nemotron Nano for fast, everyday
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
questions and reports fail. In either case FarmMind replies with an error
naming the missing variable instead of guessing a model.

## License

FieldLedger is released under the [MIT License](LICENSE).
