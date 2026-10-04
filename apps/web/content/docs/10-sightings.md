# Sightings

NoX doesn't only wait to be asked. On a schedule, it reads what it knows about your applications and suggests changes worth making. Each suggestion, a **sighting**, is written for the seat that reads it, and any seat can turn one into a mission with one click.

## One opportunity, four lenses

The same fact matters differently to each seat. A query that runs once per item in a loop is a slow page to the developer, a running cost to the engineering lead, a broken flow to the product owner and lost sales to the business. NoX keeps those views together:

1. **It looks through each seat's lens.** A scout agent per seat looks for the kinds of change that seat cares about, with the lookup tools that seat is allowed.
2. **It merges what overlaps.** Two scouts that found the same thing, or point at the same sources, produce one sighting, not two.
3. **It writes a view per seat, only where it matters.** A critic scores how much each sighting matters to each seat. NoX writes a view only for the seats where it scores high enough.

| Seat | What counts as worth changing |
| --- | --- |
| **Business user** | Revenue or sales being lost, customer journeys that are slow or confusing, staff doing by hand what the product could do, risk, things customers keep asking for |
| **Product owner** | Friction in a flow, missing states (empty, error, limits), behaviour that differs between screens or applications, capability users can't reach, outcomes nobody can measure |
| **Engineering lead** | Coupling and drift from recorded decisions, the same capability built twice, structural cost (polling, chatty calls, duplicate stores), reliability, security |
| **Developer** | Slow paths, duplication and dead code, risky code with no tests, outdated dependencies, slow builds |

A business sighting never mentions endpoints, services or code. NoX checks every business and product view against that seat's rules and rewrites it once if it breaks them. If it still breaks them, the view is dropped.

## What NoX looks at

- Each application's knowledge base: its brief, its pages, and the source snapshot it was built from.
- The contract map: which applications expose and consume which interfaces.
- Missions that changed the application in the last six months: send-backs, checklist items that failed or couldn't be verified, and linked Jira issues.
- Screenshots and recordings people showed NoX that it judged to be a bug or a missing feature.
- NoX Shield findings in the application's sources (engineering lead only).

## Grounded, or not shown

- **Every sighting cites what it rests on.** If a scout cites a page it never read, a code location that isn't in the source, or a mission or Jira issue that isn't in the signals, that citation is dropped. A sighting with nothing left to cite is dropped too.
- **No invented numbers.** Impact is High, Medium or Low with the reason. Money, time and user counts appear only when a source states them.
- **Each seat sees only its own evidence.** The engineering lead and developer see pages and `path:line` code. The product owner sees pages, missions, captures and Jira. The business user sees missions, captures and Jira, plus a few plain lines on what the sources show. Code never reaches the business or product seat.
- **You see a sighting only if you can see every application it cites.**
- **It doesn't repeat itself.** NoX skips anything already in flight as a mission, anything still open, and anything someone dismissed in the last 90 days. It also tells the scouts what each seat turned down and why.

## Acting on a sighting

Each card shows the kind and the impact (and effort, for the engineering and developer seats), the sighting in your words, and **How NoX knows**.

| Action | What happens |
| --- | --- |
| **Start mission** | One click. NoX starts a mission from your seat with the sighting's request in your words, on the applications it cites. Every spec file drafted for it sees where it came from, filtered for that file's reader. The mission then runs through every seat as usual. |
| **Edit first** | Opens the new-mission form filled in from the sighting, to reword before you start. |
| **Not now** | Hides it for 30 days. |
| **Dismiss** | Asks why (not relevant, already known, NoX got it wrong). NoX remembers the reason. |

Once any seat starts a mission from a sighting, every other seat's card shows it in flight ("NOX-14 · Design review · started by Dana as engineering lead") instead of Start mission, so nobody starts the same change twice. When the mission is done, the sighting is marked shipped. The mission page shows **from a NoX sighting** next to its key.

## Where you see them

- **Your home** shows the top three as **Spotted by NoX**, below your seat's main work. On the business user's request desk they appear as **Ideas from NoX**, only when there are some.
- **Sightings** in the navigation lists them all, with **Open**, **Started** and **Dismissed** tabs and filters by application and kind.

## The schedule

NoX looks once a week by default, on Monday at 08:00 UTC, across a top-level organization and every team beneath it. The product owner and engineering lead can change it on the Sightings page:

- **How often:** off, daily or weekly, with the day, hour and timezone.
- **Which seats** get sightings.
- **Focus** (optional): kinds of change to weight up, such as Cost or Customer experience.
- **Look now** runs a full pass straight away and shows its progress.

A scheduled run skips every application whose inputs haven't changed since the last one, so a quiet week costs almost nothing. Open sightings on a changed application are checked again first. If the pages or code they cite are gone, they leave the feed as outdated. At most five new sightings per seat come from one run (`NOX_SIGHTINGS_MAX_PER_SEAT`). The last run's model calls, tokens and cost show under the schedule.

**How the schedule runs.** Celery beat checks for due runs every 15 minutes. It runs inside the worker service on Cloud Run, so nothing else needs setting up. Without beat, set `NOX_SIGHTINGS_TICK=local` on a single API instance, or have any scheduler call `POST /api/v1/internal/sightings/tick` with the `X-Nox-Tick` secret (`NOX_SIGHTINGS_TICK_SECRET`) or a Google OIDC token for `NOX_SIGHTINGS_SCHEDULER_SA`. Due schedules are claimed with a row lock, so two instances never start the same run twice.

## API

| Route | What it does | Who |
| --- | --- | --- |
| `GET /api/v1/sightings?status=open\|launched\|dismissed` | Your seat's sightings | Any seat |
| `GET /api/v1/sightings/{id}` | One sighting, as your seat sees it | A seat with a view of it |
| `POST /api/v1/sightings/{id}/launch` | Start mission | Any seat that can create missions |
| `POST /api/v1/sightings/{id}/feedback` | `useful`, `dismissed` (with a reason), `snoozed` or `restore` | A seat with a view of it |
| `GET /api/v1/sightings/schedules` | Your top-level organizations, with their schedule and last run | Seats that see the Atlas |
| `GET`, `PUT /api/v1/orgs/{id}/sightings/settings` | Read or change the schedule | Read: seats that see the Atlas. Change: product owner, engineering lead |
| `POST /api/v1/orgs/{id}/sightings/run` | Look now (progress on `…/sightings/stream`) | Product owner, engineering lead |
| `GET /api/v1/orgs/{id}/sightings/runs` | The last ten runs | Seats that see the Atlas |
