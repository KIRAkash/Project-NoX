import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .database import Base


class KBStatus(str, enum.Enum):
    queued = "queued"
    ingesting = "ingesting"
    generating = "generating"
    in_review = "in_review"
    published = "published"
    failed = "failed"

class MonitorMode(str, enum.Enum):
    webhook = "webhook"
    polling = "polling"

class InterfaceType(str, enum.Enum):
    rest_endpoint = "rest_endpoint"
    grpc_service = "grpc_service"
    event_topic = "event_topic"
    shared_model = "shared_model"
    sdk_client = "sdk_client"

class Org(Base):
    __tablename__ = "orgs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True, nullable=False)
    github_org = Column(String, nullable=True)
    parent_org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    parent = relationship("Org", remote_side=[id], back_populates="children")
    children = relationship("Org", back_populates="parent")
    knowledge_bases = relationship("KnowledgeBase", back_populates="org")
    org_kbs = relationship("OrgKB", back_populates="org")
    contracts = relationship("OrgInterfaceContract", back_populates="org")

class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id"))
    app_name = Column(String, nullable=False)
    status = Column(Enum(KBStatus), default=KBStatus.queued)
    source_urls = Column(JSON, default=list)
    git_repo_url = Column(String, nullable=True)
    pr_url = Column(String, nullable=True)
    org_pr_url = Column(String, nullable=True)
    gcs_archive_path = Column(String, nullable=True)
    built_with = Column(String, nullable=True)  # "cloud:<model>" or "local:<model>" (NoX Local: source never left the laptop)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    org = relationship("Org", back_populates="knowledge_bases")
    events = relationship("KBEvent", back_populates="kb")
    source_monitors = relationship("SourceMonitor", back_populates="kb")
    contracts = relationship("OrgInterfaceContract", back_populates="kb")

class KBEvent(Base):
    __tablename__ = "kb_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id"))
    event_type = Column(String, nullable=False)
    payload = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    kb = relationship("KnowledgeBase", back_populates="events")

class SourceMonitor(Base):
    __tablename__ = "source_monitors"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id"))
    source_type = Column(String, default="github", nullable=False)
    repo_url = Column(String, nullable=False)  # Retained for compatibility & canonical source URL
    source_url = Column(String, nullable=True)
    webhook_id = Column(String, nullable=True)
    last_commit_sha = Column(String, nullable=True)
    last_sync_state = Column(JSON, default=dict)
    config = Column(JSON, default=dict)
    incremental_enabled = Column(Boolean, default=True)
    monitor_mode = Column(Enum(MonitorMode), default=MonitorMode.webhook)
    last_synced_at = Column(DateTime, default=datetime.utcnow)

    kb = relationship("KnowledgeBase", back_populates="source_monitors")

    @property
    def target_url(self) -> str:
        return self.source_url or self.repo_url

class OrgKB(Base):

    __tablename__ = "org_kbs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id"))
    git_repo_url = Column(String, nullable=True)
    status = Column(Enum(KBStatus), default=KBStatus.queued)
    pr_url = Column(String, nullable=True)
    trigger_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    org = relationship("Org", back_populates="org_kbs")

class OrgInterfaceContract(Base):
    __tablename__ = "org_interface_contracts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=False, index=True)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    app_name = Column(String, nullable=False, index=True)
    interface_type = Column(Enum(InterfaceType), nullable=False)
    identifier = Column(String, nullable=False, index=True)  # e.g., "/api/v1/auth/login", "nte.trades.matched", "MarketData"
    page_path = Column(String, nullable=False)  # e.g., "summaries/api-spec.md"
    anchor_slug = Column(String, nullable=True)  # e.g., "login", "matched-trades"
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    org = relationship("Org", back_populates="contracts")
    kb = relationship("KnowledgeBase", back_populates="contracts")



# ── Identity (CP3) ────────────────────────────────────────────────────────────


class Role(str, enum.Enum):
    """The four seats a user can pick on the role picker."""

    business = "business"
    product = "product"
    engineering = "engineering"
    developer = "developer"


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firebase_uid = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, index=True, nullable=True)
    name = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)
    last_role = Column(Enum(Role), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)

    memberships = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan", foreign_keys="Membership.user_id"
    )


class Membership(Base):
    """Which orgs a user can see. Access flows down to every sub-org beneath `org_id`."""

    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "org_id", name="uq_membership_user_org"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="memberships", foreign_keys=[user_id])


class ApiToken(Base):
    """Personal tokens for the `nox` CLI. Only a hash is stored."""

    __tablename__ = "api_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False, default="cli")
    token_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)


# ── Atlas (CP5) ───────────────────────────────────────────────────────────────


