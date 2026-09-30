---
name: nox
description: Build NoX missions (NOX-<n>) and answer architecture questions from NoX's knowledge bases through the nox CLI.
---

# NoX

If `nox whoami` fails, ask the user to run `nox login`. Search with `nox search <words>`, read pages with `nox read <app/path>`.

## /nox NOX-<n>
1. **Load the mission.** Run `nox context <KEY>` and read all of it: the four spec files (business requirement, product spec, engineering design, build spec) and the knowledge-base pages after them. The build spec is the plan; the other files are the why and the limits.
2. **Check the stage.** If the stage is not `developer` or `build`, say so and ask before writing code — the specs above it may still change.
3. **Plan.** List the build spec's Tasks, map each to files in this repo, and name what you will reuse (the "What to reuse" section). Contracts the engineering design marks unchanged stay unchanged. Show the plan before editing.
4. **Look things up instead of guessing.** `nox search <words>` searches the knowledge bases; `nox read <app/path>` opens a page, including any `[[kb:app/path]]` link you meet — pages in other apps too. When NoX's MCP tools are available (`search_kb`, `read_kb_page`, `find_interfaces`, `ask_nox`; set up with `nox mcp install <agent>`), prefer them over shelling out to `nox search` / `nox read`, and use `find_interfaces` for "who exposes / who consumes" questions.
5. **Implement** on the branch the context names (it starts with the mission key), task by task.
6. **Test.** Run the build spec's Test plan and the repo's own tests. Fix failures before moving on.
7. **Open a PR** with the mission key in the title (e.g. `NOX-12: lock accounts after failed logins`) and the task list in the body. NoX links it to the mission and posts a guard comment; if `gh` isn't available, run `nox pr <KEY> <url>` after opening it.
8. **Hand back.** Summarise what changed per task. Don't tick verification checklists — people do that in NoX after the developer runs `nox complete <KEY>`.
