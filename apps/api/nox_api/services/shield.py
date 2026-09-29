"""NoX Shield: Model Armor and Sensitive Data Protection screen what enters and leaves NoX's prompts.

Why: NoX pulls third-party text (Confluence, Slack, Jira, Notion, uploads, READMEs) into agent prompts, so anyone
who can write a Confluence page could plant "ignore previous instructions…" and steer the KB builder, Ask or the
co-writer. Model Armor screens for prompt injection, jailbreaks, malicious URLs and unsafe content; Sensitive Data
Protection (DLP) finds credentials and personal data better than the regexes in `agents/linter.py`, which stay as
the offline fallback and for NoX Local.

  screen_prompt(text, where=…)       a question, chat message or mission prompt → Verdict (refuse on a finding)
  screen_source(name, text, kb_id=…) one ingested document, chunked            → Verdict (withhold on a finding)
  guard_source(type, url, content)   a connector's whole output: documents whole, code sources per prose file
  screen_output(files)               KB pages before commit → DLP findings (credentials, personal data)

Modes (`NOX_SHIELD`): `off` (local and tests), `monitor` (record, block nothing), `enforce` (production).
NoX Local (`NOX_AI_BACKEND=local`) always runs with Shield off: no cloud dependency.

Fail open with a trace: if Model Armor or DLP can't be reached the verdict says `screened: False`, a warning is
logged and the work continues; the KB flight log then says "not screened", so it is never silent.
Findings are stored in `shield_findings` as a hash of the text, never the text.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import threading
from dataclasses import asdict, dataclass, field

from ..core.config import settings

logger = logging.getLogger(__name__)

# Model Armor limits request size; chunks stay well under it (check the current limit in the Model Armor docs).
CHUNK_CHARS = 16000
CONCURRENCY = 4
BLOCKING = {"pi_and_jailbreak", "malicious_uris", "rai", "csam"}  # sdp findings are recorded, never blocking here
DLP_INFO_TYPES = ["GCP_API_KEY", "AUTH_TOKEN", "AWS_CREDENTIALS", "ENCRYPTION_KEY", "PASSWORD", "JSON_WEB_TOKEN",
                  "EMAIL_ADDRESS", "CREDIT_CARD_NUMBER"]
DLP_CHUNK_CHARS = 400_000  # DLP content.inspect accepts up to 0.5 MB per request
WITHHELD = "[NoX Shield withheld this document: possible {what} in {source}]"
_PROSE = re.compile(r"(\.(md|markdown|mdx|txt|rst|adoc)$)|(^|/)docs?/", re.I)
_LEADING_COMMENT = re.compile(r"\A(?:\s*(?:#|//|/\*|\*|--|\"\"\"|''').*\n){3,40}")


@dataclass
class Finding:
    category: str
    confidence: str = ""
    source: str = ""
    excerpt_sha: str = ""
    location: str = ""

    @property
    def blocking(self) -> bool:
        return self.category.split(":")[0] in BLOCKING


@dataclass
class Verdict:
    blocked: bool = False
    findings: list[Finding] = field(default_factory=list)
    screened: bool = False

    def as_dict(self) -> dict:
        return {"blocked": self.blocked, "screened": self.screened, "findings": [asdict(f) for f in self.findings]}


def mode() -> str:
    from ..ai import config

    chosen = settings.NOX_SHIELD.strip().lower()
    if chosen not in ("monitor", "enforce") or config.backend() == "local":
        return "off"
    return chosen


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()


def chunks(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Split at paragraph boundaries (then lines, then hard) so each piece fits one request."""
    if len(text) <= size:
        return [text] if text.strip() else []
    out, cur = [], ""
    for para in re.split(r"(\n\s*\n)", text):
        while len(para) > size:
            if cur:
                out.append(cur)
                cur = ""
            cut = para.rfind("\n", 0, size)
            cut = cut if cut > size // 2 else size
            out.append(para[:cut])
            para = para[cut:]
        if len(cur) + len(para) > size:
            out.append(cur)
            cur = ""
        cur += para
    if cur.strip():
        out.append(cur)
    return [c for c in out if c.strip()]


# ── The Google clients (plain REST with the runtime's service account; swapped for a fake in tests) ──────────


class GoogleShieldClient:
    """Model Armor + DLP over REST, authenticated by ADC (the Cloud Run service account). No key anywhere."""

    def __init__(self):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        self.session = AuthorizedSession(creds)

    @staticmethod
    def template() -> str:
        from ..ai import config

        t = settings.NOX_SHIELD_TEMPLATE
        return t if t.startswith("projects/") else f"projects/{config.project()}/locations/{settings.NOX_SHIELD_LOCATION}/templates/{t}"

    def sanitize(self, kind: str, text: str) -> dict:
        verb, body = (("sanitizeUserPrompt", {"userPromptData": {"text": text}}) if kind == "prompt"
                      else ("sanitizeModelResponse", {"modelResponseData": {"text": text}}))
        url = f"https://modelarmor.{settings.NOX_SHIELD_LOCATION}.rep.googleapis.com/v1/{self.template()}:{verb}"
        res = self.session.post(url, json=body, timeout=20)
        res.raise_for_status()
        return res.json().get("sanitizationResult") or {}

    def inspect(self, text: str, info_types: list[str]) -> list[dict]:
        from ..ai import config

        url = f"https://dlp.googleapis.com/v2/projects/{config.project()}/locations/global/content:inspect"
        res = self.session.post(url, timeout=30, json={
            "item": {"value": text},
            "inspectConfig": {"infoTypes": [{"name": n} for n in info_types], "minLikelihood": "LIKELY",
                              "includeQuote": False, "limits": {"maxFindingsPerRequest": 50}},
        })
        res.raise_for_status()
        return (res.json().get("result") or {}).get("findings") or []


