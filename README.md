# NoX

The requirement-to-verification substrate for enterprises. NoX keeps a living map of every
application in the estate (a code wiki generated from code, docs and tickets) and carries a
single change from a business user's first sentence through product definition, technical
design, implementation and verification. Each role writes its own spec file with NoX's help.

Built for the [AI Builder Cup](https://aibuildercup.com) hackathon, with
[Google Antigravity](https://antigravity.google) as the coding environment, on Google ADK, Gemini, Gemma
and Google Cloud.

## Built with Google Antigravity

NoX was designed and built in Google Antigravity. [AGENTS.md](AGENTS.md) is the brief its agents
work from: the design principles, where every part lives, and the conventions to keep. NoX also
plugs back into Antigravity: `nox init antigravity` installs the `/nox` skill, so an Antigravity
agent can load a mission, read the knowledge bases it touches, build the change and open the pull request.

## Documentation

- **Product docs**: every feature, the four seats, integrations, and how the agents run on Google ADK, Gemini and Gemma. Served at [`/docs`](http://localhost:3000/docs) in the web app; the source is [`apps/web/content/docs/`](apps/web/content/docs/).
- **[AGENTS.md](AGENTS.md)**: the design of the codebase for coding agents and contributors: where everything lives, the principles, and the conventions.
- **[docs/](docs/)**: design history, decisions and the implementation plan.

## Repo layout

```
apps/web/          Next.js 15 — landing page + the NoX app
apps/api/          FastAPI (Python 3.12, uv) — knowledge-base engine, missions, integrations
packages/nox-cli/  `nox` CLI and the /nox skill for coding agents
scripts/           setup, seeding, checks
docs/              product, architecture and integration docs + IMPLEMENTATION_PLAN.md
```

## AI

Every knowledge base NoX writes is an **Open Knowledge Format (OKF 0.2)** bundle, Google Cloud's open specification for knowledge shared by agents and people ([blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing), [spec](https://github.com/GoogleCloudPlatform/open-knowledge-format)): typed YAML frontmatter on every page, an index per folder and a dated log, extended with cross-application links (`apps/api/nox_api/agents/okf.py`).

Every AI call is a Google ADK agent (`apps/api/nox_api/ai/`) on Gemini, served from the Gemini Enterprise Agent Platform
(Vertex AI) with the Cloud Run service account, so no API key is deployed. The main agents:

- **KB builder:** a cartographer maps the codebase, page writers work in parallel, and a reviewer fixes pages that fail the quality gate.
- **Ask:** a streaming agent that looks things up in the KB, the contract map and the code, and cites what it read.
- **Co-writer:** edits spec files section by section, live.

Search is hybrid: `gemini-embedding-2` vectors in pgvector, fused with Postgres full-text.

- **Connected.** Any coding agent can use NoX's tools over MCP (`/mcp`, `nox mcp install antigravity`), and other agents can talk to the Ask agent over A2A (`/a2a/ask`). The token decides what they can see (`apps/api/nox_api/interop/`).
- **Shielded.** NoX Shield screens sources, questions and chat with Model Armor and checks pages with Sensitive Data Protection before they are committed (`services/shield.py`).
- **Measured.** Mission events and AI usage stream into BigQuery; the Impact page shows time per stage, send-backs, grounding and AI cost (`services/analytics.py`).
See [docs/02-architecture-and-tech-stack.md](docs/02-architecture-and-tech-stack.md#ai-layer).

**NoX Local** builds and maintains a knowledge base on a developer's machine with Gemma via Ollama. The code never
leaves the laptop, and only the Markdown pages reach NoX:

```bash
ollama pull gemma4:12b
cd your-repo && nox kb build      # map the repo and write the pages into .nox/kb/
nox kb push                       # NoX lints and indexes them and opens the KB pull request
nox kb watch                      # after every commit, Gemma updates the pages and pushes a KB PR
```

## Running it

Needs Docker, Node 22+, and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env     # fill in keys — see docs/03-integrations-config-and-build-plan.md
make install
make dev                 # postgres + redis in Docker, then api :8000, worker, web :3000
```

Other targets: `make api`, `make web`, `make worker`, `make migrate`, `make test`, `make lint`,
`make seed-demo` (Apex demo org), `make demo-reset` (clear missions before a rehearsal),
`make embed-backfill` (index existing KBs for search). Benchmark a KB build: `cd apps/api && uv run python ../../scripts/bench_kb.py <kb-id>`.

## The `nox` CLI

```bash
packages/nox-cli/install.sh            # links `nox` onto your PATH (Node 18+)
nox login --api http://localhost:8000  # approve in the browser
cd your-repo && nox init antigravity   # installs /nox for Google Antigravity (also cursor, codex, copilot, claude)
nox mcp install antigravity            # adds NoX's MCP tools to Antigravity (also gemini, claude, cursor)
```

Then, in the coding agent: `/nox NOX-12`. `nox help` lists the rest (`context`, `search`, `read`, `pr`, `complete`).

## Deploying

`scripts/deploy_gcp.sh` builds and deploys `nox-api`, `nox-worker` and `nox-web` to Cloud Run, with secrets in
Secret Manager (`scripts/deploy_gcp.sh secrets` copies them from `.env`). `DRY_RUN=1` prints the commands.
Gemini runs on the Agent Platform as the runtime service account (`scripts/deploy_gcp.sh ai-access` grants
`roles/aiplatform.user`, plus Model Armor, DLP and BigQuery for NoX Shield and the flight recorder), and Memorystore is reached by Direct VPC egress, so no connector is needed.
The header of the script lists the variables it needs (Cloud SQL instance, Memorystore URL, VPC connector).
The 5-minute demo is in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Where things stand

The build follows [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), checkpoints CP0–CP12.
Its status table shows what's done and what's next.
