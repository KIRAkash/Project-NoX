"""Reverse verification: each seat checks its own file's checklist, developer first, business last.

The checklist lives in the file itself, under "## Verification checklist". An item has a verdict, some evidence
and a note, all written back into the Markdown so the file in Git is the record:

    - [x] Accounts lock after five failed attempts
      - Evidence: [CI run 4812](https://ci.example/4812)
      - Evidence: [[media:0b1e…]]
      - Note: checked on staging with a test account
    - [ ] Support can unlock from the admin page
      - Verdict: failed
      - Evidence: Metric: unlock tickets per week = 42
      - Note: the button is missing

`[x]` means verified. An unticked item is undecided unless a `Verdict:` line says `failed` or `cannot verify`.
"""

import re
import uuid

from ..db.models import Role
from .templates import VERIFY_HEADING

VERIFY_ORDER: list[Role] = [Role.developer, Role.engineering, Role.product, Role.business]

VERDICTS = ("verified", "failed", "cant")
MAX_EVIDENCE = 5
_VERDICT_WORDS = {"failed": "failed", "cannot verify": "cant", "can't verify": "cant"}
_WORD_OF = {"failed": "failed", "cant": "cannot verify"}

_ITEM = re.compile(r"^[-*]\s+\[([ xX])\]\s+(.+?)\s*$")
_SUB = re.compile(r"^\s{2,}[-*]\s+(Note|Verdict|Evidence):\s*(.*?)\s*$")
_LINK = re.compile(r"^\[([^\]]+)\]\((https?://[^)\s]+)\)$")
_MEDIA = re.compile(r"^\[\[media:([0-9a-fA-F-]{36})\]\]$")
_METRIC = re.compile(r"^Metric:\s*(.+?)\s*=\s*(.+)$")
_HEADING = re.compile(rf"^{re.escape(VERIFY_HEADING)}\s*$", re.M | re.I)


def _section(markdown: str) -> tuple[int, int] | None:
    """(start, end) character offsets of the checklist body, or None when the file has no checklist."""
    m = _HEADING.search(markdown)
    if not m:
        return None
    nxt = re.search(r"^#{1,2}\s", markdown[m.end():], re.M)
    return m.end(), (m.end() + nxt.start()) if nxt else len(markdown)


def _one_line(text: str) -> str:
    return " ".join(str(text).split())


def parse_evidence(text: str) -> dict:
    """One `Evidence:` line back into an evidence dict: link, capture, metric, or plain note."""
    if m := _LINK.match(text):
        return {"type": "link", "label": m.group(1), "url": m.group(2)}
    if m := _MEDIA.match(text):
        return {"type": "capture", "mediaId": m.group(1).lower()}
    if m := _METRIC.match(text):
        return {"type": "metric", "name": m.group(1), "value": m.group(2)}
    return {"type": "note", "text": text}


def render_evidence(e: dict) -> str:
    match e.get("type"):
        case "link":
            return f"[{_one_line(e['label']).replace(']', ')')}]({e['url']})"
        case "capture":
            return f"[[media:{e['mediaId']}]]"
        case "metric":
            return f"Metric: {_one_line(e['name'])} = {_one_line(e['value'])}"
        case _:
            return _one_line(e.get("text", ""))


def clean_evidence(raw: list[dict]) -> list[dict]:
    """Validate what a person attached. Raises ValueError with a sentence that can be shown as is."""
    out: list[dict] = []
    for e in raw[:MAX_EVIDENCE + 1]:
        kind = e.get("type")
        if kind == "link":
            url = str(e.get("url", "")).strip()
            if not re.fullmatch(r"https?://[^\s)]+", url):
                raise ValueError("A link must start with http:// or https://")
            out.append({"type": "link", "label": _one_line(e.get("label") or url)[:80], "url": url})
        elif kind == "capture":
            try:
                out.append({"type": "capture", "mediaId": str(uuid.UUID(str(e.get("mediaId"))))})
            except ValueError:
                raise ValueError("That capture isn't valid") from None
        elif kind == "metric":
            name, value = _one_line(e.get("name", ""))[:60], _one_line(e.get("value", ""))[:60]
            if not name or not value:
                raise ValueError("A metric needs a name and a value")
            out.append({"type": "metric", "name": name, "value": value})
        elif kind == "note":
            text = _one_line(e.get("text", ""))[:500]
            if not text:
                raise ValueError("A note can't be empty")
            out.append({"type": "note", "text": text})
        else:
            raise ValueError("Unknown kind of evidence")
    if len(out) > MAX_EVIDENCE:
        raise ValueError(f"Up to {MAX_EVIDENCE} pieces of evidence per item")
    return out


def norm_item(it: dict) -> dict:
    """An item with `checked` and `verdict` in agreement. Older items only carry `checked`."""
    verdict = it.get("verdict") or ("verified" if it.get("checked") else None)
    out = {**it, "verdict": verdict, "checked": verdict == "verified", "evidence": list(it.get("evidence") or []), "note": it.get("note") or None}
    if not out.get("recheck"):
        out.pop("recheck", None)
    return out


def parse_checklist(markdown: str) -> list[dict]:
    span = _section(markdown)
    if not span:
        return []
    items: list[dict] = []
    for line in markdown[span[0]:span[1]].splitlines():
        if item := _ITEM.match(line):
            items.append({"text": item.group(2), "checked": item.group(1) != " ", "verdict": "verified" if item.group(1) != " " else None, "note": None, "evidence": []})
        elif (sub := _SUB.match(line)) and items:
            kind, value = sub.group(1), sub.group(2)
            if kind == "Note":
                items[-1]["note"] = value or None
            elif kind == "Verdict":
                v = _VERDICT_WORDS.get(value.lower())
                if v and not items[-1]["checked"]:
                    items[-1]["verdict"] = v
            elif value:
                items[-1]["evidence"].append(parse_evidence(value))
    return items


def write_checklist(markdown: str, items: list[dict]) -> str:
    """Rewrite the checklist section with the given verdicts, evidence and notes; everything else stays as it was."""
    span = _section(markdown)
    lines = []
    for raw in items:
        it = norm_item(raw)
        lines.append(f"- [{'x' if it['checked'] else ' '}] {it['text']}")
        if it["verdict"] in _WORD_OF:
            lines.append(f"  - Verdict: {_WORD_OF[it['verdict']]}")
        lines.extend(f"  - Evidence: {render_evidence(e)}" for e in it["evidence"])
        if note := (it["note"] or "").strip():
            lines.append(f"  - Note: {' '.join(note.splitlines())}")
    body = "\n" + "\n".join(lines) + "\n"
    if not span:
        return markdown.rstrip() + f"\n\n{VERIFY_HEADING}{body}"
    start, end = span
    rest = markdown[end:]
    return markdown[:start] + body + ("\n" + rest if rest else "")


def update_kind(items: list[dict]) -> str:
    """What an update is called, from the items: partial when some passed and some didn't, else rework."""
    done = sum(norm_item(i)["verdict"] == "verified" for i in items)
    return "partial" if 0 < done < len(items) else "rework"


def failing(items: list[dict]) -> list[dict]:
    """The items a send-back is about: those marked failed, or when none are marked, everything not yet verified."""
    normed = [norm_item(i) for i in items]
    marked = [i for i in normed if i["verdict"] == "failed"]
    return marked or [i for i in normed if i["verdict"] != "verified"]


def next_verifier(role: Role) -> Role | None:
    i = VERIFY_ORDER.index(role)
    return VERIFY_ORDER[i + 1] if i + 1 < len(VERIFY_ORDER) else None