_client = None
_client_lock = threading.Lock()


def client():
    global _client
    with _client_lock:
        if _client is None:
            _client = GoogleShieldClient()
        return _client


def set_client(c) -> None:
    """Tests: install a fake (anything with `sanitize(kind, text)` and `inspect(text, info_types)`)."""
    global _client
    _client = c


def armor_findings(result: dict, source: str, text: str) -> list[Finding]:
    """Findings from a Model Armor sanitizationResult: one per matched filter (per sub-type for RAI and SDP)."""
    out = []
    for name, wrapper in (result.get("filterResults") or {}).items():
        inner = next(iter(wrapper.values()), {}) if isinstance(wrapper, dict) and wrapper else {}
        inner = inner.get("inspectResult", inner)
        if inner.get("matchState") != "MATCH_FOUND":
            continue
        sha = _sha(text)
        if name == "rai":
            for sub, r in (inner.get("raiFilterTypeResults") or {}).items():
                if r.get("matchState") == "MATCH_FOUND":
                    out.append(Finding(f"rai:{sub}", r.get("confidenceLevel", ""), source, sha))
        elif name == "sdp":
            for f in inner.get("findings") or [{}]:
                out.append(Finding(f"sdp:{f.get('infoType', 'unknown')}", f.get("likelihood", ""), source, sha))
        else:
            out.append(Finding(name, inner.get("confidenceLevel", ""), source, sha))
    return out


# ── Recording ────────────────────────────────────────────────────────────────


async def record(findings: list[Finding], *, where: str, action: str, org_id=None, kb_id=None, mission_id=None) -> None:
    """Store findings (hash only) and stream them to the flight recorder. Never raises."""
    if not findings:
        return
    from ..db.models import ShieldFinding
    from ..workers.db_session import get_db_sync
    from . import analytics

    def as_uuid(v):
        import uuid

        return v if v is None or isinstance(v, uuid.UUID) else uuid.UUID(str(v))

    try:
        async with get_db_sync() as db:
            for f in findings:
                db.add(ShieldFinding(org_id=as_uuid(org_id), kb_id=as_uuid(kb_id), mission_id=as_uuid(mission_id), where=where, source=f.source[:500],
                                     category=f.category, confidence=f.confidence, excerpt_sha=f.excerpt_sha, action=action))
            await db.commit()
    except Exception:
        logger.warning("Shield findings not stored", exc_info=True)
    for f in findings:
        analytics.emit("shield_findings", {"org_id": org_id, "kb_id": kb_id, "mission_id": mission_id, "where": where,
                                           "source": f.source[:500], "category": f.category, "confidence": f.confidence,
                                           "excerpt_sha": f.excerpt_sha, "action": action})
    logger.info(f"nox.shield {where} {action}: {', '.join(sorted({f.category for f in findings}))}")


def _record_blocking(findings: list[Finding], **kw) -> None:
    """Record from sync code that may run inside an event loop (the KB commit path): on a helper thread."""
    t = threading.Thread(target=lambda: asyncio.run(record(findings, **kw)), daemon=True)
    t.start()
    t.join(timeout=10)


# ── Screening ────────────────────────────────────────────────────────────────


async def _sanitize(kind: str, text: str, source: str) -> tuple[list[Finding], bool]:
    """(findings, screened) for text of any length: chunks screened with bounded concurrency."""
    sem = asyncio.Semaphore(CONCURRENCY)
    c = client()

    async def one(piece: str):
        async with sem:
            return armor_findings(await asyncio.to_thread(c.sanitize, kind, piece), source, piece)

    try:
        results = await asyncio.gather(*(one(p) for p in chunks(text)))
    except Exception as e:
        logger.warning(f"Shield could not screen {source or kind} ({type(e).__name__}: {e}); continuing unscreened")
        return [], False
    return [f for r in results for f in r], True


async def screen_prompt(text: str, *, where: str, org_id=None, kb_id=None, mission_id=None) -> Verdict:
    """Screen a person's message before any model sees it. Blocked verdicts mean: refuse, make no model call."""
    if mode() == "off" or not text.strip():
        return Verdict()
    try:
        found, screened = await _sanitize("prompt", text, where)
    except Exception as e:  # e.g. no credentials at all
        logger.warning(f"Shield unavailable ({type(e).__name__}: {e})")
        return Verdict()
    blocked = mode() == "enforce" and any(f.blocking for f in found)
    await record(found, where=where, action="refused" if blocked else "monitored", org_id=org_id, kb_id=kb_id, mission_id=mission_id)
    return Verdict(blocked=blocked, findings=found, screened=screened)


