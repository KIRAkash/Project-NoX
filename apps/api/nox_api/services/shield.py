"""NoX Shield: screening text that enters a prompt from outside NoX.

CP14 Part B wires Model Armor and Sensitive Data Protection in here. Until it lands this is the seam the
rest of NoX already calls, so nothing else changes when it does:

  screen_source(name, text)  → Verdict   prompt injection and jailbreak screening of third-party text
  redact(text)               → str       personal data values replaced by their kind, e.g. [EMAIL_ADDRESS]

Modes (`NOX_SHIELD`): `off` (default for local and tests), `monitor` (record, block nothing) and `enforce`
(block on a finding). Shield fails open with a trace: when the screening service isn't there, the verdict says
`screened: false` and the caller carries on, so availability wins and the gap is visible.
Redaction always runs: the regexes below are the offline fallback that Sensitive Data Protection extends.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field

from ..core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class Finding:
    category: str
    confidence: str = "medium"
    source: str = ""
    excerpt_sha: str = ""
    location: str = ""


@dataclass
class Verdict:
    blocked: bool = False
    findings: list[Finding] = field(default_factory=list)
    screened: bool = False

    @property
    def reason(self) -> str:
        kinds = sorted({f.category.replace("_", " ").lower() for f in self.findings}) or ["unsafe content"]
        return f"NoX Shield withheld this: possible {' and '.join(kinds)}."


def mode() -> str:
    m = (settings.NOX_SHIELD or "off").strip().lower()
    return m if m in ("off", "monitor", "enforce") else "off"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


async def screen_source(name: str, text: str, *, kb_id: str | None = None) -> Verdict:
    """Screen third-party text (a document, a capture's transcript and on-screen text) before a prompt sees it."""
    if mode() == "off" or not text.strip():
        return Verdict(screened=False)
    # Model Armor (CP14 Part B) plugs in here. Until then: fail open, and say so in the log.
    logger.warning(f"shield: no screening service configured; {name} passed unscreened (NOX_SHIELD={mode()})")
    return Verdict(screened=False)


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch) * (2 if i % 2 else 1)
        total += n - 9 if n > 9 else n
    return total % 10 == 0


_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_CARD = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
_PHONE = re.compile(r"\+\d[\d ().-]{7,}\d|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b")


def redact(text: str) -> str:
    """Personal data values out, their kind in: what prompts, Git and the UI see of a capture's words."""
    text = _EMAIL.sub("[EMAIL_ADDRESS]", text)
    text = _CARD.sub(lambda m: "[CREDIT_CARD_NUMBER]" if _luhn(re.sub(r"\D", "", m.group(0))) else m.group(0), text)
    return _PHONE.sub("[PHONE_NUMBER]", text)
