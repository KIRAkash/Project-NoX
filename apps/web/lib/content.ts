/**
 * Every string the landing page renders lives here, so the components stay
 * about layout and motion and the copy can be reviewed in one sitting.
 */

export type AppNode = {
  id: string;
  name: string;
  kind: string;
  /** Orbital elements, resolved into 3D world space every frame by the hero. */
  orbit: {
    /** Orbit radius in world units. */
    a: number;
    /** Seconds per revolution. */
    period: number;
    /** Starting angle in radians. */
    phase: number;
    /** Orbital plane tilt in radians, so the orbits are not coplanar. */
    incl: number;
    /** Body radius in world units, before perspective scaling. */
    size: number;
  };
  tier: "core" | "service" | "edge";
  /** This application's identity colour in the orbital diagram — the "constellation" set. */
  hue: string;
  summary: string;
  freshness: string;
  owns: string[];
  depends: string[];
  breaks: string[];
  contracts: { kind: string; left: string; right: string }[];
  guardrail: string;
};

/**
 * The three orbital shells. Inner shells are faster, the way real ones are —
 * it reads as a system rather than a turntable.
 */
export const SHELLS = [
  { a: 135.7, period: 44, incl: 0.0 },
  { a: 218.5, period: 76, incl: 0.11 },
  { a: 301.3, period: 118, incl: -0.075 },
];

