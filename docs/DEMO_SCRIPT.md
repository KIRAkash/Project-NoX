# NoX demo script (5 minutes)

One mission, four seats, one sentence to merged code and back. Built on the Apex demo org: the change lands in **mini-auth-service** (Platform), and the design has to respect the services that call it.

## Before you start (10 minutes, not on the clock)

| Check | How |
| --- | --- |
| Board is empty | `make demo-reset` (keeps the knowledge bases) |
| Knowledge bases are In Orbit | Atlas → every Apex app shows *In orbit*, not *In review* |
| Jira works | Atlas → Connectors → Jira is green; `APEX` has no leftover `nox`-labelled tickets |
| CLI signed in on the demo laptop | `nox whoami` prints the demo account |
| Demo repo checked out, `/nox` installed | `cd mini-auth-service && nox init antigravity` (commit the files beforehand) |
| Four browser profiles, one per seat | Business user, Product owner, Engineering lead, Developer — each on its mission-control page |
| Backup | A finished mission (`NOX-0`-style dry run) open in a spare tab in case the model is slow |

Keep the Jira board (`APEX`) open in a fifth tab.

## The run

### 0:00 — Business user asks (40 s)
Seat: **Business user** → *New mission* → type:

> Block brute-force logins: lock an account for 15 minutes after 5 failed password attempts.

Pick **mini-auth-service** (NoX suggests it). *Start mission*.

Say: *"That's all the business user writes. No ticket template, no Jira fields."*
Show: the business requirement file drafting live; the orbit arc at stage 1.

Approve the business requirement.

### 0:40 — Product owner shapes it (60 s)
Seat: **Product owner** → *Waiting on you* → the mission.

Show: NoX's product spec draft is already there, grounded in the knowledge base (hover a `kb:` link).
Do: add one edge case in the editor — *"Lockout must not reveal whether the username exists."* → Save.
Show: **NoX's cursor** refines the file after the save (the tinted lines), keeping the edge case.
Do: set priority **P1**, then *Create ticket* in the Jira panel → `APEX-n` appears; flip to the Jira tab to show it.

Approve.

### 1:40 — Engineering lead designs (50 s)
Seat: **Engineering lead**.

Show: the engineering design lists the contracts `POST /api/v1/auth/login` and `GET /api/v1/auth/me` as *unchanged*, and names which apps call them (from the Atlas contract map).
Do: ask the corner chat *"Which services call the login endpoint?"* — NoX answers from the knowledge base.

Approve → Jira ticket moves to **In Progress** on its own (show the Jira tab).

### 2:30 — Developer builds with `/nox` (80 s)
Seat: **Developer**. Show the build spec's Tasks and the Verification checklist at the bottom, then *Approve*.

Google Antigravity, with `mini-auth-service` open, in the agent panel:

```
/nox NOX-1
```

Show: the agent runs `nox context NOX-1`, prints its plan against the Tasks, edits `src/config.py`, `src/auth.py`, `src/main.py`, runs the tests, and opens a PR titled `NOX-1: …`.

(If time is short, have the PR prepared on a branch and run only `nox context NOX-1 | head -40` live.)

Back in NoX: the PR appears in the mission's *Jira & pull requests* panel with the **guard** result; on GitHub the NoX guard comment is on the PR.

### 3:50 — Mark as completed, and back up the chain (60 s)
Developer: *Mark as completed* (or `nox complete NOX-1`). Jira → **In Review**.

Show the **Coming back** strip: Developer → Engineering lead → Product owner → Business user.

Tick through quickly — one seat each, 10–15 s:
1. Developer ticks the build checklist → *Verified*.
2. Engineering lead ticks contracts-unchanged → *Verified*.
3. Product owner: on the edge-case item, click **Not met** once, note *"Error text differs for unknown users"*, send to Developer → mission drops back to Build.
   Say: *"That's the loop closing — a real reviewer, a real reason, straight back to the person who fixes it."*
   (For time, the fix is already on the PR branch: developer marks completed again; ticks survive.)
4. Product owner → *Verified*. Business user reads their own sentence as a checklist item → *Verified*.

Mission → **Done**, Jira → **Done**. The ticked files are in the KB repo under `missions/NOX-1-…/`.

### 4:50 — Close (10 s)
*"Four people, four files, one sentence. Every file is in Git, every step is on the Jira ticket, and the check at the end was done by the people who asked."*

### Show NoX beat (≈40 s, for the video)
A second mission, recorded for the video rather than run in the 5 minutes. Open `demo/screens/trade-desk.html` in a tab first. Keep `demo/screens/captures/trade-desk-pending.webm` as the fallback if live recording fails.

1. Seat: **Business user** → *New mission* → **Record screen** → share the trade-desk tab. Narrate: *"This iceberg order filled in two parts. The first fill settled. The second, T-40816, has been Pending settlement since this morning."* Stop.
2. NoX's live steps appear on the capture card. Show the key moments, the finding (ADR-002: settlement is event-driven), and the suggested request. **trade-settlement-system** is ticked, marked *seen in your capture*.
3. **Use this sentence** → *Start mission*. The business requirement drafts with ▶ 0:42 chips; click one to play the capture from that moment. Point out: no code anywhere in this file.
4. Cut to **Developer**: the mission's **Evidence** tab shows the same capture with code locations (for example `TradeMatchedListener.java`).

Say: *"Nobody had to find the words. NoX watched, looked it up in the knowledge base, and wrote it for each reader."*

## If something goes wrong

| Symptom | Recovery |
| --- | --- |
| A NoX draft takes more than 20 s | Keep talking over the live cursor; the backup mission tab shows the finished state |
| Jira panel says credentials | Skip the ticket beats; the timeline still shows every stage |
| `/nox` agent stalls | Open the prepared PR; run `nox pr NOX-1 <url>` to link it |
| Guard comment missing | GitHub PR webhook not reaching the API — show the guard result in NoX's panel instead |
| Capture card stuck on a step | Retry on the card; or upload the fallback clip from `demo/screens/captures/` |
| Wrong seat in a browser | Avatar → Switch role (free role picker) |

## Reset after a rehearsal

```
make demo-reset
```

Then close the rehearsal's `APEX` ticket(s) and, if you want a clean repo, delete the `missions/NOX-*` folder and `nox/NOX-*` branch in `kb-apex-mini-auth-service`.
