# Tidewell Mutual demo estate

The NoX demo company: a home and motor insurer with ten connected applications. `estate.yaml` describes all of it, and the seed scripts and `scripts/check_estate.py` read that file. The plan and the reasoning are in [docs/plans/CP19-demo-estate.md](../../docs/plans/CP19-demo-estate.md).

Only `estate.yaml` and this README are in Git. The reference code and the source content (`codebases/`, `branches/`, `sources/`, `screens/`) stay on the machine that seeded the estate, because they have already been published to the places below. NoX reads them from there, the same way it reads any enterprise's systems.

## Where the estate lives

**GitHub:** the [Nox-Demo-Org](https://github.com/Nox-Demo-Org) organization.

| What | Repositories |
| --- | --- |
| Application code (with the prepared branches) | [billing-service](https://github.com/Nox-Demo-Org/billing-service), [claims-intake](https://github.com/Nox-Demo-Org/claims-intake), [claims-management](https://github.com/Nox-Demo-Org/claims-management), [customer-identity](https://github.com/Nox-Demo-Org/customer-identity), [customer-portal](https://github.com/Nox-Demo-Org/customer-portal), [fraud-scoring](https://github.com/Nox-Demo-Org/fraud-scoring), [notifications-hub](https://github.com/Nox-Demo-Org/notifications-hub), [payments-gateway](https://github.com/Nox-Demo-Org/payments-gateway), [policy-admin](https://github.com/Nox-Demo-Org/policy-admin), [rating-service](https://github.com/Nox-Demo-Org/rating-service) |
| Application knowledge bases (OKF bundles NoX built) | [kb-tw-billing-billing-service](https://github.com/Nox-Demo-Org/kb-tw-billing-billing-service), [kb-tw-billing-payments-gateway](https://github.com/Nox-Demo-Org/kb-tw-billing-payments-gateway), [kb-tw-claims-handling-claims-management](https://github.com/Nox-Demo-Org/kb-tw-claims-handling-claims-management), [kb-tw-claims-handling-fraud-scoring](https://github.com/Nox-Demo-Org/kb-tw-claims-handling-fraud-scoring), [kb-tw-claims-intake-claims-intake](https://github.com/Nox-Demo-Org/kb-tw-claims-intake-claims-intake), [kb-tw-customer-platform-customer-identity](https://github.com/Nox-Demo-Org/kb-tw-customer-platform-customer-identity), [kb-tw-customer-platform-notifications-hub](https://github.com/Nox-Demo-Org/kb-tw-customer-platform-notifications-hub), [kb-tw-digital-customer-portal](https://github.com/Nox-Demo-Org/kb-tw-digital-customer-portal), [kb-tw-policy-admin-policy-admin](https://github.com/Nox-Demo-Org/kb-tw-policy-admin-policy-admin), [kb-tw-rating-rating-service](https://github.com/Nox-Demo-Org/kb-tw-rating-rating-service) |
| Team rollups | [kb-org-tw-billing](https://github.com/Nox-Demo-Org/kb-org-tw-billing), [kb-org-tw-claims-handling](https://github.com/Nox-Demo-Org/kb-org-tw-claims-handling), [kb-org-tw-customer-platform](https://github.com/Nox-Demo-Org/kb-org-tw-customer-platform) |

**Confluence** on [project-nox.atlassian.net](https://project-nox.atlassian.net/wiki):

| Space | Name |
| --- | --- |
| [TWDIG](https://project-nox.atlassian.net/wiki/spaces/TWDIG) | Tidewell Digital & Customer Platform |
| [TWPOL](https://project-nox.atlassian.net/wiki/spaces/TWPOL) | Tidewell Policy |
| [TWCLM](https://project-nox.atlassian.net/wiki/spaces/TWCLM) | Tidewell Claims |
| [TWBILL](https://project-nox.atlassian.net/wiki/spaces/TWBILL) | Tidewell Billing & Payments |

**Jira** on the same site: [TWPOL](https://project-nox.atlassian.net/jira/software/projects/TWPOL) (Policy & Billing, TWPOL-1 to TWPOL-12; missions file their tickets here) and [TWCLM](https://project-nox.atlassian.net/jira/software/projects/TWCLM) (Claims, TWCLM-1 to TWCLM-11).

**Slack:** [#tw-architecture](https://slack.com/archives/C0C6P7CHTBK), [#tw-claims](https://slack.com/archives/C0C7FKXSNBS), [#tw-billing](https://slack.com/archives/C0C6QV4QAG4), [#tw-contact-centre](https://slack.com/archives/C0C6FVCB03X).

**Notion:** the "Tidewell Mutual" page, with [Customer research](https://www.notion.so/3ef290fdbfcb81268b08f7fb63ac047e), [Claims v2 requirements](https://www.notion.so/3ef290fdbfcb81cea680c801980149fe) and [Data dictionary](https://www.notion.so/3ef290fdbfcb81c786a5d3ce348c49cd).

The Atlassian, Slack and Notion workspaces are private. The GitHub repositories are public.

## What's in the local folder

The seed scripts and `scripts/check_estate.py` need these folders, so re-seeding needs a copy of them.

| Path | What |
| --- | --- |
| `estate.yaml` | Org tree, apps, contracts, sources per app, prepared branches, planted demo beats (in Git) |
| `codebases/<app>/` | Ten reference codebases (Go, Java, Kotlin, TypeScript, Python). Reference code: written for NoX to read, it does not build or run |
| `branches/<branch>/<app>/` | Files that differ on the prepared branches (Flow B, PR guard) |
| `sources/confluence/<SPACE>/` | Confluence pages, one Markdown file per page (the `# heading` is the title) |
| `sources/jira/issues.json` | Jira epics, stories, bugs and tasks, with components named after apps |
| `sources/slack/<channel>.json` | Slack threads per channel |
| `sources/notion/` | Notion pages |
| `sources/uploads/` | OpenAPI and AsyncAPI files, uploaded as sources |
| `screens/claim-tracker.html` | Mock screen for Show NoX |
| `.seeded.json` | Written by the seeder: Slack channel ids and Notion page URLs |

## Setting it up

Run all commands from `apps/api`.

1. **Check the estate.**
   ```bash
   uv run python ../../scripts/check_estate.py
   ```
2. **Seed Slack and Notion.** This is already done on the current workspace: 4 `#tw-` channels and the "Tidewell Mutual" Notion page with 3 child pages.
   ```bash
   uv run python -m nox_api.demo.seed_sources --only slack --only notion
   ```
3. **Seed Confluence and Jira.** This needs a working Atlassian API token: put it in `JIRA_API_TOKEN` and `CONFLUENCE_API_TOKEN` in `.env`. Creating spaces and projects also needs admin rights. If the token doesn't have them, the script prints the spaces (`TWDIG`, `TWPOL`, `TWCLM`, `TWBILL`) and projects (`TWPOL`, `TWCLM`) to create by hand, and you re-run it.
   ```bash
   uv run python -m nox_api.demo.seed_sources --only confluence --only jira
   ```
4. **Create the GitHub org and install the NoX GitHub App on it.** Then set `GITHUB_DEFAULT_ORG` (and `GITHUB_APP_INSTALLATION_ID` for the new installation) in `.env`, and push:
   ```bash
   uv run python -m nox_api.demo.push_repos --open-prs
   ```
5. **Point NoX at the estate** in `.env`: `JIRA_DEFAULT_PROJECT=TWPOL`, `JIRA_ALLOWED_PROJECTS=TWPOL,TWCLM`, `NOX_DEMO_ORG_SLUGS=tidewell`.
6. **Build the org tree and the knowledge bases.** Build one app first to check cost and time.
   ```bash
   uv run python -m nox_api.demo.seed_org --app billing-service --member you@example.com
   uv run python -m nox_api.demo.seed_org
   ```

## The demo beats

`planted` in `estate.yaml` lists every beat and the files that ground it. The main ones:

- **Hero mission (all four seats):** "Stop charging instalment fees to customers who've been with us more than five years." The change lands in `billing-service` (`internal/fees/instalment.go`). Tenure comes from customer-identity's unchanged `GET /v1/customers/{id}`.
- **Show NoX:** record `screens/claim-tracker.html`. The customer sees Submitted while the handler console says assigned. This traces back to `claims.handler.assigned`, which no app consumes.
- **Sightings:** late renewal notices, manual fee refunds, the shared `policy_cover` table, duplicated pro-rata maths, the fraud vendor call with no timeout, the old Spring Boot, the untested rating factors and the TODO cluster in intake.
- **Shield:** the prompt injection in the TWCLM payouts runbook, the claimant's details in `#tw-claims`, and the SMS key in notifications-hub.
- **Flow B / PR guard:** the branches `docs/readme-typo`, `feat/issued-channel-field` and `refactor/drop-excess-field`.
