# Roles and seat homes

Everyone in NoX works from one of four seats. A seat decides which file you write, what you check at the end, and which parts of the product you can change. Everything behind every seat is real: the same knowledge bases, the same Jira project and the same Git repositories.

## Signing in

1. Open NoX and choose **Enter NoX**. Sign in with Google through **Firebase Authentication**. In local development there is also a one-field dev sign-in.
2. Every request the web app sends carries the Firebase ID token. The API verifies it with `firebase-admin` and creates your user record the first time it sees you.
3. Pick a seat on the role picker. Each seat is a planet in its own colour. Your choice is remembered, and returning users see **Continue as …** at the top. Next to the four seats, a **More coming soon** planet shows the seats that are next in the queue: Sales, Design, Security & Compliance, and QA. They can't be picked yet.

The role picker allows teams to experience the interface from each seat's perspective. The server treats the seat you picked as your acting role for the session and checks every request against it, so each seat gets its real limits. To switch seats, use the role chip in the top bar or **Switch role** at the bottom of the sidebar.

Every seat uses the same address: `/app`. NoX knows your seat from the server, not from the URL, so a link to a mission works for whoever opens it. Old links that still carry a seat, such as `/app/developer/missions/NOX-1`, redirect to the same page without it.

## The four seats

| Seat | Colour | Writes | Checks at the end |
| --- | --- | --- | --- |
| **Business user** | Gold | `01-business.md`: the request in plain words | "Is my original sentence now true?" |
| **Product owner** | Violet | `02-product.md`: goal, user stories, acceptance criteria, edge cases, metric, priority | The acceptance criteria and edge cases |
| **Engineering lead** | Teal | `03-engineering.md`: applications changing, approach, contracts, guardrails, test strategy, rollout, risks | Scope, contracts and guardrails |
| **Developer** | Blue | `04-developer.md`: files touched, reuse, tasks, test plan, rollout | The code against the build spec |

NoX writes each file in its reader's own vocabulary. For every seat it keeps a *persona*: who reads the file, what they're accountable for, the words they use and the words they avoid. The business user's file talks about customers, screens and outcomes, never APIs or databases. The engineering lead's file names contracts, consumers and failure modes. When a change barely touches a seat, for example a refactor started by a developer as seen by the business user, NoX writes a *light* version of that seat's file: short sections, and a checklist of a few "everything still works as before" checks.

## What each seat can do

The API enforces these capabilities on every call. A request the seat isn't allowed to make gets a clear 403 that names the missing capability.

| Capability | Business | Product | Engineering | Developer |
| --- | :---: | :---: | :---: | :---: |
| Create a mission | ✓ | ✓ | ✓ | ✓ |
| See the Atlas, read knowledge bases, ask a knowledge base | | ✓ | ✓ | ✓ |
| Onboard an application | | ✓ | ✓ | ✓ |
| Add sources, sync, retry and restart pipelines | | ✓ | ✓ | ✓ |
| Pin a correction to a knowledge-base page | | ✓ | ✓ | ✓ |
| Create organizations and teams | | | ✓ | |
| Invite members | | | ✓ | |
| Manage connector credentials | | | ✓ | |
| Set a mission's priority | | ✓ | | |
| Set the Sightings schedule, Look now | | ✓ | ✓ | |
| Edit a spec file | own file | own file | own file | own file |

Every seat can *read* every spec file of a mission it can see. Only the file's own seat can *edit* it. Other seats' tabs are shown locked, with who wrote the file, when it was approved, and whether it is still an unapproved AI draft.

## Seat homes

Each seat has its own home, named for the work it does. All four greet you with your seat's planet character; below that they differ.

| Seat | Home | What it leads with |
| --- | --- | --- |
| **Business user** | **Request desk** | A large "What would you like to change?" box. NoX picks the application from your words. Below it, your requests in your own words, each with a plain progress line: *Asked → Planning → Building → Checking → Done*. Anything that needs you is pinned to the top. No mission keys, stages or applications to choose. |
| **Product owner** | **Product board** | A triage queue of incoming requests with P1–P4 set in place, a *Now / Next / Later / Untriaged* roadmap, the requests waiting on your spec, and what is back for acceptance. |
| **Engineering lead** | **Flight director** | The blast radius: the organization's contract map with every application an open mission touches ringed in that mission's stage colour. Beside it, the design review queue and connector health; below, what's in build, what's back for a scope check and knowledge-base status. |
| **Developer** | **Build bay** | The build queue with a copyable `/nox NOX-n` for each mission ready to build, a terminal panel that shows whether the `nox` CLI has signed in (and how to set it up if not), linked pull requests with their guard result, and your applications. |

Below each seat's main work, **Spotted by NoX** shows the top three changes NoX suggests for that seat (see [Sightings](/docs/sightings)). The business user sees them as **Ideas from NoX**, only when there are some.

Each seat also has its own texture behind the page (a warm wash, a board, a blueprint grid, terminal scanlines) and one primary action: **New mission** (product owner), **Review designs** (engineering lead) and **Onboard application** (developer). The business user's request box is the page itself.

## The missions page, by seat

The missions page opens in the layout each seat thinks in. Product, engineering and developer can switch layouts with **Stages**, **Priority** and **Table**.

- **Business user:** your requests as cards with the plain progress line.
- **Product owner:** a priority board (*Now / Next / Later / Untriaged*), with priority set in place.
- **Engineering lead:** stage lanes from business to done, your lane highlighted.
- **Developer:** a table of key, title, applications, stage, pull request and the `/nox` command. On a phone it becomes a list.

## A mission, by seat

The mission page adds what each seat needs first, above the spec files:

- **Business user:** the plain progress line and one sentence on what is happening now. You see your own file; **Show the full trail** opens the other three. The Jira and pull-request panel is hidden.
- **Product owner:** the count of acceptance criteria in your spec, the priority, and the acceptance check once the mission comes back.
- **Engineering lead:** the side panel shows the blast radius: each changing application, how many interfaces it exposes, and the applications tied to it by a contract.
- **Developer:** a terminal card with `nox context NOX-n --save`, the copyable `/nox NOX-n`, the branch, the Jira issue and the pull requests.

## Organizations and visibility

Visibility is governed by organization membership rather than seat. You are a member of the organizations you created or were invited to, and you see every team and application beneath them. An engineering lead invites people by email from the Atlas. If the person has never signed in, the invite is saved and they join automatically on their first sign-in.

## Navigation

Each seat has a short navigation of its own. The missions entry takes the seat's name for it.

| Seat | Navigation |
| --- | --- |
| **Business user** | Home · My requests · Sightings · Atlas · Impact |
| **Product owner** | Home · Backlog · Sightings · Atlas · Specs · Impact |
| **Engineering lead** | Home · Design reviews · Sightings · Atlas · Activity · Impact |
| **Developer** | Home · Build queue · Sightings · Atlas · CLI · Impact |

**Atlas** holds organizations, teams, applications, knowledge bases, the contract map and connectors. **Specs** is the library of spec files across missions, and **Activity** the organization-wide feed (both pages are in place; the cross-mission views are on the [roadmap](/docs/roadmap)). **CLI** shows how to connect the `nox` CLI and the tokens it has signed in with.

The command palette in the top bar (`⌘K`) jumps to any page or action from anywhere.

The sun and moon button in the top bar switches between the dark theme and a light one. Each seat keeps its own colour in both, deepened in the light theme so it stays easy to read. NoX remembers your choice on this device, and the landing page and docs have the same button.
