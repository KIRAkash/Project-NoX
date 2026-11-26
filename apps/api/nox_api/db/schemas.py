from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .models import KBStatus


class CamelModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )

class OrgCreate(CamelModel):
    name: str
    slug: str
    parent_org_id: UUID | None = None
    github_org: str | None = None

class OrgResponse(CamelModel):
    id: UUID
    name: str
    slug: str
    github_org: str | None = None
    parent_org_id: UUID | None = None
    created_at: datetime

class SourceUrlItem(CamelModel):
    type: Literal['github', 'confluence', 'notion', 'jira', 'slack', 'upload']
    url: str
    incremental_enabled: bool | None = True
    config: dict[str, Any] | None = None

class SourceMonitorResponse(CamelModel):
    id: UUID
    kb_id: UUID
    source_type: str = "github"
    repo_url: str
    source_url: str | None = None
    incremental_enabled: bool = True
    monitor_mode: str = "webhook"
    last_commit_sha: str | None = None
    last_sync_state: dict[str, Any] = {}
    config: dict[str, Any] = {}
    last_synced_at: datetime | None = None

class KBCreate(CamelModel):
    app_name: str
    source_urls: list[SourceUrlItem]

class KBResponse(CamelModel):
    id: UUID
    org_id: UUID
    app_name: str
    status: KBStatus
    source_urls: list[SourceUrlItem] = []
    git_repo_url: str | None = None
    pr_url: str | None = None
    org_pr_url: str | None = None
    gcs_archive_path: str | None = None
    built_with: str | None = None
    created_at: datetime
    updated_at: datetime

class KBEventResponse(CamelModel):
    id: UUID
    kb_id: UUID
    event_type: str
    payload: dict[str, Any] = {}
    created_at: datetime

class KBDetailResponse(KBResponse):
    events: list[KBEventResponse] = []
    source_monitors: list[SourceMonitorResponse] = []


class OrgTreeNode(OrgResponse):
    children: list['OrgTreeNode'] = []
    knowledge_bases: list[KBResponse] = []
    apps: list[KBResponse] = []

class AddSourceRequest(CamelModel):
    type: Literal['github', 'confluence', 'notion', 'jira', 'slack', 'upload']
    url: str
    incremental_enabled: bool | None = True
    config: dict[str, Any] | None = None
