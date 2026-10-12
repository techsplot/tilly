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
  `POST /api/agent` decides the intent (record, correct, delete, or other)
  with one Nemotron call. Only the activity is required to save — crop,
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
- **Gap reminders.** `GET /api/agent/nudge` surfaces at most one light
  reminder per session for an agent-saved record with a gap, using fixed
  wording, no more than once every 24 hours; answering it corrects that
  record, and "stop asking" silences it for good.
- Spoken-style corrections ("no, it was the north field") and deletion
  ("delete that") apply to the farmer's most recently acted-on record, with a
  full correction history.
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
- `saved_by` provenance (`agent` or `farmer`) on every record; Farm history
  shows a "by FarmMind" label on agent-saved records.
- A mobile-first interface: a fixed message bar (with a mic button placeholder
  for Phase 8), an activity feed of what the agent did, and a Farm history tab
  on mobile / side panel on desktop.
- PostgreSQL persistence through Drizzle, browser-scoped anonymous farms, and
  soft delete with a reversible correction trail.
- Phase 4's confirmed-history retrieval for contextual references, with
  deterministic evidence verification and provenance tracking, feeds the
  agent's memory resolution.
- `/api/extract-event`, `POST /api/events`, and the `confirm`/`reject`/`PATCH`
  event routes still work and are covered by tests, but the UI no longer calls
  them; they remain for direct API use (for example the earlier
  proposal/confirm flow, or scripted access). They keep the older, blocking
  required-field policy; only agent mode follows the save-first rules above.
- Run `pnpm db:migrate` after pulling to apply the `date_assumed`,
  `event_time`/`time_of_day`, and `last_nudged_at`/`nudges_stopped` columns.

Not built yet: reminders delivered outside the app (Phase 9), evaluation
results, and a hosted demo. Report and ask (the two other core verbs) land in
Phase 6. The [implementation plan](.github/implementation-plan.md) tracks
progress phase by phase.

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

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

Set `NEBIUS_API_KEY` and `NEBIUS_MODEL` in `.env`. Never commit `.env`.
Set `DATABASE_URL` to a PostgreSQL connection string, then apply the committed
migrations:

```powershell
pnpm db:migrate
```

Run `pnpm db:migrate` again after pulling later schema migrations, including
the Phase 5 migration that adds `saved_by` and `deleted_at` to `farm_events`.

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

## License

FieldLedger is released under the [MIT License](LICENSE).
