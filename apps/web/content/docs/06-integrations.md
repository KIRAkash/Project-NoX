# Integrations

NoX connects to the systems an enterprise already runs. It reads them to build knowledge bases, writes to them to keep work in step, and listens to them so it notices changes without anyone asking. Every integration on this page is real and is checked live on **Atlas → Connectors**.

## At a glance

| System | NoX reads | NoX writes | How NoX hears about changes |
| --- | --- | --- | --- |
| **GitHub** | Code, diffs, pull requests | Knowledge-base repositories, KB pull requests, spec files, guard comments on PRs | Push and pull-request webhooks, or polling |
| **Jira Cloud** | Projects, issues, descriptions, comments | Issues, sub-tasks, comments, status transitions, links back to NoX | Jira webhook (issue updated, comment created) |
| **Confluence** | Spaces and pages, including images | — | Confluence webhook, or polling |
| **Notion** | Pages | — | Polling |
| **Slack** | Channel history and threads | — | Events webhook |
| **File uploads** | OpenAPI, AsyncAPI, PDFs, diagrams, documents | — | — |
| **Google Gemini** | — | — | Model calls through the Gemini Enterprise Agent Platform |
| **Firebase Authentication** | Who you are (Google sign-in) | — | — |
| **Coding agents** | — | — | `/nox` in Google Antigravity, Cursor, Codex, Copilot and Claude Code |
| **Any MCP client** | — | — | NoX's tools over the Model Context Protocol at `/mcp` |
| **Any A2A agent** | — | — | NoX's Ask agent over Agent2Agent at `/a2a/ask` |

## GitHub

GitHub is where the code and the knowledge bases live. NoX connects as a **GitHub App** (a personal access token also works for development).

