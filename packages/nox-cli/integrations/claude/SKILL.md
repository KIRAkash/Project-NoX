---
name: nox
description: Use when the user mentions a NoX mission key (NOX-12), asks to build a NoX mission, or needs architecture, API, contract or design context about this codebase or the services it talks to. Loads mission spec files and searches NoX's knowledge bases through the `nox` CLI.
---

# NoX

NoX keeps one spec file per role for each mission (business → product → engineering → developer) and a knowledge base for every application. The `nox` CLI reads both. If `nox whoami` fails, ask the user to run `nox login`.

## Questions about the codebase
- `nox discover` — which NoX application this repo is
- `nox search <words> [--app <name>]` — ranked knowledge-base pages
- `nox read <app/path>` — one page; follow `[[kb:app/path]]` links the same way

## Building a mission
1. **Load the mission.** Run `nox context <KEY>` and read all of it: the four spec files (business requirement, product spec, engineering design, build spec) and the knowledge-base pages after them. The build spec is the plan; the other files are the why and the limits.
2. **Check the stage.** If the stage is not `developer` or `build`, say so and ask before writing code — the specs above it may still change.
3. **Plan.** List the build spec's Tasks, map each to files in this repo, and name what you will reuse (the "What to reuse" section). Contracts the engineering design marks unchanged stay unchanged. Show the plan before editing.
4. **Look things up instead of guessing.** `nox search <words>` searches the knowledge bases; `nox read <app/path>` opens a page, including any `[[kb:app/path]]` link you meet — pages in other apps too.
5. **Implement** on the branch the context names (it starts with the mission key), task by task.
6. **Test.** Run the build spec's Test plan and the repo's own tests. Fix failures before moving on.
7. **Open a PR** with the mission key in the title (e.g. `NOX-12: lock accounts after failed logins`) and the task list in the body. NoX links it to the mission and posts a guard comment; if `gh` isn't available, run `nox pr <KEY> <url>` after opening it.
8. **Hand back.** Summarise what changed per task. Don't tick verification checklists — people do that in NoX after the developer runs `nox complete <KEY>`.