export const APPS: AppNode[] = [
  {
    id: "ledger",
    name: "Ledger Core",
    kind: "Book of record",
    orbit: { a: 135.7, period: 44, phase: 0.35, incl: 0.0, size: 18.2 },
    hue: "#E8C97A",
    tier: "core",
    summary:
      "Double-entry ledger behind every movement of money. Every other application eventually resolves here, which is why it is the first thing NoX maps in a financial estate.",
    freshness: "Synced 4 min ago",
    owns: ["Settlement state machine", "Idempotency key issuance", "Reversal and correction entries"],
    depends: ["Identity — actor scopes", "Vault — key material"],
    breaks: ["Payments API", "Refunds Service", "Reporting"],
    contracts: [
      { kind: "http", left: "POST /internal/entries", right: "refunds · payments" },
      { kind: "event", left: "entry.settled", right: "reporting · notifications" },
    ],
    guardrail:
      "ADR-014: no service outside the ledger boundary writes entries directly. NoX evaluates every incoming diff against this and comments on the pull request before a human reviews it.",
  },
  {
    id: "refunds",
    name: "Refunds Service",
    kind: "Domain service",
    orbit: { a: 218.5, period: 76, phase: 2.05, incl: 0.11, size: 14 },
    hue: "#86B9EE",
    tier: "service",
    summary:
      "Owns the refund lifecycle from request to settled, including partial refunds and the retry path behind the original three-day delay.",
    freshness: "Synced 11 min ago",
    owns: ["Refund request lifecycle", "Partial refund splitting", "Retry and backoff schedule"],
    depends: ["Ledger Core — entries", "Payments API — intent lookup", "Identity — actor scopes"],
    breaks: ["Customer Portal", "Notifications"],
    contracts: [
      { kind: "http", left: "POST /v1/refunds", right: "ledger-core:/internal/entries" },
      { kind: "event", left: "refund.completed", right: "notifications:refund-mail" },
    ],
    guardrail:
      "NoX flags any change to the refund event payload as breaking for Notifications, which parses two fields this service has no test for.",
  },
  {
    id: "payments",
    name: "Payments API",
    kind: "Public edge",
    orbit: { a: 218.5, period: 76, phase: 4.35, incl: 0.11, size: 14.8 },
    hue: "#EC8FC2",
    tier: "service",
    summary:
      "The public surface partners integrate against. Its contracts are the ones that cannot quietly change, so NoX treats its OpenAPI schema as a hard invariant.",
    freshness: "Synced 2 min ago",
    owns: ["Payment intent lifecycle", "Partner authentication", "Public OpenAPI schema"],
    depends: ["Ledger Core — entries", "Risk Engine — decisioning", "Identity — tokens"],
    breaks: ["Customer Portal", "Refunds Service", "Partner integrations"],
    contracts: [
      { kind: "http", left: "POST /v1/payment_intents", right: "risk-engine:/score" },
      { kind: "event", left: "intent.authorised", right: "ledger-core · reporting" },
    ],
    guardrail:
      "A schema field removal here is refused at the gate, not at review. NoX requires a deprecation window recorded in the spec before the diff can merge.",
  },
  {
    id: "identity",
    name: "Identity",
    kind: "Platform",
    orbit: { a: 135.7, period: 44, phase: 3.6, incl: 0.0, size: 16.8 },
    hue: "#A897F0",
    tier: "core",
    summary:
      "Issues the tokens and scopes every other application trusts. Nothing changes here without a blast-radius report, because everything downstream reads its claims.",
    freshness: "Synced 27 min ago",
    owns: ["Token issuance and rotation", "Scope definitions", "Service-to-service trust"],
    depends: ["Vault — signing keys"],
    breaks: ["Every application in the estate"],
    contracts: [
      { kind: "http", left: "POST /oauth/token", right: "all services" },
      { kind: "event", left: "scope.revoked", right: "portal · payments · refunds" },
    ],
    guardrail:
      "NoX blocks scope renames outright. A scope name is a string parsed in eleven places, only four of which have a test.",
  },
  {
    id: "risk",
    name: "Risk Engine",
    kind: "Decisioning",
    orbit: { a: 218.5, period: 76, phase: 0.2, incl: 0.11, size: 12.9 },
    hue: "#E9713C",
    tier: "service",
    summary:
      "Scores every payment intent before it is authorised. Its rules change weekly, which makes it the application most likely to drift away from whatever the wiki last said about it.",
    freshness: "Synced 8 min ago",
    owns: ["Scoring rules", "Merchant risk profiles", "Manual review queue"],
    depends: ["Payments API — intents", "Identity — actor claims"],
    breaks: ["Payments API"],
    contracts: [
      { kind: "http", left: "POST /score", right: "payments:/v1/payment_intents" },
      { kind: "event", left: "review.required", right: "notifications · portal" },
    ],
    guardrail:
      "NoX re-verifies every rule claim on each push. Anchored line ranges that move invalidate the claim rather than letting the page go quietly stale.",
  },
  {
    id: "portal",
    name: "Customer Portal",
    kind: "Front end",
    orbit: { a: 301.3, period: 118, phase: 1.15, incl: -0.075, size: 12 },
    hue: "#5FCBD8",
    tier: "edge",
    summary:
      "Where the customer encounters the three-day wait. NoX maps its components back to the endpoints they call, so a UI complaint resolves to a service without guesswork.",
    freshness: "Synced 6 min ago",
    owns: ["Refund request flow", "Transaction history view", "Status messaging copy"],
    depends: ["Payments API", "Refunds Service", "Identity"],
    breaks: ["Nothing downstream"],
    contracts: [
      { kind: "http", left: "RefundPanel.tsx", right: "refunds:/v1/refunds" },
      { kind: "http", left: "HistoryTable.tsx", right: "payments:/v1/payment_intents" },
    ],
    guardrail:
      "ADR-009: the portal never queries a datastore directly. NoX raised this twice last quarter on pull requests that added a reporting read.",
  },
  {
    id: "notify",
    name: "Notifications",
    kind: "Fan-out",
    orbit: { a: 301.3, period: 118, phase: 3.5, incl: -0.075, size: 11.2 },
    hue: "#F0877E",
    tier: "edge",
    summary:
      "Consumes domain events and turns them into email and SMS. It is the application most often broken by a change nobody thought concerned it.",
    freshness: "Synced 19 min ago",
    owns: ["Template rendering", "Delivery retries", "Channel preference resolution"],
    depends: ["Refunds Service — events", "Ledger Core — events", "Identity — contact claims"],
    breaks: ["Nothing downstream"],
    contracts: [
      { kind: "event", left: "refund.completed", right: "renders refund-mail template" },
      { kind: "event", left: "entry.settled", right: "renders settlement-receipt" },
    ],
    guardrail:
      "NoX keeps a pinned human correction here: the retry schedule in the wiki was wrong for a quarter. The pin survives every recompilation.",
  },
  {
    id: "reporting",
    name: "Reporting",
    kind: "Analytics",
    orbit: { a: 301.3, period: 118, phase: 5.5, incl: -0.075, size: 11.2 },
    hue: "#5FD29F",
    tier: "edge",
    summary:
      "Reads settlement timestamps to build finance's daily position. Nobody remembers it is downstream of the ledger until a schema change breaks the morning report.",
    freshness: "Synced 33 min ago",
    owns: ["Daily position report", "Settlement reconciliation view"],
    depends: ["Ledger Core — entries", "Payments API — events"],
    breaks: ["Nothing downstream"],
    contracts: [
      { kind: "event", left: "entry.settled", right: "materialises daily_position" },
      { kind: "http", left: "GET /internal/entries", right: "ledger-core:/internal/entries" },
    ],
    guardrail:
      "NoX includes Reporting in the blast radius of any ledger schema change, even when the change author has never heard of this application.",
  },
];

