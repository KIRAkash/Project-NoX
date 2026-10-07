import enum
import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from nox_api.core.time_utils import now_utc_naive

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
    created_at = Column(DateTime, default=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)

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
    last_synced_at = Column(DateTime, default=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)
    last_seen_at = Column(DateTime, default=now_utc_naive)

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
    joined_at = Column(DateTime, default=now_utc_naive)

    user = relationship("User", back_populates="memberships", foreign_keys=[user_id])


class ApiToken(Base):
    """Personal tokens for the `nox` CLI. Only a hash is stored."""

    __tablename__ = "api_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False, default="cli")
    token_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=now_utc_naive)
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
    created_at = Column(DateTime, default=now_utc_naive)


class KBPin(Base):
    """A human correction pinned to a KB page. Re-applied after every recompilation so it is never lost."""

    __tablename__ = "kb_pins"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True)
    page_path = Column(String, nullable=False)
    text = Column(String, nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    author_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=now_utc_naive)


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
    sighting_id = Column(UUID(as_uuid=True), ForeignKey("sightings.id", ondelete="SET NULL", use_alter=True), nullable=True)  # started from a NoX sighting (CP18)
    created_at = Column(DateTime, default=now_utc_naive)
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)

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
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive)


class SpecChatMessage(Base):
    __tablename__ = "spec_chat_messages"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    spec_file_id = Column(UUID(as_uuid=True), ForeignKey("spec_files.id", ondelete="CASCADE"), nullable=False, index=True)
    author = Column(String, nullable=False)                           # user | nox
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    body = Column(Text, nullable=False)
    media_ids = Column(JSON, nullable=False, default=list)           # captures attached to this message (CP15)
    created_at = Column(DateTime, default=now_utc_naive)


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
    created_at = Column(DateTime, default=now_utc_naive)

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
    created_at = Column(DateTime, default=now_utc_naive, index=True)


# ── NoX Shield (CP14) ─────────────────────────────────────────────────────────


class ShieldFinding(Base):
    """Something Model Armor or Sensitive Data Protection flagged. Stores a hash of the text, never the text."""

    __tablename__ = "shield_findings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True, index=True)
    kb_id = Column(UUID(as_uuid=True), ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=True, index=True)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=True, index=True)
    where = Column(String, nullable=False)       # ingest, ask, cowrite, mission_prompt, mcp, a2a, kb_commit
    source = Column(String, nullable=True)       # the document or file it came from
    category = Column(String, nullable=False)    # pi_and_jailbreak, malicious_uris, rai, sdp:<infoType>, …
    confidence = Column(String, nullable=True)
    excerpt_sha = Column(String, nullable=True)
    action = Column(String, nullable=False)      # withheld | refused | blocked_commit | monitored
    created_at = Column(DateTime, default=now_utc_naive, index=True)
# ── Show NoX (CP15) ───────────────────────────────────────────────────────────


class MediaKind(str, enum.Enum):
    image = "image"
    screenshot = "screenshot"
    screen_recording = "screen_recording"
    video = "video"
    audio = "audio"


class MediaStatus(str, enum.Enum):
    uploading = "uploading"
    analyzing = "analyzing"
    ready = "ready"
    failed = "failed"
    withheld = "withheld"   # NoX Shield blocked it: shown to its uploader with the reason, never used in a prompt
    deleted = "deleted"


class MediaAsset(Base):
    """A capture someone showed NoX: a screenshot, a screen recording, a video or a voice note.

    A draft capture (`mission_id` null) belongs to its uploader until a mission is launched with it.
    The file lives in Cloud Storage (a local path in development); what NoX saw and found is `observation`
    and `grounding`, and `views` holds the same analysis rewritten per seat.
    """

    __tablename__ = "media_assets"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="CASCADE"), nullable=True, index=True)
    spec_role = Column(Enum(Role), nullable=True)                    # the file it was attached to, if any
    chat_message_id = Column(UUID(as_uuid=True), ForeignKey("spec_chat_messages.id", ondelete="SET NULL"), nullable=True)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    uploaded_as = Column(Enum(Role), nullable=False)                 # the seat that captured it: live steps speak its words
    kind = Column(Enum(MediaKind), nullable=False)
    mime = Column(String, nullable=False)
    bytes = Column(BigInteger, nullable=False)
    duration_s = Column(Float, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    clip_start_s = Column(Float, nullable=True)                      # trimmed in the preview: only this part is watched
    clip_end_s = Column(Float, nullable=True)
    storage_uri = Column(String, nullable=False)                     # gs://… in production, local://… in development
    annotated_of = Column(UUID(as_uuid=True), ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True)
    caption = Column(Text, nullable=True)
    status = Column(Enum(MediaStatus), nullable=False, default=MediaStatus.uploading)
    status_reason = Column(Text, nullable=True)                      # why it failed or was withheld, in plain words
    observation = Column(JSON, nullable=True)                        # ai.schemas.MediaObservation
    grounding = Column(JSON, nullable=True)                          # ai.schemas.MediaGrounding
    views = Column(JSON, nullable=False, default=dict)               # {seat: SeatView}
    usage = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, default=now_utc_naive)
    analyzed_at = Column(DateTime, nullable=True)


