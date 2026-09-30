# CP15: Show NoX (screenshots, screen recordings, video and voice)

**In one sentence:** anyone on a mission can show NoX the problem instead of typing it. They can take a screenshot, record their screen, upload a video or leave a voice note. NoX watches it, works out which applications, pages and code it concerns from the knowledge base, and helps draft the requirement with every claim cited back to a moment in the recording.

This is the feature definition and the build plan. It's written in depth because it will be the headline beat of the demo video.

---

## 1. Why this matters

- **Business users struggle to describe software problems in words.** "The settlement screen shows the wrong status after a partial fill" takes three messages to pin down. A 30-second screen recording contains the answer. Today the business user's first sentence is the only input NoX gets (`routers/missions.py` `MissionCreate.prompt`).
- **Recordings alone don't help much.** They're usually attached to a ticket and ignored. What only NoX can do is *connect the recording to the knowledge base*. It reads the error text on screen, finds that exact string in the application's source snapshot (`grep_source`), links the page that explains the behaviour (`search_kb`), and names the contracts involved (`find_interfaces`). The recording becomes grounded evidence, not an attachment.
- **Contest fit:**
  - It's native Gemini multimodal (video, audio, images in one call) plus agentic grounding. That counts toward technical merit (40%) and innovation (25%).
  - "Show, don't type" counts toward user experience (10%).
  - It matches the theme's "knowledge accessibility, collaboration, decision-making".

---

## 2. Who uses it, and for what

| Seat | Typical capture | What NoX does with it |
| --- | --- | --- |
| Business user | A screen recording of the problem, narrated; or a screenshot with the problem circled | Proposes the one-sentence request and the applications. Drafts the business requirement in plain words, citing moments ("at 0:42 the status stays *Pending*"). |
| Product owner | A recording of an edge case, or a competitor's flow | Adds acceptance criteria and edge cases grounded in what was shown and what the KB says the system does today. |
| Engineering lead | A photo of a whiteboard design, or a sequence diagram screenshot | Reads the diagram, maps the boxes to applications and contracts in the contract map, and drafts or updates the design sections. |
| Developer | A screenshot of a stack trace, or a terminal recording of a failing test | Finds the files and lines (`grep_source`), and adds tasks and a test plan to the build spec. |
| Any seat, during reverse verification | A recording of "it works now" | Compares it with the original recording and pre-writes a hint next to each checklist item. **People still tick every item.** |

---

## 3. User experience

### 3.1 Where the capture lives

1. **New mission** (`apps/web/app/(product)/app/missions/new/page.tsx`). Under the request textarea there's a **Show NoX** bar with four actions: **Record screen**, **Take screenshot**, **Voice note** and **Upload** (image or video). Drag-and-drop and paste (Cmd/Ctrl+V of an image) work anywhere on the page.
2. **Spec file chat** (`ChatDock` in `components/app/spec-editor.tsx`). A paperclip on the chat input opens the same four actions. The message goes to the co-writer with the media attached.
3. **Spec editor toolbar.** The existing image button (`uploadImage`, which posts to `/api/v1/missions/{key}/assets`) becomes the same menu. Plain images keep inserting `![alt](url)` into the file exactly as today.
4. **Evidence tab on the mission page** (`missions/[key]/page.tsx`). Every capture on the mission, in time order. It's also where you add captures without chatting.
5. **Verify panel** (`components/app/verify-panel.tsx`): a **Show it works** action (section 4.6).

### 3.2 Recording the screen

1. The user clicks **Record screen**. A short sheet explains: "NoX will see what you share. Close anything private first." It has two toggles: **Include my voice** (on by default) and **Include tab audio** (off).
2. The browser's own share picker opens (`navigator.mediaDevices.getDisplayMedia`). The user picks a tab, window or screen. If the voice toggle is on, the mic is captured with `getUserMedia({audio:true})` and mixed in using a Web Audio `MediaStreamAudioDestinationNode`.
3. A 3-2-1 countdown, then recording starts. A floating pill shows a red dot, the elapsed time out of 3:00, **Pause**, **Stop** and **Discard**. The browser's own "sharing" indicator stays visible. If the user stops sharing from the browser bar, recording stops too.
4. On stop there's a preview with a player, **Retake** or **Use this**. An optional one-line caption field: "What should NoX look at?"
5. The upload starts right away with a progress bar, then the card switches to "NoX is watching…" with live steps (section 5.4).