/** Pairs of app ids that hold a contract with one another. */
export const MESH: [string, string][] = [
  ["refunds", "ledger"],
  ["payments", "ledger"],
  ["refunds", "notify"],
  ["payments", "risk"],
  ["portal", "payments"],
  ["identity", "portal"],
  ["reporting", "ledger"],
];

export const HANDOFFS = [
  {
    stage: "Business",
    fidelity: 100,
    line: "“Refunds take three days and customers keep calling us about it.”",
    loss: "Knows the pain exactly. Knows nothing about which systems cause it.",
  },
  {
    stage: "Product",
    fidelity: 74,
    line: "Becomes a one-line Jira epic: “Faster refunds.”",
    loss: "The partial-refund edge case is already gone. Nobody noticed.",
  },
  {
    stage: "Architecture",
    fidelity: 52,
    line: "Spec written from memory of a system that changed two quarters ago.",
    loss: "Misses that Ledger Core owns idempotency, not Payments.",
  },
  {
    stage: "Build",
    fidelity: 32,
    line: "The agent reads one repository and writes a correct change to the wrong service.",
    loss: "No context window is big enough to fix a missing map.",
  },
  {
    stage: "Verify",
    fidelity: 14,
    line: "QA tests the ticket. Nobody tests the sentence.",
    loss: "Shipped, closed, and still three days.",
  },
];

export const COMPILER_RULES = [
  {
    no: "R1",
    title: "Provenance, not copies",
    body: "A claim on a wiki page is a pointer into an immutable source span, never a paraphrase of one. Compiled pages sit in a separate tier from raw sources, so the compiler can never cite itself as evidence.",
    fixes: "Kills epistemic drift at scale",
  },
  {
    no: "R2",
    title: "Claims anchored to lines",
    body: "Anything describing code carries a file path, a line range and a commit. When the anchored lines move, the claim is invalidated at the next push instead of quietly going stale.",
    fixes: "Kills documentation that contradicts the code",
  },
  {
    no: "R3",
    title: "Human pins are permanent",
    body: "A correction a person makes is stored as a structured intention, not as page text. Every regeneration re-verifies it and escalates a contradiction to review rather than overwriting the person.",
    fixes: "Kills silently discarded human edits",
  },
  {
    no: "R4",
    title: "Atomic page reservation",
    body: "Concurrent ingestion reserves page slugs atomically before writing. A second run that finds a claimed slug degrades to an update, so parallel ingests cannot fork the same concept in two directions.",
    fixes: "Kills near-duplicate pages",
  },
  {
    no: "R5",
    title: "Union retrieval",
    body: "Index navigation is always combined with deterministic full-text search over page bodies. A fact buried three sections deep is reachable even when the one-line index summary never mentioned it.",
    fixes: "Kills facts lost below the index",
  },
  {
    no: "R6",
    title: "The model proposes only",
    body: "Inferred relationships are proposals. Contradictions the system can prove — a hash mismatch, a failing test, a broken anchor — are facts. Only facts enter the graph without a person.",
    fixes: "Kills inference treated as ground truth",
  },
];

