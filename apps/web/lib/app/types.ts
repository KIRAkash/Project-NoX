import type { KbStatus } from "@/components/app/ui";

export type SourceType = "github" | "confluence" | "notion" | "jira" | "slack" | "upload";

export type SourceItem = { type: SourceType; url: string; incrementalEnabled?: boolean | null; config?: Record<string, unknown> | null };

export type Kb = {
  id: string;
  orgId: string;
  appName: string;
  status: KbStatus;
  sourceUrls: SourceItem[];
  gitRepoUrl?: string | null;
  prUrl?: string | null;
  orgPrUrl?: string | null;
  /** Where the current pages were generated: "cloud:<model>" or "local:<model>" (NoX Local). */
  builtWith?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KbEvent = { id: string; eventType: string; payload: Record<string, unknown>; createdAt: string };

export type SourceMonitor = {
  id: string;
  sourceType: string;
  repoUrl: string;
  sourceUrl?: string | null;
  lastSyncedAt?: string | null;
  lastCommitSha?: string | null;
};

export type KbDetail = Kb & { events: KbEvent[]; sourceMonitors: SourceMonitor[] };

export type Org = { id: string; name: string; slug: string; githubOrg?: string | null; parentOrgId?: string | null; createdAt: string };

export type OrgTree = Org & { children: OrgTree[]; apps: Kb[] };

export type OrgMap = {
  orgs: { id: string; name: string; parentOrgId: string | null }[];
  apps: { id: string; name: string; orgId: string; status: KbStatus }[];
  contracts: { appId: string; type: string; identifier: string; page: string; description?: string | null }[];
  links: { from: string; to: string; count: number }[];
};

export type Members = {
  members: { id: string; name: string | null; email: string | null; photoUrl: string | null }[];
  invites: { id: string; email: string; createdAt: string }[];
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  github: "GitHub repository",
  confluence: "Confluence space",
  jira: "Jira project",
  notion: "Notion page",
  slack: "Slack channel",
  upload: "Uploaded file",
};

export const SOURCE_PLACEHOLDER: Record<SourceType, string> = {
  github: "https://github.com/org/repo",
  confluence: "https://yourco.atlassian.net/wiki/spaces/KEY",
  jira: "https://yourco.atlassian.net/jira/projects/KEY",
  notion: "https://www.notion.so/Page-Title-<id>",
  slack: "https://yourco.slack.com/archives/C0123456",
  upload: "",
};

// ── Missions ─────────────────────────────────────────────────────────────────

export type SpecStatus = "empty" | "drafting" | "ai_drafted" | "draft" | "approved" | "stale";
export type MissionStage = "business" | "product" | "engineering" | "developer" | "build" | "verifying" | "done";

export type VerificationItem = { text: string; checked: boolean; note?: string | null };

export type SpecFile = {
  role: "business" | "product" | "engineering" | "developer";
  title: string;
  fileName: string;
  status: SpecStatus;
  version: number;
  approvedAt: string | null;
  updatedAt: string | null;
  gitPath: string | null;
  markdown?: string;
  verification: { items?: VerificationItem[]; verifiedAt?: string; verifiedBy?: string; result?: "verified" | "not_met" | null; note?: string; round?: number };
};

export type MissionLink = { system: "jira" | "github_pr"; externalId: string; url: string | null; primary: boolean; state: Record<string, unknown> };

export type Mission = {
  id: string;
  key: string;
  title: string;
  prompt: string;
  type: string;
  priority: string | null;
  stage: MissionStage;
  verifyRole: SpecFile["role"] | null;
  createdAsRole: SpecFile["role"];
  awaitingProceed: boolean;
  proceededWithoutApproval: boolean;
  orgId: string;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
  files: SpecFile[];
  apps: { id: string; name: string; status?: string }[];
  links: MissionLink[];
};

export type MissionEvent = { id: string; type: string; payload: Record<string, unknown>; actor: string | null; role: string | null; createdAt: string };

/** A mission's ticket document in Firestore: its pipeline, where it is on it, and who it's assigned to. */
export type PipelineStep = { id: string; kind: "seat" | "build" | "verify"; role: string; label: string; status: "done" | "current" | "pending" };
export type Person = { id: string; name: string | null; email: string | null; photoUrl: string | null };
export type TicketState = {
  key: string;
  currentStep: string | null;
  pipeline: PipelineStep[];
  transitions: { from: string | null; to: string | null; event: string; by: string; at: string }[];
  assignee: {
    userId: string;
    name: string;
    email: string | null;
    photoUrl: string | null;
    assignedBy: { userId: string; name: string; role: string };
    assignedAt: string;
  } | null;
};

export const STAGE_LABEL: Record<MissionStage, string> = {
  business: "Business",
  product: "Product",
  engineering: "Engineering",
  developer: "Developer",
  build: "Build",
  verifying: "Verifying",
  done: "Done",
};

export const STAGE_INDEX: Record<MissionStage, number> = { business: 0, product: 1, engineering: 2, developer: 3, build: 3, verifying: 4, done: 4 };

export const SPEC_STATUS_LABEL: Record<SpecStatus, string> = {
  empty: "Not started",
  drafting: "NoX is drafting…",
  ai_drafted: "AI-drafted · unapproved",
  draft: "Draft",
  approved: "Approved",
  stale: "Stale — upstream changed",
};
