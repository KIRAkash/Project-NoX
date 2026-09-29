"""Knowledge bases as Open Knowledge Format bundles.

Every knowledge base NoX writes is an OKF bundle (Google Cloud's Open Knowledge Format, v0.2:
https://github.com/GoogleCloudPlatform/open-knowledge-format), so any OKF-aware agent or tool can read it:

- every page carries YAML frontmatter with a `type`, plus `title`, `description`, `resource`, `tags`,
  `sources` (the code files its anchors point at) and `generated` (who wrote it, and when it last changed);
- every folder has an `index.md` listing its pages with their descriptions, using bundle-absolute links;
- the root `index.md` declares `okf_version` and ends with a contents section linking the folder indexes;
- `log.md` is OKF's date-grouped change log, newest first.

NoX extends OKF for knowledge that spans applications: pages link with `[[wikilinks]]` and cross-application
`[[kb:other-app/page]]` links, and the root index keeps the application's architectural overview above the
contents. OKF consumers tolerate both (unknown link targets are not errors).

`to_okf()` runs on the files about to be committed, after pinned corrections are applied. Pages that aren't
in that set keep their headers, so an unchanged page's `generated.at` never moves.

    python -m nox_api.agents.okf check <kb-id>        conformance report for a knowledge base's stored pages
    python -m nox_api.agents.okf backfill <kb-id>|--all   convert stored pages in place (no Git writes)
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

import yaml

OKF_VERSION = "0.2"
RESERVED = {"index.md", "log.md"}

# Page type per top-level folder. OKF doesn't register type values; these are NoX's.
TYPE_BY_FOLDER = {
    "summaries": "Interface Reference",
    "entities": "Component",
    "concepts": "Concept",
    "decisions": "Architecture Decision",
}
TYPE_BY_PATH = {"AGENTS.md": "Agent Guide", ".nox/brief.md": "Agent Brief"}
FOLDER_TITLE = {
    "summaries": ("Interfaces and references", "API, event and module references for the application."),
    "entities": ("Components and data models", "One page per significant component and core data model."),
    "concepts": ("Concepts and flows", "Flows, lifecycles and cross-cutting mechanisms."),
    "decisions": ("Architecture decisions", "One ADR per architecture decision the code or documents make evident."),
}

_FM = re.compile(r"\A---\n(.*?)\n---\n?", re.S)
_ANCHOR = re.compile(r"<!--\s*anchor:\s*([^:\s]+):L\d+")
_CONTENTS = re.compile(r"\n*<!-- okf:contents -->.*?<!-- /okf:contents -->\n?", re.S)


def now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Frontmatter ──────────────────────────────────────────────────────────────


def split(markdown: str) -> tuple[dict, str]:
    """(frontmatter, body). Unparseable frontmatter is treated as body text."""
    m = _FM.match(markdown or "")
    if not m:
        return {}, markdown or ""
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}, markdown
    return (meta if isinstance(meta, dict) else {}), markdown[m.end():]


def strip(markdown: str) -> str:
    """The page without its frontmatter, for readers that only want the prose."""
    return split(markdown)[1]


def prose(markdown: str) -> str:
    """The page's own writing: no frontmatter, and no generated contents section."""
    return _CONTENTS.sub("\n", strip(markdown)).rstrip() + "\n"


def join(meta: dict, body: str) -> str:
    head = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=1000).strip()
    return f"---\n{head}\n---\n\n{body.lstrip()}"


def _title(path: str, body: str) -> str:
    m = re.search(r"^#\s+(.+?)\s*$", body, re.M)
    if m:
        return re.sub(r"[*_`]", "", m.group(1)).strip()
    return path.rsplit("/", 1)[-1].removesuffix(".md").replace("-", " ").capitalize()


def _description(body: str) -> str:
    """The first sentence of the first paragraph of prose."""
    for block in re.split(r"\n\s*\n", re.sub(r"<!--.*?-->", "", body, flags=re.S)):
        text = block.strip()
        if not text or text.startswith(("#", "|", "```", "-", "*", ">", "<", "[")) or re.match(r"^\d+\.", text):
            continue
        text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
        text = re.sub(r"\[\[(?:kb:)?([^\]]+)\]\]", lambda m: m.group(1).rsplit("/", 1)[-1], text)
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        text = re.sub(r"[*_`]", "", " ".join(text.split()))
        sentence = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
        return sentence if len(sentence) <= 240 else sentence[:237].rstrip() + "…"
    return ""


def page_type(path: str) -> str:
    if path in TYPE_BY_PATH:
        return TYPE_BY_PATH[path]
    return TYPE_BY_FOLDER.get(path.split("/", 1)[0] if "/" in path else "", "Page")