export type Stage = {
  no: string;
  name: string;
  role: string;
  headline: string;
  body: string;
  input: string;
  output: string;
  gate: string;
  docName: string;
  docMeta: string;
  docTitle: string;
  docLines: { tag: string; text: string }[];
  checks: { label: string; text: string }[];
};

export const STAGES: Stage[] = [
  {
    no: "01",
    name: "Signal",
    role: "Business user",
    headline: "A sentence becomes a grounded brief.",
    body: "The person closest to the problem writes it the way they would say it. NoX does not ask them to learn the system — it finds the system the sentence is about and writes the brief back in their language, with the real behaviour traced.",
    input: "One paragraph, in business language",
    output: "Change brief, reviewed by the author",
    gate: "The author confirms the brief still describes their problem",
    docName: "CR-2291-brief.md",
    docMeta: "Draft · awaiting author",
    docTitle: "Same-day refunds for card payments",
    docLines: [
      { tag: "§1", text: "Requested because customers call support on day two of a refund they cannot see the status of." },
      { tag: "§2", text: "Today a refund is written to the ledger immediately but only settled on the next nightly batch." },
      { tag: "§3", text: "Partial refunds follow a second path that retries for up to 72 hours before surfacing anything." },
      { tag: "§4", text: "Done means: the customer sees a terminal status the same business day, including partial refunds." },
    ],
    checks: [
      { label: "Applications", text: "Four applications touch a refund, not the one the author named: Refunds, Ledger Core, Payments API, Notifications." },
      { label: "Real path", text: "The delay is the nightly settlement batch in Ledger Core, not the refund service the support team blames." },
      { label: "Edge case", text: "A partial-refund retry path exists in code and was not mentioned in the request. Surfaced to the author." },
    ],
  },
  {
    no: "02",
    name: "Definition",
    role: "Product manager",
    headline: "The brief becomes a requirement with edges.",
    body: "The product manager edits and approves rather than writes. NoX drafts stories and acceptance criteria from the brief, and pulls edge cases directly from error paths in code rather than relying on memory.",
    input: "Approved change brief",
    output: "Product requirements, approved by product",
    gate: "Product signs off on scope and acceptance criteria",
    docName: "CR-2291-prd.md",
    docMeta: "v3 · approved",
    docTitle: "Product requirements — same-day refunds",
    docLines: [
      { tag: "S1", text: "As a customer, a full refund reaches a terminal status the same business day it is requested." },
      { tag: "S2", text: "As a customer, a partial refund reaches a terminal status the same business day." },
      { tag: "S3", text: "As a support agent, I can see which stage a pending refund is in without asking engineering." },
      { tag: "AC", text: "Retry exhaustion produces a visible failed status, never an indefinite pending state." },
    ],
    checks: [
      { label: "Not built", text: "No existing flow already does this. A 2023 spec proposed intra-day settlement and was never implemented." },
      { label: "Conflict", text: "Story S3 overlaps an in-flight ticket owned by the Reporting team. Flagged before estimation, not after." },
      { label: "From code", text: "Three failure modes in the retry handler had no acceptance criteria. NoX proposed one for each." },
    ],
  },
  {
    no: "03",
    name: "Design",
    role: "Engineering lead",
    headline: "The requirement becomes a spec with a blast radius.",
    body: "NoX writes the technical specification against the live atlas: which services change, which contracts move, what migrates, in what order, and what has to be reversible. The lead is reviewing an argument, not assembling one.",
    input: "Approved product requirements",
    output: "Technical spec and a sequenced task graph",
    gate: "Architecture review, with violations already listed",
    docName: "CR-2291-spec.md",
    docMeta: "v2 · in review",
    docTitle: "Technical specification — intra-day settlement",
    docLines: [
      { tag: "4.1", text: "Ledger Core gains an intra-day settlement trigger; the nightly batch becomes a reconciliation sweep." },
      { tag: "4.2", text: "Refunds Service calls settle-now on completion. Idempotency key remains issued by Ledger Core." },
      { tag: "4.3", text: "refund.completed gains a settled_at field. Notifications must tolerate its absence for one release." },
      { tag: "4.4", text: "Rollback: feature flag per merchant, nightly batch left running in shadow for two cycles." },
    ],
    checks: [
      { label: "Blast radius", text: "Six applications affected. Reporting reads the settlement timestamp and was not in the original scope." },
      { label: "ADR check", text: "The first draft had Refunds writing entries directly. NoX refused it against ADR-014 and rewrote §4.2." },
      { label: "Sequencing", text: "Notifications must ship its tolerant parser before the event payload changes. Ordering enforced in the task graph." },
    ],
  },
  {
    no: "04",
    name: "Build",
    role: "Engineer and coding agent",
    headline: "The agent starts with the whole map.",
    body: "The engineer hands the work to their coding agent with the brief, the requirements and the spec already in context, plus the nox skill so the agent can walk into applications it was never pointed at. Every diff is checked against the guardrails as it is written.",
    input: "Brief, requirements, spec, and the live atlas",
    output: "Pull requests across every affected repository",
    gate: "Guardrail evaluation on each diff, before review",
    docName: "task-graph.yaml",
    docMeta: "9 tasks · 4 repositories",
    docTitle: "Sequenced across four repositories",
    docLines: [
      { tag: "T1", text: "notifications — tolerate missing settled_at in refund.completed. Ships first, alone." },
      { tag: "T2", text: "ledger-core — intra-day settlement trigger behind merchant flag. Nightly batch kept in shadow." },
      { tag: "T4", text: "refunds — call settle-now on completion, including the partial-refund retry path." },
      { tag: "T7", text: "portal — surface the terminal status and the failed state that S3 asked for." },
    ],
    checks: [
      { label: "Guardrail", text: "A generated diff added a direct ledger write from Refunds. Refused against ADR-014 with the alternative in the comment." },
      { label: "Cross-repo", text: "The agent traversed into Notifications from the contract mesh and found the two fields with no test coverage." },
      { label: "Context", text: "A 3,812-character architecture digest went into the agent prompt instead of the whole estate." },
    ],
  },
  {
    no: "05",
    name: "Verify",
    role: "The loop closes",
    headline: "The result is replayed against the sentence.",
    body: "When the pull requests merge, NoX evaluates the code against the original request and each intermediate specification. Unmet requirements reopen only the specific stage where the gap occurred.",
    input: "Merged pull requests and the full document chain",
    output: "Verification report, or a reopened stage",
    gate: "Nothing closes until every criterion is evidenced or waived",
    docName: "CR-2291-verification.md",
    docMeta: "4 satisfied · 1 gap",
    docTitle: "Verification against CR-2291",
    docLines: [
      { tag: "S1", text: "Satisfied. Full refunds settle intra-day; covered by test_settlement_same_day." },
      { tag: "S2", text: "Gap. Partial refunds settle intra-day but no test covers partial combined with retry exhaustion." },
      { tag: "S3", text: "Satisfied. Stage visible in the portal and in the support view." },
      { tag: "AC", text: "Satisfied. Retry exhaustion now produces a failed terminal status." },
    ],
    checks: [
      { label: "Traced", text: "Every satisfied criterion resolves to a file, a line range and a commit — not to a closed ticket." },
      { label: "Root cause", text: "The gap is a missing clause in spec §4.2, not a coding error. Stage 03 reopens with the clause drafted." },
      { label: "Atlas update", text: "The settlement page, the contract mesh and the ADR list update from the merge, with no separate documentation task." },
    ],
  },
];

