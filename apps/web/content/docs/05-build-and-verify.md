# Build and verify

Once the build spec is approved, a coding agent builds the mission with everything NoX knows about it. When the developer says the build is done, the people who asked for the change check it in reverse order, each against their own file.

## The `nox` CLI

The `nox` command line tool connects a developer's terminal and coding agent to NoX. It has no dependencies beyond Node 18.

```bash
packages/nox-cli/install.sh         # puts `nox` on your PATH
nox login --api https://nox.example.com
```

**Signing in.** `nox login` uses a device flow. It prints a short code and opens the browser at NoX's authorize page. You check that the code matches and approve, and the CLI receives a personal API token. The token is stored hashed on the server and in `~/.nox/config.json` (readable only by you) on your machine. `nox whoami` shows who you are signed in as and which NoX you're talking to.

| Command | What it does |
| --- | --- |
| `nox missions [--view waiting\|flight\|back\|mine]` | Your missions, in the same views as your seat home |
| `nox context NOX-12 [--save]` | The whole mission for an agent: all four spec files, the knowledge-base brief and relevant pages, contracts, links and the branch to work on. `--save` writes it to `.nox/missions/NOX-12.md` |
| `nox search <words> [--app x]` | Hybrid search across every knowledge base you can see |
| `nox read <app/path>` | Print one knowledge-base page, the same reference as a `[[kb:app/path]]` link |
| `nox discover` | Which application this repository is, from its Git remote |
| `nox kbs` | The knowledge bases you can see |
| `nox pr NOX-12 [<url>]` | Link a pull request to the mission (NoX runs the guard and comments) |
| `nox complete NOX-12` | Mark the mission as completed and open verification |
| `nox init <agent>` | Install `/nox` for a coding agent |
| `nox kb build \| sync \| push \| watch \| status` | NoX Local: build a knowledge base on this machine with Gemma |

Most commands accept `--json` for scripts and agents.

## `/nox` in your coding agent

`nox init` installs NoX into the coding assistant you already use, in each assistant's own format:

| Agent | `nox init …` | What it installs |
| --- | --- | --- |
| Google Antigravity | `antigravity` | A NoX skill in `~/.gemini/config/skills/nox/` |
| Cursor | `cursor` | A rule at `.cursor/rules/nox.mdc` |
| OpenAI Codex | `codex` | A NoX section appended to the repository's `AGENTS.md` |
| GitHub Copilot | `copilot` | A NoX section in `.github/copilot-instructions.md` |
| Claude Code | `claude` | A `/nox` slash command and a NoX skill under `.claude/` |

`nox init all` installs every one. Then, in the agent:

```text
> /nox NOX-12
```

The agent then works through the mission:

1. **Loads the mission** with `nox context NOX-12`: the business requirement, product spec, engineering design and build spec, then the knowledge-base pages after them. The build spec is the plan. The other files explain why, and set the limits.
2. **Checks the stage.** If the mission isn't at the developer or build stage yet, it says so and asks before writing code, because the specs above may still change.
3. **Plans.** It lists the build spec's tasks, maps each to files in the repository, and names what it will reuse. Contracts the engineering design marks *unchanged* stay unchanged. It shows the plan before editing.
4. **Looks things up instead of guessing,** with `nox search` and `nox read`, including pages in other applications' knowledge bases.
5. **Implements** task by task on a branch named after the mission, for example `nox-12-block-brute-force-logins`.
6. **Tests** with the build spec's test plan and the repository's own tests.
7. **Opens a pull request** with the mission key in the title, for example `NOX-12: lock accounts after failed logins`.
8. **Hands back** a summary per task. It never ticks verification checklists; people do that.

## The guard on every pull request

A pull request is linked to its mission when its branch, title or body names the mission key, either through the GitHub pull-request webhook or with `nox pr`. NoX then runs the **guard**:

- It reads the architecture rules from each mission application's knowledge base: the decisions and the concepts that state constraints.
- It checks the lines the pull request adds against those rules.
- It posts the result as a comment on the pull request, where reviewers already work, and updates that same comment on later pushes rather than adding new ones.
- It shows the result in the mission's **Jira & pull requests** panel: **clear against N rules**, or **N possible conflicts — see the PR**.

