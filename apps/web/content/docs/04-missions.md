# Missions

A mission is one change, from the first request to the verified result. Each mission has four spec files, one per seat, and each file is written by one person with NoX as co-author. Together they are the mission's specification, and they travel with it into the code, into Jira and into Git.

Missions are numbered `NOX-1`, `NOX-2` and so on. Every seat can start one.

## Starting a mission

As a business user, type your request into **What would you like to change?** on your home. From the other seats, use **+ New mission** on your home (product owner) or on the missions page.

1. **The request.** Say what you want the way you'd say it to a colleague. One sentence is enough:
   > Block brute-force logins: lock an account for 15 minutes after 5 failed password attempts.

   Mark it as **Something new** or **Something broken**.
2. **Starting from a Jira ticket?** Enter its key (for example `APEX-42`). NoX links the ticket first, so its summary, description and comments feed into the drafts.
3. **Which applications?** NoX ranks the applications you can see by how much of the request's vocabulary each one owns: its name, its contracts and its knowledge-base brief. Pick one or more. The first one you pick is the **primary** application: the mission's spec files are kept in its knowledge-base repository.
4. **Start mission.** NoX immediately begins writing first drafts.

## Show NoX

Some things are faster to show than to say. Next to the request box, **Show NoX** lets you:

- **Record screen**: up to 5 minutes of a tab, a window or your screen, with your voice if you allow the microphone. A three-second countdown starts it, and a pill shows the time, with pause and stop.
- **Take screenshot**: one frame of what you share. You can mark it up with a box, an arrow, a pen or text before sending, so NoX knows where to look.
- **Voice note**: up to 10 minutes of speech.
- **Upload**: an image (up to 10 MB), a video (up to 200 MB) or an audio file (up to 50 MB). You can also paste an image, or drop a file, onto the page.

A mission holds up to 12 captures. Record screen is hidden where the browser can't capture the screen (most phones).

**What NoX does with it.** A capture card shows each step live while NoX works:

1. **Watches.** Gemini watches the video (or looks at the image, or listens) and writes down only what it sees and hears: a transcript with times, the key moments, the screens, and the exact words on them.
2. **Looks it up.** NoX searches the knowledge bases you can see for those words, reads the pages that explain them, and finds which application the capture is about. For the engineering and developer seats it also finds the code.
3. **Explains.** The card shows the key moments (▶ jumps the player there), what the knowledge base says about the behaviour (a bug, working as designed, or something missing), open questions, and a **Suggested request** you can take with **Use this sentence**.

The applications NoX found move to the top of **Which applications?** and are ticked for you, marked *seen in your capture*. A capture of something broken switches the mission to **Something broken**. When you start the mission, the captures come with it, and the drafts cite their moments as ▶ 0:42 chips that play the capture from that point.

**Who sees what.** A capture on a mission you haven't started yet is visible only to you. Once the mission starts, every seat on it can play it, from the mission's **Evidence** tab. Each seat reads NoX's explanation in its own words: the business and product seats never see code locations, file paths or services. If NoX Shield finds something that shouldn't be shared, the capture is withheld: only you can see it, and NoX won't use it.

You can also attach a capture in **Ask NoX** with the paperclip ("make this screen match the recording"), or choose **Show NoX a capture** from the image button in the editor to insert a ▶ chip into your file.

With NoX Local (Gemma), only screenshots and images are available. Video and voice need NoX in the cloud.

## NoX drafts the files above you

NoX drafts your own file, and every file upstream of your seat, grounded in your request and the knowledge base:

| Started by | NoX drafts | You then write | Left for later |
| --- | --- | --- | --- |
| Business user | Business requirement | Business requirement | Product, Engineering, Developer |
| Product owner | Business requirement, Product spec | Product spec | Engineering, Developer |
| Engineering lead | Business, Product, Engineering design | Engineering design | Developer |
| Developer | All four | Build spec | — |

The drafts are written by NoX's co-writer, an ADK agent on Gemini. It looks up the knowledge base, the contract map, the source code and any linked Jira ticket before writing. Files appear with a **NoX is drafting…** status, then as **AI-drafted · unapproved**.