class OrgInvite(Base):
    """An email invited to an org before that person has signed in. Becomes a Membership on first sign-in."""

    __tablename__ = "org_invites"
    __table_args__ = (UniqueConstraint("org_id", "email", name="uq_invite_org_email"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String, nullable=False, index=True)
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class KBPin(Base):
    """A human correction pinned to a KB page. Re-applied after every recompilation so it is never lost."""

    __tablename__ = "kb_pins"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True)
    page_path = Column(String, nullable=False)
    text = Column(String, nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    author_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ── Missions (CP7) ────────────────────────────────────────────────────────────


class MissionStage(str, enum.Enum):
    """Forward stages follow the four roles; then the developer builds, then everyone verifies in reverse."""

    business = "business"
    product = "product"
    engineering = "engineering"
    developer = "developer"
    build = "build"
    verifying = "verifying"
    done = "done"


class SpecStatus(str, enum.Enum):
    empty = "empty"            # nobody has written it yet
    drafting = "drafting"      # NoX is writing the first draft
    ai_drafted = "ai_drafted"  # NoX wrote it; no human in that role has approved it
    draft = "draft"            # a human is working on it
    approved = "approved"      # frozen
    stale = "stale"            # an upstream file changed after this was approved


class Mission(Base):
    __tablename__ = "missions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number = Column(Integer, unique=True, nullable=False, index=True)  # NOX-<number>
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    primary_kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=False)
    prompt = Column(String, nullable=False)
    type = Column(String, nullable=False, default="feature")        # feature | bug | change
    priority = Column(String, nullable=True)                        # P1..P4, set by the product owner
    stage = Column(Enum(MissionStage), nullable=False, default=MissionStage.business)
    verify_role = Column(Enum(Role), nullable=True)                 # whose checklist is lit while verifying
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_as_role = Column(Enum(Role), nullable=False)
    awaiting_proceed = Column(Boolean, nullable=False, default=False)
    proceeded_without_approval = Column(Boolean, nullable=False, default=False)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def key(self) -> str:
        return f"NOX-{self.number}"

    apps = relationship("MissionApp", back_populates="mission", cascade="all, delete-orphan")
    files = relationship("SpecFile", back_populates="mission", cascade="all, delete-orphan")
    links = relationship("ExternalLink", back_populates="mission", cascade="all, delete-orphan")


class MissionApp(Base):
    __tablename__ = "mission_apps"
    __table_args__ = (UniqueConstraint("mission_id", "kb_id", name="uq_mission_app"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False)

    mission = relationship("Mission", back_populates="apps")


class SpecFile(Base):
    """One Markdown file per role. Only a human in that role edits it; NoX co-writes."""

    __tablename__ = "spec_files"
    __table_args__ = (UniqueConstraint("mission_id", "role", name="uq_spec_file_role"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(Enum(Role), nullable=False)
    status = Column(Enum(SpecStatus), nullable=False, default=SpecStatus.empty)
    markdown = Column(Text, nullable=False, default="")
    version = Column(Integer, nullable=False, default=0)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    git_path = Column(String, nullable=True)
    git_commit_sha = Column(String, nullable=True)
    verification = Column(JSON, nullable=False, default=dict)       # {items: [{text, checked, note}], verified_at, verified_by}
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    mission = relationship("Mission", back_populates="files")


class SpecFileVersion(Base):
    __tablename__ = "spec_file_versions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spec_file_id = Column(UUID(as_uuid=True), ForeignKey("spec_files.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    markdown = Column(Text, nullable=False)
    source = Column(String, nullable=False, default="human")       # human | nox
    saved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    git_commit_sha = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SpecChatMessage(Base):
    __tablename__ = "spec_chat_messages"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spec_file_id = Column(UUID(as_uuid=True), ForeignKey("spec_files.id", ondelete="CASCADE"), nullable=False, index=True)
    author = Column(String, nullable=False)                           # user | nox
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ExternalLink(Base):
    """Jira tickets and GitHub pull requests attached to a mission."""

    __tablename__ = "external_links"
    __table_args__ = (UniqueConstraint("mission_id", "system", "external_id", name="uq_external_link"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    system = Column(String, nullable=False)                           # jira | github_pr
    external_id = Column(String, nullable=False, index=True)         # APEX-41 | org/repo#12
    url = Column(String, nullable=True)
    primary = Column(Boolean, nullable=False, default=False)
    state = Column(JSON, nullable=False, default=dict)                # last known status, etc.
    created_at = Column(DateTime, default=datetime.utcnow)

    mission = relationship("Mission", back_populates="links")


class MissionEvent(Base):
    __tablename__ = "mission_events"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    actor_name = Column(String, nullable=True)
    acting_role = Column(String, nullable=True)
    type = Column(String, nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