**Technical details:**
- Use `MediaRecorder` with the first supported type from `video/webm;codecs=vp9,opus`, `video/webm;codecs=vp8,opus` and `video/mp4` (Safari).
- Request 1 s timeslices so a long recording never sits in one blob.
- Cap at 3 minutes and about 1280p. Ask `getDisplayMedia` for `frameRate: 15`, which is plenty for UI and keeps files small.

### 3.3 Screenshots, annotations, voice and uploads

- **Take screenshot:** the same share picker, but NoX grabs one frame (`ImageCapture` or drawing the video track to a canvas) and stops sharing right away.
- **Annotate:** every screenshot or uploaded image opens a small markup layer before it's used.
  - Tools: **Box**, **Arrow**, **Pen**, **Text** and **Undo**, drawn in the acting seat's `--role` colour.
  - NoX receives both the marked-up image and the original, and the prompt says "the author marked the area of interest in colour".
  - Built on a plain `<canvas>` with pointer events, so it works with touch.
- **Voice note:** mic only, up to 5 minutes, shown as a waveform while recording.
- **Upload:** images (PNG, JPEG, WebP, HEIC → converted to JPEG in the browser where supported, GIF), video (MP4, WebM, MOV) and audio (M4A, MP3, WebM, WAV).

### 3.4 Phones and accessibility

- Phones can't capture the screen in the browser (`getDisplayMedia` is missing on iOS and Android). Feature-detect it and hide **Record screen** and **Take screenshot** there. **Upload** opens the camera and gallery (`accept="image/*,video/*"`), so a phone user can film the screen or pick a screen recording they made with the OS.
- Every control is a real button with a label. The recording pill is keyboard reachable, and Esc stops the recording (with a confirmation).
- Players show captions generated from NoX's transcript (WebVTT, section 5.5).
- No horizontal page scroll at 375 px. The capture bar wraps to two rows.

### 3.5 What the user sees when NoX is done

A **capture card**:
- a thumbnail or player, with its duration
- NoX's one-paragraph summary, in the seat's vocabulary
- **Key moments**: timestamps you can click to seek the player, e.g. "0:12 Opens trade T-4471", "0:42 Status stays *Pending* after partial fill"
- **What NoX found in the knowledge base**: 1–5 items. Each has a citation (`[[kb:trade-settlement-system/concepts/settlement-lifecycle]]`) and one plain sentence on why it's relevant.
- For Engineering lead and Developer only: **Code locations**, `path:line` hits from the source snapshot, and **Contracts touched**.
- **Open questions** NoX couldn't settle, e.g. "Is T-4471 a partial fill on the buy side or the sell side?"

On the new-mission page, the card also carries two proposals, both editable and never auto-applied:
- **Suggested request:** a one-sentence request in the user's words. The user can accept it into the textarea, edit it, or ignore it. The sentence stays theirs (principle 1).
- **Suggested applications:** pre-ticks applications in the existing app picker, ranked by the grounding, replacing the vocabulary-only `suggest-apps` ranking when a capture exists. The user confirms.

---

## 4. Behaviour in each flow

### 4.1 Starting a mission from a capture

1. The user records before a mission exists. The media is uploaded as a **draft capture** owned by the user and scoped to their visible orgs (`mission_id = null`).
2. Analysis runs (section 5). The page receives the suggested request and applications over SSE.
3. The user confirms the sentence and apps, then clicks **Launch mission**. `POST /api/v1/missions` now accepts `mediaIds: [uuid]`, and they're linked to the mission.
4. Shield screening (CP14 Part B) covers the transcript and on-screen text. A capture withheld by Shield can't be attached; the user sees why in plain words.
5. `draft_mission_files` (`missions/drafting.py`) includes the capture evidence in the drafting context (section 5.6). The business requirement cites moments as `[[media:<id>#t=42]]`.
6. The captures show on the mission's Evidence tab and are recorded in the timeline (`media.attached`).

### 4.2 Attaching a capture in the spec chat

1. The user attaches a capture and types "This is what I mean about the retry". The chat message stores `media_ids`.
2. The co-writer turn (`ai/agents/cowriter.py` `edit_turn`) starts after analysis is ready. If analysis is still running, the turn waits on it (up to 90 s) and the chat shows "NoX is watching your recording…".
3. The co-writer edits sections with the evidence available, citing moments. Everything else about the edit turn stays the same: section tools, `ask_author`, one version per turn, and **Revert**.