### The proceed prompt

If you started below the business seat, nobody in the seats above you has approved their drafts yet. Before going further, NoX asks:

> **No one has approved the business requirement and product spec yet.** NoX drafted them from your prompt and the knowledge base. Do you want to proceed anyway?

- **Review drafts first** opens the business requirement so you can read what NoX inferred.
- **Proceed** continues at your seat. The upstream files stay marked **AI-drafted · unapproved**, and those seats see a confirmation item in their queue. Confirming is optional and never blocks you.

## The four spec files

Each file has a fixed shape, so every reader knows where to look.

| File | Seat | Sections |
| --- | --- | --- |
| `01-business.md` · Business requirement | Business user | The request (quoted verbatim, never reworded) · Problem · Who is affected · What should change · What "done" looks like · Examples |
| `02-product.md` · Product spec | Product owner | Goal · User stories · Acceptance criteria (AC-1, AC-2… in Given/When/Then) · Edge cases (those found in the knowledge base marked *from the map*) · Out of scope · Success metric · Priority |
| `03-engineering.md` · Engineering design | Engineering lead | Applications changing · Approach · Contracts affected (owner, consumers, unchanged/additive/breaking) · Must not break · Architecture, guardrails and standards · Test strategy · Rollout and rollback · Risks |
| `04-developer.md` · Build spec | Developer | Files and services touched · What to reuse · Tasks · Test plan · Rollout |

Every file ends with a `## Verification checklist`: the things its author will check before signing off at the end. See [Build and verify](/docs/build-and-verify).

NoX cites what it relies on: `[[kb:app/page]]` for a knowledge-base page, an upstream file, `path:line` for source code, or a Jira field. Anything it can't confirm becomes an **open question** in the file instead of a guess.

## Tabs and locking

The mission page shows the four files as tabs across the top, with the mission's stage on an orbit arc. Your own seat's tab is editable. Every other tab is **locked**: you can read all of it, but you can't change it. A locked tab shows its author, when it was approved, and whether it is still an unapproved AI draft.

Because only one person ever edits a file, there are no merge conflicts. If a file changes while you have it open, saving tells you so and asks you to reload rather than overwriting.

## Writing with NoX

The Markdown editor includes toolbar controls for headings, formatting, lists, checklists, tables, code blocks, links and images. **⌘S** saves. Images upload up to 8 MB (PNG, JPEG, GIF, WebP or SVG), are inserted as Markdown, and are committed to the knowledge-base repository beside the file.

NoX works in your file in three ways:

