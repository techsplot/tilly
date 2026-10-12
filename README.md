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

## Current status

Working today:

- a Next.js page where a farmer types a note and sees what FarmMind
  understood, including missing fields and clarification questions;
- the `/api/extract-event` route and the `pnpm extract-event` command, both
  making live Nemotron calls.
- clarification answers, local event correction, confirmation/rejection
  transitions, and honest loading/error states.
- PostgreSQL persistence through Drizzle, browser-scoped anonymous farms,
  decision-time saving, and a Farm history timeline.
- The server stores the proposal as provided by the browser; later phases can
  add stronger provenance or server-side proposal verification.

Not built yet: reminders, evaluation results, and a hosted demo. The
[implementation plan](.github/implementation-plan.md) tracks progress phase by
phase.

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