### 4.3 Adding to the Evidence tab without chatting

The capture is analysed and shown. Nothing is edited. The capture is available as context for every later draft, refine and chat on any file of that mission.

### 4.4 Reading the evidence from another seat

Every seat can see every capture on a mission they can open. The **summary, key moments and KB findings** are rewritten per seat at display time from the same stored analysis:
- The business user never sees `path:line` (principle 8).
- The Developer sees code locations first.

This is a cheap FAST-tier call that is cached per (capture, seat). It is not a re-analysis.

### 4.5 Captures in Git

- Images are committed as today (`missions/gitsync.py` `commit_asset`).
- Video and audio are **not** committed, because of their size. Git gets a text sidecar `missions/NOX-n-<slug>/evidence/<id>.md`: the summary, transcript, key moments, KB citations and a link to the capture in NoX.
- The database stays authoritative (principle 5), and the Git sync stays best-effort.

### 4.6 Show it works (reverse verification)

1. In the verify panel, any seat can record "after" evidence.
2. NoX compares it with the mission's original capture(s) and the file's checklist, using one call with both videos as parts and the checklist items.
3. The result is a hint under each checklist item, such as "Seen at 0:18: status turns *Settled* after the partial fill" or "Not shown in the recording".
4. **NoX never ticks an item.** The person ticks. This is the roadmap item "Evidence beside the checklist", shipped with real evidence.

---

## 5. How it works

### 5.1 Data model (Alembic `0008`, after CP14's `0007_shield_findings`)

`media_assets`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `org_id` | uuid | Required. Draft captures take the org of the user's first visible org and are re-homed to the mission's org when attached. |
| `mission_id` | uuid null | |
| `spec_role` | enum null | The file it was attached to, if any |
| `chat_message_id` | uuid null | |
| `uploaded_by` | uuid | |
| `kind` | enum | `image`, `screenshot`, `screen_recording`, `video`, `audio` |
| `mime`, `bytes`, `duration_s`, `width`, `height` | | |
| `storage_uri` | text | `gs://…` in production, a local path in dev |
| `annotated_of` | uuid null | The original image, for marked-up copies |
| `caption` | text null | The user's "what should NoX look at?" |
| `status` | enum | `uploading`, `analyzing`, `ready`, `failed`, `withheld`, `deleted` |
| `observation` | jsonb | `MediaObservation` (section 5.3) |
| `grounding` | jsonb | `MediaGrounding` (section 5.3) |
| `usage` | jsonb | Tokens and time from `telemetry.usage_scope` |
| `created_at`, `analyzed_at` | | |

`spec_chat_messages` gains `media_ids uuid[]`. `missions` needs no change: links are through `media_assets.mission_id`.

### 5.2 Upload path

Cloud Run caps request bodies at 32 MiB, so video goes **straight to Cloud Storage**:

1. `POST /api/v1/media` with `{kind, mime, bytes, missionKey?, role?, caption?}`:
   - Validates type and size.
   - Creates a row with `status=uploading`.
   - Returns `{id, uploadUrl, method: "PUT", headers}`: a V4 signed URL for `gs://<bucket>/media/<org>/<id>.<ext>` with a 15-minute expiry and the content type locked. `services/gcs_storage.py` already has `generate_gcs_presigned_url`; extend it to take the object path and content type.
   - Local dev (`STORAGE_BACKEND=local`) returns an API URL instead: `PUT /api/v1/media/{id}/content`, stored under the existing local assets dir.
2. The browser PUTs the file with upload progress (`XMLHttpRequest.upload.onprogress`).
3. `POST /api/v1/media/{id}/complete` checks that the object exists with the declared size and type, sets `status=analyzing`, and queues `analyze_media(id)` as a job (principle 6). It returns 202.
4. `GET /api/v1/media/{id}` returns the metadata and analysis for the acting seat.
5. `GET /api/v1/media/{id}/content` streams the file after an auth check (or redirects to a 5-minute signed GET URL). Video and audio never use the "unguessable URL" pattern of `/missions/assets/{name}`, because recordings can show private screens.
6. `DELETE /api/v1/media/{id}` is allowed for the uploader or the mission's current file owner. It sets `status=deleted`, deletes the object, and removes the Git sidecar on the next sync. Recorded in the timeline.

**Limits** (settings, in `.env.example`):

