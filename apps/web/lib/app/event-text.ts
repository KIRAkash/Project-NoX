import type { MissionEvent } from "./types";

type EventLike = Pick<MissionEvent, "type" | "payload">;

export const MISSION_EVENT_TEXT: Record<string, (e: EventLike) => string> = {
  "mission.created": () => "started the mission",
  "file.drafting": (e) => `is drafting the ${e.payload.role} file`,
  "file.drafted": (e) => `drafted the ${e.payload.role} file`,
  "file.draft_failed": (e) => `couldn't draft the ${e.payload.role} file`,
  "drafts.ready": () => "finished the drafts",
  "mission.proceeded": () => "proceeded past the unapproved AI drafts",
  "file.saved": (e) => `saved the ${e.payload.role} file (v${e.payload.version})`,
  "file.approved": (e) => `approved the ${e.payload.role} file`,
  "mission.sent_back": (e) => `sent it back to ${e.payload.toRole}: “${e.payload.reason}”`,
  "mission.updated": () => "updated the mission",
  "mission.cancelled": (e) => (e.payload.reason ? `cancelled the mission: “${e.payload.reason}”` : "cancelled the mission"),
  "mission.restored": () => "restored the mission",
  "mission.assigned": (e) => (e.payload.assignee ? `assigned it to ${e.payload.assignee}` : "cleared the assignee"),
  "pr.linked": (e) => `linked pull request ${e.payload.pr}`,
  "pr.updated": (e) => `${e.payload.pr} is now ${e.payload.state}`,
  "pr.guarded": (e) => (e.payload.compliant ? `checked ${e.payload.pr}: no rule conflicts` : `checked ${e.payload.pr}: ${e.payload.violations} possible rule conflicts`),
  "pr.guard_failed": (e) => `couldn't read ${e.payload.pr} for the guard`,
  "mission.completed": () => "marked the mission as completed, verification started",
  "verify.progress": (e) => `ticked ${e.payload.checked}/${e.payload.total} on the ${e.payload.role} checklist`,
  "verify.verified": (e) => `verified the ${e.payload.role} file${e.payload.next ? "" : ", mission done"}`,
  "verify.blocked": (e) => `reported the ${e.payload.role} check as blocked: “${e.payload.note}”`,
  "verify.not_met": (e) => `flagged the ${e.payload.role} file as not met: “${e.payload.note}”`,
  "jira.linked": (e) => `linked ${e.payload.key}`,
  "jira.created": (e) => `created ${e.payload.key} in Jira`,
  "jira.unlinked": (e) => `unlinked ${e.payload.key}`,
  "jira.synced": (e) => `moved ${e.payload.key} to ${e.payload.status ?? "its next status"}`,
  "jira.sync_failed": (e) => `couldn't update ${e.payload.key} in Jira`,
  "jira.subtasks": (e) => `created ${(e.payload.created as string[] | undefined)?.length ?? 0} Jira sub-tasks`,
  "jira.updated": (e) =>
    `${e.payload.key}: ${[
      e.payload.status && `status → ${e.payload.status}`,
      e.payload.assignee && `assigned to ${e.payload.assignee}`,
      e.payload.comment && `“${String(e.payload.comment).slice(0, 80)}”`,
    ]
      .filter(Boolean)
      .join(", ")} (by ${e.payload.by})`,
  "nox.edit": (e) => `refined the ${e.payload.role} file`,
  "file.reverted": (e) => `undid NoX's edit to the ${e.payload.role} file`,
  "shield.refused": () => "flagged a message as a possible prompt injection (NoX Shield); NoX didn't act on it",
  "chat.message": (e) => (e.payload.author === "nox" ? "replied in the chat" : "asked NoX something"),
  "git.synced": (e) => `saved the ${e.payload.role} file to Git (${e.payload.sha})`,
  "media.attached": (e) => `showed NoX a ${String(e.payload.label ?? e.payload.kind ?? "capture").replace("_", " ")}`,
  "media.analyzed": () => "watched a capture and looked it up in the knowledge base",
  "media.withheld": () => "withheld a capture (NoX Shield)",
  "media.deleted": (e) => `deleted a ${e.payload.label ?? "capture"}`,
  "evidence.checked": () => "looked at the evidence on the checklist",
  "evidence.compared": (e) => `compared the after-recording with the ${e.payload.role} checklist`,
  "evidence.compare_failed": () => "couldn't compare the after-recording",
  "jules.started": (e) => `handed the build to Jules (${e.payload.repo})`,
  "jules.plan_ready": () => "heard back from Jules: its plan is ready to approve",
  "jules.plan_approved": () => "approved Jules's plan",
  "jules.message": (e) => `relayed a message from Jules: “${String(e.payload.text ?? "").slice(0, 120)}”`,
  "jules.question": () => "relayed a question from Jules",
  "jules.replied": (e) => `answered Jules: “${String(e.payload.text ?? "").slice(0, 120)}”`,
  "jules.pr_opened": () => "linked the pull request Jules opened",
  "jules.finished": () => "heard Jules finish without a pull request",
  "jules.failed": (e) => `heard Jules stop: “${String(e.payload.reason ?? "").slice(0, 120)}”`,
  "memory.learned": (e) => `${e.payload.merged ? "added to a lesson" : "learned a lesson"}: “${String(e.payload.fact ?? "").slice(0, 140)}”`,
  "memory.applied": (e) =>
    `applied ${(e.payload.ids as string[] | undefined)?.length ?? 0} lesson${(e.payload.ids as string[] | undefined)?.length === 1 ? "" : "s"} to the ${e.payload.role} file`,
  "memory.forgotten": (e) => `forgot a lesson: “${String(e.payload.fact ?? "").slice(0, 140)}”`,
};

export function formatMissionEvent(type: string, payload: Record<string, unknown>): string {
  const fn = MISSION_EVENT_TEXT[type];
  return fn ? fn({ type, payload }) : type.replaceAll(".", " ");
}

export function formatKbEvent(eventType: string, payload: Record<string, unknown>): string {
  const m = payload?.message;
  if (typeof m === "string" && m) return m;
  if (eventType === "status_change" && typeof payload?.status === "string") {
    return `Knowledge base status → ${payload.status.replaceAll("_", " ")}`;
  }
  if (eventType === "pr_opened" && typeof payload?.pr_url === "string") {
    return "Opened knowledge-base pull request";
  }
  return eventType.replaceAll("_", " ");
}
