"use client";

import { EmptyState, PageHeader, Panel } from "@/components/app/ui";

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-shell">
      <PageHeader eyebrow="Activity" title="What moved, and who moved it" lead="Handoffs, approvals, knowledge-base syncs and Jira updates, newest first." />
      <Panel title="Timeline" className="mt-8">
        <EmptyState line="Quiet so far. Handoffs and syncs will stream in here." />
      </Panel>
    </div>
  );
}