- **Reading code.** A GitHub source is read at its default branch into one snapshot for the agent team.
- **Knowledge-base repositories.** For each application, NoX creates a `kb-<app>` repository holding an [Open Knowledge Format](/docs/atlas#what-a-knowledge-base-contains-an-open-knowledge-format-bundle) bundle, and opens the first build as a pull request. Every later sync is a small patch pull request. Once two or more applications in an organization are live, NoX also writes `kb-org-<slug>`.
- **Spec files.** Mission files are committed under `missions/` in the primary application's knowledge-base repository: saves on the `nox/NOX-n` branch, approvals on the default branch.
- **Push webhook.** Starts the gatekeeper, which decides whether the knowledge base must change and opens a patch pull request if it does.
- **Pull-request webhook.** Links a PR to its mission when the branch, title or body names the key, runs the guard and comments on the PR. A merged KB pull request moves the knowledge base to **In Orbit**.

**Set up:** create a GitHub App with Contents (read and write), Pull requests (read and write), Webhooks (read and write), Administration (read and write, to create KB repositories) and Metadata (read). Install it on your organization, and point its webhook at `{WEBHOOK_BASE_URL}/api/v1/webhooks/github/push` and `…/github/pr` with `WEBHOOK_SECRET`.

`GITHUB_APP_ID` · `GITHUB_APP_INSTALLATION_ID` · `GITHUB_APP_PRIVATE_KEY_PATH` (or `GITHUB_APP_PRIVATE_KEY`) · `GITHUB_APP_SLUG` · `GITHUB_DEFAULT_ORG` · `GITHUB_APP_TOKEN` (fallback)

## Jira

Jira is where most teams track work, so NoX keeps missions and tickets in step in both directions, using the Jira Cloud REST API v3.

**From a mission** (the **Jira & pull requests** panel):

- **Link existing** by key or by words from the summary. The ticket's summary, description, status and comments become context for NoX's drafts and answers.
- **Create ticket** in the default project, with a summary and description built from the spec files, the label `nox`, and a remote link back to the mission.
- **Sub-tasks from build spec** turns the developer's numbered tasks into Jira sub-tasks.
- **Import**: start a new mission from a ticket key.

**NoX → Jira.** Every approval, send-back, verification and completion posts a comment starting with `[NoX]`, and moves the ticket to the status mapped to the new stage (To Do → In Progress → In Review → Done by default; override with `JIRA_STATUS_MAP`).

**Jira → NoX.** The webhook records status, assignee and comment changes on the mission's timeline, with who made them.

**No echo loops.** NoX recognises its own comments by the `[NoX]` tag and remembers each status it set for a minute, so the webhooks its own writes cause are ignored.

**Set up:** create an API token for a service user at id.atlassian.com. In Jira admin → System → Webhooks, add `{WEBHOOK_BASE_URL}/api/v1/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>` for *issue updated* and *comment created*, with the JQL `labels = nox`.

`ATLASSIAN_BASE_URL` · `ATLASSIAN_EMAIL` · `JIRA_API_TOKEN` · `JIRA_WEBHOOK_SECRET` · `JIRA_DEFAULT_PROJECT` · `JIRA_ALLOWED_PROJECTS`

## Confluence

Confluence spaces and pages are read as sources: architecture decisions, runbooks and design notes. Images on pages are passed to Gemini with the text, so diagrams inform the pages too. A Confluence webhook (or polling) triggers the gatekeeper when a page changes.

`CONFLUENCE_API_TOKEN` (often the same token as Jira) · `ATLASSIAN_BASE_URL` · `ATLASSIAN_EMAIL`

## Notion

Notion pages such as product requirements and data dictionaries are read as sources, and polled for changes. Create an internal integration and share the pages with it.

`NOTION_API_TOKEN` · `NOTION_PARENT_PAGE_ID`

## Slack

Slack channels are read as sources, so the decisions made in threads end up in the knowledge base. The events webhook tells NoX when there are new messages. Create a Slack app with `channels:history` and `channels:read`, and point its events URL at `/api/v1/webhooks/slack/events`.

`SLACK_BOT_TOKEN` · `SLACK_SIGNING_SECRET`

## File uploads

OpenAPI and AsyncAPI specs, PDFs, diagrams and other documents can be uploaded while onboarding or added later. They are stored in **Google Cloud Storage** in production (local disk in development) and ingested like any other source.

## Webhooks or polling

Webhooks need a URL the outside world can reach. In production that is the `nox-api` Cloud Run URL. For local development, run a tunnel (`cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`) and put its URL in `WEBHOOK_BASE_URL`.

If you'd rather not expose anything, set `SOURCE_MONITOR_MODE=polling`: NoX checks every source for changes on a schedule instead. **Check sources for updates** on an application's page checks immediately. (Two-way Jira sync still needs the webhook.)

## Signing in: Firebase

People sign in with Google through **Firebase Authentication**. The web app sends the Firebase ID token with every request, and the API verifies it with `firebase-admin`. There are no passwords to manage and no session secrets to rotate. For local development only, `NOX_DEV_AUTH` enables a one-field sign-in.

`NEXT_PUBLIC_FIREBASE_*` · `FIREBASE_PROJECT_ID`

## Coding agents

The `nox` CLI installs `/nox` into Google Antigravity, Cursor, OpenAI Codex, GitHub Copilot and Claude Code (`nox init <agent>`). The agent can then load a mission, search and read knowledge bases, link its pull request and mark the mission complete. See [Build and verify](/docs/build-and-verify).

## MCP: NoX's tools inside any agent

NoX serves its knowledge tools over the **Model Context Protocol** at `{NOX_PUBLIC_API_URL}/mcp` (Streamable HTTP). Any MCP client can use them: Google Antigravity, Gemini CLI, Claude Code, Cursor and others.

| Tool | What it does |
| --- | --- |
| `search_kb`, `read_kb_page`, `list_pages` | Search and read the knowledge bases you can see |
| `find_interfaces` | The contract map: who exposes and who consumes a topic or endpoint |
| `grep_source`, `read_source_file` | Search and read the source snapshot behind a knowledge base |
| `list_apps` | The applications you can see, with their status |
| `get_mission`, `list_my_missions` | A mission's spec files and what's waiting on you |
| `ask_nox` | A cited answer from NoX's Ask agent |

**Scope comes from the token, never the request.** Every call carries a personal NoX token. NoX works out which applications that person can see from their memberships, the same as the web app and the CLI. A tool call that names an application outside that set gets "Unknown application". The tools are read-only, and each token gets `NOX_MCP_RATE_LIMIT` calls a minute. A missing or revoked token gets a 401 telling you to run `nox login`.

**Connecting an agent.** The quickest way is the CLI:

```bash
nox mcp                       # print the settings for your agent
nox mcp install antigravity   # write them into Antigravity's MCP config (also gemini, claude, cursor, or all)
```

`nox mcp install` adds a `nox` server to the agent's settings file and leaves any other servers alone. The **CLI** page in the web app does the same: pick your agent, create a token, and copy the settings.

When the MCP tools are connected, `/nox` uses them instead of calling the CLI for each lookup.

## A2A: NoX's Ask agent for other agents

NoX's Ask agent is also an **Agent2Agent (A2A)** server, built with Google ADK. Its agent card is public at `{NOX_PUBLIC_API_URL}/a2a/ask/.well-known/agent-card.json`, so an enterprise agent (for example one built on the Gemini Enterprise Agent Platform) can discover it. Sending it a message needs a NoX token in the `Authorization` header, and the answer is scoped exactly as MCP is: the token decides what the agent can read, and nothing in the message can widen it. Answers cite `[[kb:app/page]]` pages.

`NOX_PUBLIC_API_URL` (empty uses `WEBHOOK_BASE_URL`) · `NOX_MCP_RATE_LIMIT`

## Checking connections

**Atlas → Connectors** checks every integration live against this deployment's credentials and shows a clear state for each: connected, not configured, or failing with the reason (for example an expired Atlassian token). The engineering lead's home shows the same health at a glance. The API serves it at `GET /api/v1/integrations/status`.

## Secrets

- In development, secrets live in one `.env` at the repository root, shared by the API and the web app. `.env`, private keys and service-account files are ignored by Git.
- In production, `scripts/deploy_gcp.sh secrets` copies them into **Google Secret Manager**, and Cloud Run mounts them into the services. Nothing secret is baked into an image.
- `WEBHOOK_SECRET` is required: the API refuses to start without it, so webhooks can never be forged with a default value.
- Before anything is indexed or committed to a knowledge base, a secret gate replaces anything that looks like a credential with a withheld note and records it as a Shield finding. With [NoX Shield](/docs/google-ai#nox-shield-model-armor-and-sensitive-data-protection) on, Sensitive Data Protection checks the pages too.