async def screen_source(name: str, text: str, *, kb_id=None, org_id=None) -> Verdict:
    """Screen one ingested document (or a code source's prose file). Blocked verdicts mean: withhold it."""
    if mode() == "off" or not text.strip():
        return Verdict()
    try:
        found, screened = await _sanitize("prompt", text, name)
    except Exception as e:
        logger.warning(f"Shield unavailable ({type(e).__name__}: {e})")
        return Verdict()
    blocked = mode() == "enforce" and any(f.blocking for f in found)
    await record(found, where="ingest", action="withheld" if blocked else "monitored", org_id=org_id, kb_id=kb_id)
    return Verdict(blocked=blocked, findings=found, screened=screened)


def withheld_notice(source: str, findings: list[Finding]) -> str:
    what = "prompt injection" if any(f.category == "pi_and_jailbreak" for f in findings) else \
        next((f.category.split(":")[0].replace("_", " ") for f in findings if f.blocking), "unsafe content")
    return WITHHELD.format(what=what, source=source)


def _screenable_part(path: str, body: str) -> str:
    """What of a code source's file is screened: prose files whole, code files only their top-of-file comment."""
    if _PROSE.search(path):
        return body
    m = _LEADING_COMMENT.match(body)
    return m.group(0) if m and len(m.group(0)) >= 80 else ""


async def guard_source(source_type: str | None, source_url: str, content: str, *, kb_id=None, org_id=None) -> tuple[str, dict]:
    """Screen one connector's output and withhold what Model Armor flags.

    Documents (Confluence, Notion, Slack, Jira, uploads) are screened whole. Code sources are screened per prose
    file (`*.md`, `*.txt`, `docs/**`) plus top-of-file comments; code bodies are not screened (cost), because the
    writers only trust code as evidence. Returns the content to keep and a report for the flight log:
    {"documents": n screened, "withheld": [names], "unscreened": n, "findings": n}.
    """
    report = {"documents": 0, "withheld": [], "unscreened": 0, "findings": 0}
    if mode() == "off" or not content or content.startswith("[Ingestion failed"):
        return content, report
    parts = re.split(r"^--- FILE: (.*?) ---$", content, flags=re.M)

    async def check(name: str, text: str) -> Verdict:
        v = await screen_source(name, text, kb_id=kb_id, org_id=org_id)
        report["documents"] += 1
        report["findings"] += len(v.findings)
        if not v.screened:
            report["unscreened"] += 1
        return v

    if len(parts) == 1:  # one document
        v = await check(source_url, content)
        if v.blocked:
            report["withheld"].append(source_url)
            return withheld_notice(source_url, v.findings), report
        return content, report

    out = [parts[0]]
    targets = [(i, parts[i].strip(), _screenable_part(parts[i].strip(), parts[i + 1])) for i in range(1, len(parts), 2)]
    sem = asyncio.Semaphore(CONCURRENCY)

    async def guarded(name, text):
        async with sem:
            return await check(name, text)

    verdicts = await asyncio.gather(*(guarded(name, text) if text.strip() else asyncio.sleep(0, result=None)
                                      for _, name, text in targets))
    for (i, name, _), v in zip(targets, verdicts, strict=True):
        body = parts[i + 1]
        if v is not None and v.blocked:
            report["withheld"].append(name)
            body = "\n" + withheld_notice(name, v.findings) + "\n"
        out.append(f"--- FILE: {parts[i]} ---{body}")
    return "".join(out), report


def screen_output_sync(files: dict[str, str]) -> list[Finding]:
    """DLP over pages about to be committed: credentials and personal data. Sync, for the Git commit path."""
    if mode() == "off":
        return []
    found = []
    try:
        c = client()
        for path, text in files.items():
            for piece in chunks(text, DLP_CHUNK_CHARS):
                for f in c.inspect(piece, DLP_INFO_TYPES):
                    found.append(Finding(f"sdp:{(f.get('infoType') or {}).get('name', 'unknown')}", f.get("likelihood", ""),
                                         path, _sha(piece)))
    except Exception as e:
        logger.warning(f"Shield could not inspect pages before commit ({type(e).__name__}: {e}); regex screen only")
        return []
    return found


async def screen_output(files: dict[str, str]) -> list[Finding]:
    return await asyncio.to_thread(screen_output_sync, files)


def assert_pages_clean(files: dict[str, str], *, kb_id=None, org_id=None) -> None:
    """The DLP half of the commit gate (`agents/linter.assert_no_secrets` calls it after its regexes)."""
    found = screen_output_sync(files)
    if not found:
        return
    blocked = mode() == "enforce"
    _record_blocking(found, where="kb_commit", action="blocked_commit" if blocked else "monitored", org_id=org_id, kb_id=kb_id)
    if blocked:
        from ..agents.linter import SecretLeakError

        where = ", ".join(sorted({f.source for f in found})[:5])
        raise SecretLeakError(f"Blocked commit: Sensitive Data Protection found {found[0].category.removeprefix('sdp:')} in {where}")