def header(path: str, body: str, *, app: str, repo_url: str | None, actor: str, at: str, keep: dict | None = None,
           source_repo: str | None = None) -> dict:
    """OKF frontmatter for one page. Unknown keys already on the page are kept, as the spec asks."""
    folder = path.split("/", 1)[0] if "/" in path else ""
    meta: dict = {"type": page_type(path), "title": _title(path, body)}
    if desc := _description(body):
        meta["description"] = desc
    meta["resource"] = f"{repo_url.rstrip('/')}/blob/main/{path}" if repo_url else f"/{path}"
    meta["tags"] = [t for t in (app, folder) if t]
    if files := list(dict.fromkeys(_ANCHOR.findall(body))):
        base = f"{source_repo.rstrip('/')}/blob/HEAD/" if source_repo else ""
        meta["sources"] = [{"resource": f"{base}{f}"} for f in files[:20]]
    meta["generated"] = {"by": actor, "at": at}
    for k, v in (keep or {}).items():
        meta.setdefault(k, v)
    return meta


# ── Indexes and the log ──────────────────────────────────────────────────────


def _folders(files: dict[str, str]) -> list[str]:
    return sorted({p.split("/", 1)[0] for p in files if "/" in p and p.endswith(".md") and not p.startswith(".")})


def folder_index(folder: str, files: dict[str, str]) -> str:
    """OKF §8: the folder's pages, grouped under a heading, each with its description."""
    title, blurb = FOLDER_TITLE.get(folder, (folder.replace("-", " ").capitalize(), ""))
    lines = [f"# {title}", ""]
    if blurb:
        lines += [blurb, ""]
    lines += ["## Pages", ""]
    for path in sorted(p for p in files if p.startswith(f"{folder}/") and p.endswith(".md") and p.rsplit("/", 1)[-1] not in RESERVED):
        meta, body = split(files[path])
        name = meta.get("title") or _title(path, body)
        desc = meta.get("description") or _description(body)
        lines.append(f"- [{name}](/{path})" + (f" — {desc}" if desc else ""))
    return "\n".join(lines).rstrip() + "\n"


def root_index(markdown: str, files: dict[str, str], *, at: str) -> str:
    """The application overview, with OKF's version declaration and a contents section for the folders."""
    meta, body = split(markdown)
    body = _CONTENTS.sub("", body).rstrip()
    lines = ["<!-- okf:contents -->", "", "## Contents", ""]
    for folder in _folders(files):
        title, blurb = FOLDER_TITLE.get(folder, (folder.capitalize(), ""))
        count = sum(1 for p in files if p.startswith(f"{folder}/") and p.rsplit("/", 1)[-1] not in RESERVED)
        lines.append(f"- [{title}](/{folder}/index.md) — {count} page{'s' if count != 1 else ''}." + (f" {blurb}" if blurb else ""))
    lines += ["- [Change log](/log.md) — every generation and sync, newest first.", "", "<!-- /okf:contents -->"]
    meta = {"okf_version": OKF_VERSION, "title": meta.get("title") or _title("index.md", body), **{k: v for k, v in meta.items() if k not in ("okf_version", "title")}}
    if desc := _description(body):
        meta.setdefault("description", desc)
    meta.setdefault("generated", {"at": at})
    return join(meta, body + "\n\n" + "\n".join(lines) + "\n")


def new_log(app: str, summary: str, details: list[str] | None = None, *, kind: str = "Creation") -> str:
    return append_log(f"# Change log: {app}\n", summary, details, kind=kind)


def append_log(log: str, summary: str, details: list[str] | None = None, *, kind: str = "Update") -> str:
    """OKF §9: entries grouped under `## YYYY-MM-DD` headings, newest first."""
    log = normalize_log(log)
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    entry = f"- **{kind}** {summary}" + "".join(f"\n  - {d}" for d in (details or []))
    title_end = log.find("\n") + 1 if log.startswith("# ") else 0
    head, rest = log[:title_end], log[title_end:].lstrip("\n")
    if rest.startswith(f"## {day}\n"):
        rest = rest.replace(f"## {day}\n\n", f"## {day}\n\n{entry}\n", 1) if rest.startswith(f"## {day}\n\n") else rest.replace(f"## {day}\n", f"## {day}\n\n{entry}\n", 1)
    else:
        rest = f"## {day}\n\n{entry}\n\n" + rest
    return (head or "# Change log\n") + "\n" + rest.rstrip() + "\n"