# ── Sightings (CP18) ──────────────────────────────────────────────────────────


class SightingStatus(str, enum.Enum):
    open = "open"
    snoozed = "snoozed"
    dismissed = "dismissed"
    launched = "launched"      # a mission was started from it
    shipped = "shipped"        # that mission is done
    outdated = "outdated"      # its evidence no longer holds


class Sighting(Base):
    """A change NoX suggests: one opportunity, with a view written for each seat it matters to.

    `views` is {seat: SeatSighting + relevance}; `evidence` is every source it rests on, filtered per seat when served
    (code locations never reach the business or product seat). `kb_ids` are the applications it cites: a viewer must
    be able to see all of them.
    """

    __tablename__ = "sightings"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    run_id = Column(UUID(as_uuid=True), ForeignKey("sighting_runs.id", ondelete="SET NULL"), nullable=True)
    kb_ids = Column(JSON, nullable=False, default=list)
    kind = Column(String, nullable=False)
    claim = Column(Text, nullable=False)
    evidence = Column(JSON, nullable=False, default=list)
    views = Column(JSON, nullable=False, default=dict)
    open_questions = Column(JSON, nullable=False, default=list)
    impact = Column(String, nullable=False, default="medium")      # high | medium | low
    effort = Column(String, nullable=True)                         # S | M | L
    status = Column(Enum(SightingStatus), nullable=False, default=SightingStatus.open, index=True)
    status_reason = Column(Text, nullable=True)
    mission_id = Column(UUID(as_uuid=True), ForeignKey("missions.id", ondelete="SET NULL"), nullable=True)
    fingerprint = Column(String, nullable=False, index=True)       # hash of the sorted evidence refs
    embedding = Column(JSON, nullable=True)                        # the claim's embedding, for dedupe across runs
    snoozed_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_utc_naive, index=True)
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)


class SightingRun(Base):
    __tablename__ = "sighting_runs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    trigger = Column(String, nullable=False)                       # schedule | manual
    status = Column(String, nullable=False, default="running")     # running | done | failed
    apps_scanned = Column(JSON, nullable=False, default=list)
    apps_skipped = Column(JSON, nullable=False, default=list)
    counts = Column(JSON, nullable=False, default=dict)            # {seat: new sightings}, plus candidates / kept / outdated
    usage = Column(JSON, nullable=False, default=dict)
    error = Column(Text, nullable=True)
    started_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime, default=now_utc_naive, index=True)
    finished_at = Column(DateTime, nullable=True)


class SightingFeedback(Base):
    """What a person did with a sighting. Dismissals and their reasons steer the next runs away from repeats."""

    __tablename__ = "sighting_feedback"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sighting_id = Column(UUID(as_uuid=True), ForeignKey("sightings.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    seat = Column(Enum(Role), nullable=False)
    action = Column(String, nullable=False)                        # useful | dismissed | snoozed | launched
    reason = Column(String, nullable=True)                         # not_relevant | already_known | wrong | not_now | free text
    created_at = Column(DateTime, default=now_utc_naive)


class SightingSchedule(Base):
    """When NoX looks for sightings in a top-level organization (and everything beneath it)."""

    __tablename__ = "sighting_schedules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id = Column(UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, unique=True)
    cadence = Column(String, nullable=False, default="weekly")     # off | daily | weekly
    weekday = Column(Integer, nullable=False, default=0)           # 0 = Monday
    hour = Column(Integer, nullable=False, default=8)
    timezone = Column(String, nullable=False, default="UTC")
    seats = Column(JSON, nullable=False, default=lambda: [r.value for r in Role])
    focus = Column(JSON, nullable=False, default=list)             # lens kinds weighted up, e.g. ["cost", "performance"]
    fingerprints = Column(JSON, nullable=False, default=dict)      # {kb_id: hash of its inputs at the last run}
    next_run_at = Column(DateTime, nullable=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=now_utc_naive, onupdate=now_utc_naive)