| Kind | Max size | Max length |
| --- | --- | --- |
| Screen recording, video | 200 MB | 3 min recorded in NoX; 5 min uploaded |
| Audio | 50 MB | 10 min |
| Image | 10 MB | |

At most 12 captures per mission.

**Auth:** all routes use `current_actor`. Mission-bound routes use `load_mission` for the org scope, and draft captures are visible only to their uploader. Add a test for each forbidden case.

### 5.3 The analysis pipeline: `apps/api/nox_api/missions/media.py`

One job per capture, wrapped in `telemetry.usage_scope(f"media:{kind}")`. It has three stages, each broadcasting a step.

**Stage 1: Perceive** (one Gemini call, DEFAULT tier, `structured.ask`)
- **Input parts:**
  - The capture as a file part. On the `enterprise` backend, `types.Part.from_uri(file_uri="gs://…", mime_type=…)`, which reads from Cloud Storage with no bytes through the API. On the `api_key` backend, upload with the Gemini Files API first and use the returned URI. Images under 7 MB can be inline bytes.
  - The original image too, when it's an annotated one.
  - The user's caption, the acting seat, and the mission request if one exists.
- **Video settings:**
  - `media_resolution` LOW for anything over 60 s, MEDIUM otherwise.
  - 1 fps by default.
  - When the user trimmed the clip in the preview, pass `video_metadata` start and end offsets.
- **Output schema `MediaObservation`** (add to `ai/schemas.py`):
  ```text
  summary: str                         plain, 2–4 sentences
  kind_of_request: "bug" | "change" | "question" | "idea"
  transcript: [{t: float, speaker: str?, text: str}]            speech, with timestamps
  moments: [{t: float, what: str, screen_text: [str], is_problem: bool}]
  screens: [{t: float, title: str?, url_or_route: str?, visible_text: [str]}]   OCR of what matters
  identifiers: [str]      exact strings that may exist in code or docs: error messages, codes, labels, field
                          names, routes, event names, ticket keys
  expected: str?          what the author expected (bugs)
  actual: str?            what happened instead
  steps: [str]            repro steps, as seen
  marked_area: str?       what the annotation points at (images)
  sensitive: [str]        kinds of personal data visible on screen, if any (no values)
  ```
- **Instruction rules:**
  - Describe only what is seen or heard.
  - Copy on-screen text exactly.
  - Timestamps in seconds.
  - No guesses about code.