**After you save, NoX refines.** Save (or choose **Ask NoX to refine** when there's nothing new to save), and a labelled NoX cursor appears in the same file. It tightens the wording, fills gaps (a missing edge case, an unlisted consumer of a contract, a test that nothing covers) and adds detail from the knowledge base. Each lookup it makes shows as a step, and each section edit animates into the file as it lands. NoX's additions are tinted so you can see exactly what it wrote.

**Ask in the corner chat.** Open **Ask NoX** in the bottom-right corner and say what you want:

- "Add a rollback section."
- "Rewrite the acceptance criteria as Given / When / Then."
- "Which services consume `auth.login`?"

NoX either edits the file while you watch, or, if you only asked a question, answers without touching it. The chat history is kept per file.

**Undo is one click.** Each of NoX's turns is saved as a single new version, so **Undo NoX's edit** puts the file back exactly as it was before that turn.

NoX's editing rules keep you in charge:

- It edits one `##` section at a time and never touches sections it doesn't need to change.
- It can't remove or rename a heading you wrote.
- It never approves anything. Approval is always a person's decision.

## Approving and handing off

When your file says what you mean, choose **Approve**. NoX then:

1. Freezes that version and records who approved it and when.
2. Moves the mission to the next seat and starts a NoX first draft there if that file is still empty, so the next person starts from a draft rather than a blank page.
3. Commits the approved file to the default branch of the primary application's knowledge-base repository.
4. Comments on the linked Jira ticket and moves it to the mapped status.

Seats whose files are already approved are skipped, so the mission always lands with the next person who has work to do.

## Changing a file after approval

Editing an approved file is allowed, and NoX keeps the consequences visible:

- Your file goes back to **Draft**, and the mission waits on your seat again.
- Every file below yours that was already approved becomes **Stale — upstream changed**, because it was approved against the old wording. Their authors see it in their tabs and re-approve after checking.
- NoX never edits another person's file on its own.

## Sending a mission back

Any seat can send a mission back to an earlier seat when something upstream isn't right. Choose **Send back**, pick the seat, and write the reason (a short note is required). The mission moves to that seat, that file reopens as a draft, the reason is recorded on the timeline, and the Jira ticket gets a comment with the reason.

During verification, **Not met** does the same from inside a checklist. See [Build and verify](/docs/build-and-verify).

## Priority and title

The product owner sets the mission's priority (**P1** to **P4**) from the header. The title starts as the request and can be edited by the product owner or the mission's creator.

## Jira and pull requests

The **Jira & pull requests** panel on the right connects the mission to the tools teams already use.

- **Link existing**: search by key (`APEX-42`) or by words from the summary, and link the ticket. Its summary, description, status and comments become part of the context NoX drafts from.
- **Create ticket**: create an issue in the team's Jira project, with a summary and description built from the spec files, the label `nox`, and a link back to the mission.
- **Sub-tasks from build spec**: the developer can turn the build spec's numbered **Tasks** into Jira sub-tasks under the primary ticket in one click.
- **Unlink** removes a ticket from the mission.

Once a ticket is linked, it stays in step in both directions:

| NoX stage | Jira status |
| --- | --- |
| Business, Product, Engineering | To Do |
| Developer, Build | In Progress |
| Verifying | In Review |
| Done | Done |

NoX comments on every approval, send-back and verification. Status, assignee and comment changes made in Jira appear on the mission's timeline. The status map can be changed per deployment.

Pull requests appear in the same panel as soon as their branch, title or body names the mission key. Each one shows its guard result: **clear against N rules**, or the number of possible conflicts with the application's architecture decisions.

## Ticket assignment and pipeline

The **Ticket** panel in the right rail shows who the mission is assigned to and the pipeline it walks: the four seats, the build, then each seat's verification in reverse. The current step is marked **now**. A send-back moves it back, and every move is kept with who made it and when.

Anyone who can see the mission can assign it. Choose **Assign** (or **Reassign**) and pick a person. The list shows everyone who can see the mission. Assigning never locks anything: each seat still edits only its own file. The change appears on the timeline.

## The timeline

The **Timeline** in the right rail records everything that happened, newest first: drafts, saves, NoX's edits, approvals, send-backs, chat messages, Jira updates, PRs, guard results, Git syncs, assignments and verification progress. It scrolls within a fixed height. Every event also streams live to anyone who has the mission open.

## The flight recorder

Above the timeline, the **Flight recorder** strip shows how long the mission has spent in each stage so far. It is read from the mission's own events, and the current stage keeps counting.

The **Impact** page, in the menu for every seat, adds these up across an organization: median time from the first sentence to verified, time per stage, the send-back rate and where work comes back, how much of what NoX drafted cites a source, and an estimate of the AI cost per mission. Pick 7, 30 or 90 days.

## Where the files are saved

Every file is stored twice, on every save and every approval:

1. **In the database** (`spec_files` and `spec_file_versions`), so the UI loads instantly and every version is kept.
2. **In Git**, in the primary application's knowledge-base repository:

```text
kb-mini-auth-service/
  missions/
    NOX-1-block-brute-force-logins/
      01-business.md
      02-product.md
      03-engineering.md
      04-developer.md
      assets/
```

Saves go to the branch `nox/NOX-1`. Approving a file also writes it to the default branch. Other applications the mission touches get a short pointer file, `missions/NOX-1.md`. The database is authoritative, so a Git outage never blocks a save: the failure is logged, and the next save or approval writes the file to Git again.