def normalize_log(log: str) -> str:
    """Convert NoX's earlier table and `## [date time] action | summary` logs into OKF's date-grouped form."""
    if not log or not ("| Date (UTC) |" in log or re.search(r"^## \[\d{4}-\d{2}-\d{2}", log, re.M)):
        return log or "# Change log\n"
    entries: list[tuple[str, str]] = []
    for m in re.finditer(r"^\|\s*(\d{4}-\d{2}-\d{2})[^|]*\|\s*([^|]*?)\s*\|[^|]*\|\s*([^|]*?)\s*\|", log, re.M):
        entries.append((m.group(1), f"- **Creation** {m.group(2)}: {m.group(3)}"))
    for m in re.finditer(r"^## \[(\d{4}-\d{2}-\d{2})[^\]]*\]\s*([^|\n]*?)\s*\|\s*(.*?)\n((?:- .*\n?)*)", log, re.M):
        details = "".join(f"\n  {d}" for d in m.group(4).strip().splitlines() if d.strip())
        entries.append((m.group(1), f"- **Update** {m.group(3)} ({m.group(2).strip()}){details}"))
    by_day: dict[str, list[str]] = {}
    for day, text in entries:
        by_day.setdefault(day, []).insert(0, text)  # newest first within a day
    out = ["# Change log", ""]
    for day in sorted(by_day, reverse=True):
        out += [f"## {day}", "", *by_day[day], ""]
    return "\n".join(out).rstrip() + "\n"


# ── The bundle ───────────────────────────────────────────────────────────────


def to_okf(files: dict[str, str], *, existing: dict[str, str] | None = None, app: str, repo_url: str | None, actor: str,
           source_repo: str | None = None) -> dict[str, str]:
    """The files to commit, as OKF: headers on these pages, plus any folder index or root index they change.

    `existing` is the whole knowledge base as last stored (for the indexes); pages not in `files` are untouched.
    """
    at = now()
    out: dict[str, str] = {}
    for path, content in files.items():
        if not path.endswith(".md") or path.startswith("missions/"):
            out[path] = content
            continue
        name = path.rsplit("/", 1)[-1]
        if name == "log.md":
            out[path] = normalize_log(content)
        elif name == "index.md":
            out[path] = content  # rebuilt below
        else:
            old, body = split(content)
            keep = {k: v for k, v in old.items() if k not in ("type", "title", "description", "resource", "tags", "sources", "generated")}
            out[path] = join(header(path, body, app=app, repo_url=repo_url, actor=actor, at=at, keep=keep, source_repo=source_repo), body)

    merged = {**(existing or {}), **out}
    for folder in _folders(merged):
        idx = f"{folder}/index.md"
        page = folder_index(folder, merged)
        if (existing or {}).get(idx) != page or idx in files:
            out[idx] = merged[idx] = page
    if "index.md" in merged:
        page = root_index(merged["index.md"], merged, at=at)
        if strip(page) != strip((existing or {}).get("index.md", "")) or "index.md" in files:
            out["index.md"] = page
    return out


def problems(files: dict[str, str]) -> list[str]:
    """OKF §11 conformance: every non-reserved page has parseable frontmatter with a non-empty `type`."""
    out = []
    for path, content in sorted(files.items()):
        if not path.endswith(".md") or path.startswith("missions/") or path.rsplit("/", 1)[-1] in RESERVED:
            continue
        meta, _ = split(content)
        if not meta:
            out.append(f"{path}: no YAML frontmatter")
        elif not str(meta.get("type") or "").strip():
            out.append(f"{path}: frontmatter has no `type`")
    return out


def source_repo_of(kb) -> str | None:
    """The application's GitHub repository, where its pages' source anchors point."""
    for src in kb.source_urls or []:
        if isinstance(src, dict) and src.get("type") == "github" and src.get("url"):
            return str(src["url"]).removesuffix(".git").rstrip("/")
    return None


# ── CLI ──────────────────────────────────────────────────────────────────────


def _main() -> None:
    import asyncio
    import sys

    from sqlalchemy import select

    from ..ai import config
    from ..db.database import AsyncSessionLocal
    from ..db.models import KnowledgeBase
    from ..services.local_storage import load_checkpoint_json, save_checkpoint_json

    if len(sys.argv) < 3 or sys.argv[1] not in ("check", "backfill"):
        raise SystemExit("usage: python -m nox_api.agents.okf check|backfill <kb-id>|--all")

    async def run() -> None:
        async with AsyncSessionLocal() as db:
            q = select(KnowledgeBase) if sys.argv[2] == "--all" else select(KnowledgeBase).where(KnowledgeBase.id == sys.argv[2])
            for kb in (await db.execute(q)).scalars().all():
                files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
                if not files:
                    continue
                if sys.argv[1] == "backfill":
                    actor = f"nox/{(kb.built_with or '').removeprefix('local:') or config.model_name()}"
                    files = {**files, **to_okf(files, existing={}, app=kb.app_name, repo_url=kb.git_repo_url, actor=actor,
                                               source_repo=source_repo_of(kb))}
                    save_checkpoint_json(str(kb.id), "compiled_files.json", files)
                bad = problems(files)
                pages = sum(1 for p in files if p.endswith(".md") and not p.startswith("missions/"))
                print(f"{kb.app_name}: {'OKF ' + OKF_VERSION + ' conformant' if not bad else f'{len(bad)} problems'} ({pages} pages)")
                for b in bad[:10]:
                    print(f"  - {b}")

    asyncio.run(run())


if __name__ == "__main__":
    _main()