export const TRACE = [
  { stage: "Sentence", ref: "CR-2291", note: "Refunds take three days and customers keep calling." },
  { stage: "Brief", ref: "brief §4", note: "Terminal status the same business day, partials included." },
  { stage: "Requirement", ref: "prd S2", note: "Partial refund reaches terminal status same day." },
  { stage: "Spec", ref: "spec §4.2", note: "Refunds calls settle-now on completion." },
  { stage: "Code", ref: "settlement.py:118-186", note: "Merged in 9f2ac1b across four repositories." },
  { stage: "Test", ref: "test_settlement_same_day", note: "Covers the full-refund path. Partial retry uncovered." },
];

export const CRITERIA = [
  {
    met: true,
    text: "A full refund reaches a terminal status the same business day.",
    evidence: "ledger-core/settlement.py:118-186 @ 9f2ac1b · test_settlement_same_day",
    source: "PRD S1",
  },
  {
    met: false,
    text: "A partial refund reaches a terminal status the same business day.",
    evidence: "Implemented in refunds/partial.py:64 — no test covers partial combined with retry exhaustion",
    source: "PRD S2",
  },
  {
    met: true,
    text: "Support can see which stage a pending refund is in.",
    evidence: "portal/RefundPanel.tsx:212 @ 4b70ee1 · support view behind scope support:read",
    source: "PRD S3",
  },
  {
    met: true,
    text: "Retry exhaustion produces a visible failed status.",
    evidence: "refunds/retry.py:91 @ 9f2ac1b · test_retry_exhaustion_marks_failed",
    source: "PRD AC",
  },
  {
    met: true,
    text: "No service outside the ledger boundary writes entries directly.",
    evidence: "Guardrail ADR-014 evaluated on 14 diffs · 1 refused, corrected before review",
    source: "Spec §4.2",
  },
];