**Stage 2: Shield** (CP14 Part B)
- `shield.screen_source` over the transcript, the `screen_text` and `visible_text` values, and the caption.
- On a block in `enforce` mode: `status=withheld`, and a finding is recorded. The capture is visible to its uploader with the reason, and never used in a prompt.
- Sensitive Data Protection redacts personal data values in the transcript and screen text (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD_NUMBER`, `PERSON_NAME` where confident). Only the redacted text is used in prompts, in Git and in the UI. The video itself is shown as recorded, to people who can open the mission.

**Stage 3: Ground** (an ADK `LlmAgent`, DEFAULT tier, with the knowledge tools, output schema `MediaGrounding`)
- **Scope:** `state = {"apps": <mission apps, or all visible apps for a draft capture>, "home_app": <primary app or "">}`, built by NoX from memberships (principle 3). This is the same pattern as `cowriter.draft`.
- **Tools:** `search_kb` (with `everywhere` for draft captures), `read_kb_page`, `find_interfaces`, `grep_source`, `read_source_file`, `list_pages`.
- **Instruction:**
  - For each identifier and each problem moment, look it up: `grep_source` for exact strings, `search_kb` for behaviour, `find_interfaces` for events and APIs seen.
  - Independent lookups go out together. At most 10 lookups.
  - Say whether the knowledge base explains the behaviour as intended. For example, "ADR-002 says settlement is event-driven, so the status updates only after `nte.trades.matched` is consumed". This is how NoX tells a bug from a misunderstanding, the most useful thing it can say to a business user.
  - Never cite anything a tool didn't return.
- **Output schema `MediaGrounding`:**
  ```text
  apps: [{app: str, confidence: "high"|"medium"|"low", why: str}]
  findings: [{ref: "app/path", says: str, relevance: str, moment_t: float?}]   each ref must be in state["cited"]
  code: [{app: str, location: "path:line", snippet: str, moment_t: float?}]
  contracts: [{app: str, identifier: str, direction: str}]
  explanation: str?        what the KB says about the behaviour seen, if anything
  likely: "bug" | "intended_behaviour" | "missing_feature" | "unclear"
  open_questions: [str]
  suggested_request: str   one sentence, in plain words, for the business seat
  ```
- **Post-check (deterministic):**
  - Drop any `findings.ref` not in the agent's `cited` state.
  - Drop any `code.location` whose file isn't in the app's source snapshot.
  - This is the same "grounded or it doesn't ship" rule Ask follows.

Then: `status=ready`, and broadcast `media.ready`. If the mission exists, `events.record(mission, "media.analyzed", {...})`.

### 5.4 Live progress (SSE)

- Mission captures use the mission channel (`missions/events.py` `broadcast_transient`). Draft captures use a new per-user channel `media:{id}`, which the new-mission page subscribes to through `lib/app/stream.ts`.
- Step labels, in the seat's words:
  - "Watching the recording" (Perceive)
  - "Reading the screen at 0:42"
  - "Checking what NoX Shield allows"
  - "Looking up trade-settlement-system: settlement lifecycle"
  - "Found `SettlementService.java:118`" (Engineering lead and Developer only)
  - "Done"
- Events: `media.uploading`, `media.analyzing`, `media.step`, `media.ready`, `media.failed`, `media.withheld`.

### 5.5 Captions

After Perceive, build a WebVTT track from `transcript` and serve it at `GET /api/v1/media/{id}/captions.vtt`. The player loads it with `<track kind="captions">`.

### 5.6 Using the evidence in drafting and co-writing

- `missions/drafting.py` `build_prompt` gets an optional `evidence: list[MediaEvidence]` argument. It renders a new block after the upstream files:
  ```text
  ===== What the author showed (capture <id>, 1:12 screen recording) =====
  Summary …
  Moments: 0:12 …, 0:42 … (problem)
  Expected / actual …
  What the knowledge base says: … [[kb:…]]
  Code locations (for engineering and build files only): …
  Open questions: …
  Cite moments as [[media:<id>#t=<seconds>]].
  ```
- For the business and product files, the code-location lines are **left out of the prompt entirely**, not just discouraged. This keeps personas honest (principle 8).
- `draft_mission_files` loads the mission's ready captures once and passes them to every file it drafts.
- `cowriter.edit_turn` and `refine_file` get the same evidence block for captures on that mission. A capture attached to the current chat message is marked "attached to this message".
- Media for the model is **text only** (observation plus grounding) in drafting and chat. The video isn't re-sent on every turn, which keeps turns fast and cheap. The one exception is Show it works (section 4.6), which sends the before and after videos together.

### 5.7 The citation form `[[media:<id>#t=42]]`

- `components/app/markdown.tsx` renders it as a chip ("▶ 0:42"). Clicking it opens the Evidence tab and seeks the player.
- `agents/linter.py` and `okf.py` only run on knowledge-base files, not on mission files, so nothing there changes. Mission files are Markdown in `missions/…` and `okf.to_okf` already passes `missions/` paths through untouched.
- In the Git mirror, `[[media:<id>#t=42]]` stays as text, and the evidence sidecar maps the id to the capture's summary and link.

### 5.8 NoX Local (Gemma)

- **Images:** supported, since Gemma 3/4 read images. Perceive runs on `config.local_model()`.
- **Video and audio:** not supported in local mode. The capture bar hides **Record screen**, **Voice note** and video upload when the API reports the local backend (add `aiBackend` to the `/api/v1/me` response; it isn't there today), with the tooltip "Video needs NoX in the cloud".
- **Grounding:** runs as usual on the local model.

### 5.9 Cost and speed guardrails

- A 60 s screen recording at MEDIUM resolution and 1 fps is about 60 frames, plus about 2k audio tokens. That's roughly 20k input tokens for Perceive, plus about 10–30k for Grounding.
- Log both through telemetry, show them in the capture card's footer ("Watched in 14 s · 31k tokens · 42% cached"), and send them to BigQuery `ai_usage` (CP14 Part C).
- Budget: Perceive under 25 s and Grounding under 30 s for a 60 s recording. If either takes longer than 90 s, cancel and mark the capture `failed` with **Retry**.

---

## 6. API summary

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `POST /api/v1/media` | Create a capture and get an upload URL | `current_actor`; `load_mission` if `missionKey` |
| `PUT /api/v1/media/{id}/content` | Dev-only direct upload | uploader |
| `POST /api/v1/media/{id}/complete` | Verify the upload and queue analysis (202) | uploader |
| `GET /api/v1/media/{id}` | Metadata, and the analysis rewritten for the acting seat | mission visibility or uploader |
| `GET /api/v1/media/{id}/content` | Stream or redirect to a signed GET URL | same |
| `GET /api/v1/media/{id}/captions.vtt` | Captions | same |
| `DELETE /api/v1/media/{id}` | Soft delete and remove the object | uploader or the current file owner |
| `GET /api/v1/missions/{key}/media` | The Evidence tab list | mission visibility |
| `POST /api/v1/missions/{key}/files/{role}/verify-evidence` | Show it works comparison (202, SSE result) | the same check as the existing `POST …/files/{role}/verify` |
| `POST /api/v1/missions` | Now also takes `mediaIds` | existing `Cap.CREATE_MISSION` |
| `POST /api/v1/missions/{key}/files/{role}/chat` | Now also takes `mediaIds` | existing |

Record every change with `missions/events.record()`: `media.attached`, `media.analyzed`, `media.withheld`, `media.deleted` and `evidence.compared`. These events feed the timeline, the Firestore ticket pipeline and BigQuery.

---

## 7. Front-end components (`apps/web/components/app/media/`)

| Component | Job |
| --- | --- |
| `use-screen-recorder.ts` | A hook for `getDisplayMedia` + mic mixing + `MediaRecorder`, with the states idle → countdown → recording → paused → stopped, feature detection, and cleanup of every track on unmount |
| `use-voice-recorder.ts` | The mic-only hook, with an analyser node feeding the waveform |
| `capture-bar.tsx` | The four actions, drag and drop, paste, and the local-mode and phone variants |
| `recording-pill.tsx` | The floating timer, pause/stop/discard and the Esc handling |
| `annotator.tsx` | Canvas markup (box, arrow, pen, text, undo); exports the flattened PNG plus the original |
| `upload.ts` | `createMedia` → PUT with progress → `complete` |
| `capture-card.tsx` | Thumbnail or player, status, live steps, summary, key moments, findings, code (seat-gated), questions, suggestions |
| `media-player.tsx` | `<video>`/`<audio>` with the captions track and a `seek(t)` API |
| `evidence-tab.tsx` | The mission's captures, plus the capture bar |
| `media-chip.tsx` | The `[[media:id#t=…]]` renderer used by `markdown.tsx` |

**Other rules:**
- Use `api()` / `useApi` for JSON. Uploads use `authHeaders()`, as `uploadImage` does.
- Colours come from tokens and `--role`.
- The existing `Panel`, `EmptyState` and `FEED_LIST` are used for the Evidence tab.

---

## 8. Demo material

- The demo codebases have no user interface. Add `demo/screens/trade-desk.html`, a static mock "Apex trade desk" screen:
  - It shows a trade blotter where a partially filled trade stays *Pending settlement*.
  - Its labels and error text are copied from real strings in `demo/codebases/trade-settlement-system` and `order-matching-engine`, so `grep_source` finds them.
  - Pick the strings when building it, and list them in the file's header comment.
- Record a 45 s narrated clip of it once as a fallback asset. Record live in the video when possible.
- **Video beat (≈40 s):**
  1. The business user clicks **Record screen**, narrates the problem, and stops.
  2. NoX's live steps appear. The card shows the key moments, "ADR-002: settlement is event-driven…", and the suggested request.
  3. The user accepts it, **Launch mission** runs, and the business requirement is drafted with ▶ 0:42 chips.
  4. Cut to the Developer seat: the same capture shows `SettlementService.java:118`.
- Add three golden captures to an eval set (`scripts/eval_media.py`). For each, check that the expected app is ranked first, at least one expected `ref` is cited, and at least one expected `path` is found. Run with `make eval`.

---

## 9. Tests

**Backend** (`tests/test_media.py`, using `tests/ai_fakes.py` with new `MediaObservation` and `MediaGrounding` fakes):
- Create → upload (local backend) → complete → analyzed. The statuses move in order, and SSE events are broadcast.
- Size and type limits return 413 and 415.
- Forbidden cases:
  - another org's user can't read, stream or delete a capture
  - a draft capture is visible only to its uploader
  - Business can't call verify-evidence on the Developer's file
- The grounding scope: a draft capture for a user in org A can't cite or grep an org B app, even if the fake model asks for it.
- The post-check drops refs the agent didn't read and code locations not in the snapshot.
- Shield `enforce` → `withheld`, and the capture is never included in a drafting prompt.
- `build_prompt` with evidence:
  - The business and product prompts contain moments and KB refs but **no** code locations.
  - The engineering and developer prompts contain them.
- `create_mission` with `mediaIds` attaches the captures and moves them to the mission's org. Someone else's draft capture id → 404.
- Local backend: video kinds are rejected with a clear message, and images work.

**Web:**
- `make typecheck`.
- A browser check in the preview:
  - Chrome: record screen, pause, stop, retake.
  - Upload and paste.
  - The annotator.
  - The Evidence tab and seek-by-chip.
  - Phone width (375 px): capture bar variant, no horizontal scroll.
- Safari: an upload and screenshot smoke test.

---

## 10. Build order and estimate (about 5 days)

| Phase | Scope | Days |
| --- | --- | --- |
| P1 Backend core | Migration, the media routes, signed upload, the Perceive stage with schema, SSE steps, tests | 1 |
| P2 Grounding and drafting | The Ground agent, post-check, Shield hook, `build_prompt` evidence, create-mission `mediaIds`, per-seat rewrite, tests | 1 |
| P3 Capture UI | Recorder hooks, capture bar, pill, upload with progress, capture card, new-mission integration with suggestions | 1½ |
| P4 Mission integration | Chat attach, Evidence tab, player with captions, media chips, the Git sidecar | 1 |
| P5 Show it works, eval, demo | The verify comparison, `demo/screens/trade-desk.html`, the eval set, docs | ½ |

**Cut line if time runs short:** keep P1 to P3 plus the Evidence tab. Show it works and the annotator become fast follows. Recording, grounding and drafting from a capture are the demo.

## 11. Docs

- `apps/web/content/docs/04-missions.md`: a **Show NoX** section covering capturing, what NoX does, and who sees what.
- `apps/web/content/docs/05-build-and-verify.md`: Show it works.
- `apps/web/content/docs/07-google-ai.md`: Gemini multimodal (video, audio, images, `Part.from_uri`, media resolution) and the grounding agent.
- `docs/DEMO_SCRIPT.md`: the beat above.

## 12. Done when

- [ ] On the deployed app, a business user records the demo trade-desk clip, gets a suggested request and apps grounded in the right knowledge base, launches a mission, and gets a business requirement with ▶ moment citations and no code in it.
- [ ] The Developer seat sees the same capture with the right `path:line`.
- [ ] Attaching a capture in the spec chat produces a grounded edit, and it can be reverted.
- [ ] Draft captures, org scope and Shield withholding are covered by tests. `make test` and `make lint` pass.
- [ ] It works at phone width, and screen capture is hidden where the browser can't do it.
- [ ] The docs chapters tell the truth.

## Resume notes

_Not started. Depends on CP14 Part B (Shield) for Stage 2. If CP14 isn't done first, stub `shield.screen_source` to return `screened: false`._

---

## Resume notes

**Status (2026-09-29): code done on branch `claude/project-thread-muni6k`; the live check on the deployed app is left.**

- Migration is `0008_media_assets` (`media_assets` table, `spec_chat_messages.media_ids`), after CP14's `0007_shield_findings`.
- Shield is CP14's real one: `screen_source` screens a capture's transcript and on-screen text with Model Armor and a block becomes `withheld`. `redact()` (kept from CP15's stub) masks emails, card numbers and phone numbers with regexes in every mode.
- Backend: `routers/media.py` (upload, complete, read per seat, captions, stream, delete, verify-evidence), `missions/media.py` (Perceive → Shield → Ground → seat views, evidence for drafting and chat, Git sidecar, Show it works comparison), `services/media_storage.py` (GCS signed PUT/GET, or local files with an HMAC token). Tests: `tests/test_media.py`.
- Web: `components/app/media/` (capture bar, recorder hooks, annotator, player, capture card, chips, Evidence tab), wired into New mission, the mission page, the spec editor chat and the verify panel.
- Demo: `demo/screens/trade-desk.html`; golden captures go in `demo/screens/captures/` (ignored by Git) for `scripts/eval_media.py`, which `make eval` runs and which skips missing files.
- Still to do, needing the deployed app: record the trade-desk clip and the two other golden captures, run `make eval`, check the Done-when items on Cloud Run (bucket CORS must allow PUT from the web origin), and a Safari smoke test.

