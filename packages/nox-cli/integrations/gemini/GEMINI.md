# NoX

NoX keeps a knowledge base for every application and carries each change (a mission, `NOX-<n>`) through four spec files: business requirement, product spec, engineering design and build spec. This extension gives you NoX's MCP tools (`search_kb`, `read_kb_page`, `find_interfaces`, `ask_nox`, `get_mission`) and the `/nox NOX-<n>` command.

If a NoX tool or `nox whoami` says you're not signed in, ask the user to run `nox login`, then `nox init gemini` again.

## /nox NOX-<n>
1. **Load the mission.** The command runs `nox context <KEY>` for you. Read all of it: the four spec files and the knowledge-base pages after them. The build spec is the plan; the other files are the why and the limits. "Team lessons", when present, are rules people taught NoX on earlier missions: follow them.
2. **Check the stage.** If the stage is not `developer` or `build`, say so and ask before writing code: the specs above it may still change.
3. **Plan.** List the build spec's Tasks, map each to files in this repo, and name what you will reuse (the "What to reuse" section). Contracts the engineering design marks unchanged stay unchanged. Show the plan before editing.
4. **Look things up instead of guessing.** Use NoX's MCP tools: `search_kb` and `read_kb_page` for the knowledge bases (including any `[[kb:app/path]]` link you meet, in other apps too), and `find_interfaces` for "who exposes / who consumes" questions. Without the tools, `nox search <words>` and `nox read <app/path>` do the same from the shell.
5. **Implement** on the branch the context names (it starts with the mission key), task by task.
6. **Test.** Run the build spec's Test plan and the repo's own tests. Fix failures before moving on.
7. **Open a PR** with the mission key in the title (e.g. `NOX-12: lock accounts after failed logins`) and the task list in the body. NoX links it to the mission and posts a guard comment; if `gh` isn't available, run `nox pr <KEY> <url>` after opening it.
8. **Hand back.** Summarise what changed per task. Don't tick verification checklists: people do that in NoX after the developer runs `nox complete <KEY>`.