## Marking the mission completed

When the work is merged, the developer chooses **Mark as completed** on the mission, or runs `nox complete NOX-12`. The mission moves to **Verifying**, the Jira ticket moves to **In Review**, and verification opens with the developer.

## Reverse verification

Every spec file ends with a verification checklist that its author wrote while writing the spec:

```markdown
## Verification checklist

- [x] Accounts lock after five failed attempts
  - Note: checked on staging with a test account
- [ ] Support can unlock an account from the admin page
```

After **Mark as completed**, the checklists open one at a time, in reverse order:

```text
Developer  ──▶  Engineering lead  ──▶  Product owner  ──▶  Business user  ──▶  Done
code vs build   scope, contracts,      acceptance          "is my sentence
spec, tests     guardrails             criteria, edge      now true?"
                                       cases, metric
```

The **Coming back** strip on the mission page shows where verification has got to. When it's your turn, the checklist at the bottom of your own file lights up. Until then it stays greyed out.

**To verify:**

1. Tick each item as you confirm it. Ticks save as you go.
2. Add a **note** to any item: how you checked it, what you saw, a link to evidence. Notes are written into the file under the item.
3. When every item is ticked, choose **Verified**. The checklist passes to the next seat. When the business user verifies, the mission is **Done** and the Jira ticket moves to **Done**.

**Verified** is only available once every item is ticked. If something isn't right, don't tick it: flag it as not met.

### Show it works

Instead of describing what you checked, you can show it. **Show it works** on your checklist opens Show NoX: record the new behaviour or take a screenshot. NoX watches it next to the mission's earlier captures and your checklist, and writes a hint under each item it can speak to, such as *NoX saw: the account locked after the fifth attempt ▶ 0:31*. The capture is added to the mission's Evidence tab.

NoX never ticks an item. The hints are there to help you decide; the tick is yours.

## When something isn't met

Choose **Not met** on your checklist, then:

1. **Say what isn't met.** A note is required, so the next person knows exactly what to fix.
2. **Send it back to the seat that owns the problem:**
   - **Developer** (the default): the requirement stands, and the build needs another pass. The mission returns to **Build**.
   - **An earlier seat**: the requirement itself was wrong. The mission returns to that seat, and its file reopens as a draft to be fixed and re-approved.
3. The note is recorded on the timeline and posted to the Jira ticket.

When the fix is in, the developer marks the mission completed again and a new verification round starts. Ticks are stored in the files themselves, so items that were already confirmed stay ticked.

## Everything is written back to the file

Ticks, notes, who verified and when are all written into the same Markdown file and committed to its Git repository. There is no separate verification record to keep in sync. The file in Git is the record of what was asked for, what was agreed, and what each person confirmed.

## NoX Local: knowledge bases on your machine

Some code can't leave the building. **NoX Local** builds and maintains an application's knowledge base on a developer's own machine, using **Gemma** through **Ollama**:

```bash
ollama pull gemma4:12b          # about 8 GB; fits a 16 GB laptop (gemma4:e4b for smaller machines)
cd your-repo
nox kb build                    # map the repo and write the pages into .nox/kb/
nox kb push                     # send only the Markdown to NoX: it lints, indexes and opens the KB pull request
nox kb watch                    # after every commit, Gemma updates the affected pages and pushes a KB pull request
```

It is the same ADK agent team NoX runs in the cloud (cartographer, page writers, gatekeeper and patch compiler), reading the repository straight from disk. When the pages reach NoX, they are written as an Open Knowledge Format bundle like any other knowledge base, with `generated.by: nox-local/gemma4:12b` on every page. Every checkpoint stays in the repository's `.nox/` folder. The source code never leaves the machine; NoX only ever receives the finished pages. The application's page in the Atlas shows a **Built locally · gemma4:12b · code never left the laptop** badge (and **Built by NoX's agents · <model>** for cloud builds), so everyone can see how its knowledge base was made.

`nox kb watch` installs a Git `post-commit` hook that runs `nox kb sync --push` in the background after each commit. Run it again to remove the hook.
