"use client";

import { EmptyState, PageHeader, Panel } from "@/components/app/ui";

export default function ArtifactsPage() {
  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Artifacts"
        title="Every spec, in one library"
        lead="Business requirements, product specs, engineering designs and build specs from every mission, readable by every seat."
      />
      <Panel title="Spec files" className="mt-8">
        <EmptyState line="Spec files appear here as missions are written." />
      </Panel>
    </div>
  );
}