export const STATIONS = [
  {
    name: "Jira",
    dir: "NoX writes",
    shape: "square" as const,
    tone: "nox" as const,
    body: "Approved requirements become epics and stories with the acceptance criteria attached, sequenced in the order the task graph requires. Status flows back into the change record.",
  },
  {
    name: "Confluence",
    dir: "NoX writes",
    shape: "round" as const,
    tone: "nox" as const,
    body: "Briefs and technical specs publish to the spaces your organisation already audits, with the provenance chain intact. Edits made there are read back as human pins.",
  },
  {
    name: "GitHub",
    dir: "Both ways",
    shape: "round" as const,
    tone: "verify" as const,
    body: "Repositories are the primary source for the atlas. Documentation updates and implementation changes both arrive as ordinary pull requests your team reviews.",
  },
  {
    name: "Slack",
    dir: "NoX reads",
    shape: "diamond" as const,
    tone: "ice" as const,
    body: "Channel threads are ingested as context, not as truth. A decision made in a thread becomes a proposal for a person to confirm before it reaches the graph.",
  },
  {
    name: "Notion",
    dir: "NoX reads",
    shape: "square" as const,
    tone: "ice" as const,
    body: "Product specs and meeting notes are ingested alongside code so requirements are checked against past decisions as well as current code.",
  },
  {
    name: "Files and schemas",
    dir: "NoX reads",
    shape: "diamond" as const,
    tone: "ice" as const,
    body: "OpenAPI documents, PDFs, diagrams and exports are parsed into the same graph. An architecture drawing from two years ago becomes a checkable claim with a date on it.",
  },
];

export type TerminalLine = { kind: "cmd" | "out" | "dim"; text: string };

export const TERMINAL: TerminalLine[][] = [
  [
    { kind: "cmd", text: "nox atlas --app refunds" },
    { kind: "out", text: "  Refunds Service · 4 upstream · 2 downstream" },
    { kind: "dim", text: "  contracts  POST /v1/refunds → ledger-core:/internal/entries" },
    { kind: "dim", text: "             refund.completed → notifications:refund-mail" },
    { kind: "dim", text: "  guardrail  ADR-014 edge services never write the ledger directly" },
  ],
  [
    { kind: "cmd", text: "nox trace CR-2291" },
    { kind: "dim", text: "  sentence  “Refunds take three days…”" },
    { kind: "dim", text: "  brief     §2 → prd §4.3 → spec §4.2" },
    { kind: "dim", text: "  code      refunds/settlement.py:118-186 @ 9f2ac1b" },
  ],
  [
    { kind: "cmd", text: "nox digest --max 4000 > .agent/context.md" },
    { kind: "out", text: "  wrote 3,812 chars · 7 applications · 19 contracts" },
  ],
];
