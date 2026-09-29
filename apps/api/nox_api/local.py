"""NoX Local: build and maintain an application's knowledge base on the developer's machine, with Gemma.

    python -m nox_api.local build --path <repo> --app <name>       map the repo and write every page
    python -m nox_api.local sync  --path <repo>                     update pages for commits since the last build/sync

The same agents NoX runs in the cloud (ai/agents/kb_builder.py, the gatekeeper, the patch compiler), with
NOX_AI_BACKEND=local: Gemma through Ollama. The repo is read straight from disk, every checkpoint stays in the
repo's .nox/ folder, and the finished Markdown lands in .nox/kb/. Nothing leaves the machine; `nox kb push`
sends only that Markdown to NoX, which lints it, indexes it for search and opens the KB pull request.

The `nox` CLI runs this for you (`nox kb build`, `nox kb sync`, `nox kb watch`). Prints one JSON line last.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

SKIP_DIRS = {".git", ".nox", "node_modules", "dist", "build", ".next", "__pycache__", ".venv", "venv", "target", "vendor", "coverage"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "poetry.lock", "Pipfile.lock", "composer.lock", "Cargo.lock", "pnpm-lock.yaml", "bun.lockb", "uv.lock"}
TEXT_EXT = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".go", ".java", ".kt", ".rb", ".rs", ".cs", ".php", ".scala", ".swift",
            ".proto", ".graphql", ".sql", ".yaml", ".yml", ".toml", ".json", ".md", ".txt", ".sh", ".tf", ".ini", ".cfg", ".env.example",
            ".html", ".css", ".scss", ".vue", ".svelte", ".c", ".h", ".cpp", ".hpp", ".xml", ".gradle", ".dockerfile"}
MAX_FILE_BYTES = 120_000


def _git(repo: Path, *args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def _wanted(rel: str) -> bool:
    parts = rel.split("/")
    if any(p in SKIP_DIRS for p in parts[:-1]) or parts[-1] in SKIP_FILES:
        return False
    name = parts[-1].lower()
    return name in ("dockerfile", "makefile", "readme") or any(name.endswith(ext) for ext in TEXT_EXT)


def _priority(rel: str) -> tuple:
    """README and docs first, then source, then config; shallow before deep."""
    low = rel.lower()
    rank = 0 if low.startswith("readme") else 1 if low.startswith("docs/") else 2 if "/" in low and not low.endswith((".json", ".yaml", ".yml", ".toml")) else 3
    return (rank, low.count("/"), low)


def read_repo(repo: Path, max_files: int) -> tuple[str, int]:
    """The repo as one snapshot in the connectors' format; git-tracked files when it's a git repo."""
    listed = _git(repo, "ls-files").splitlines()
    if not listed:
        listed = [str(p.relative_to(repo)) for p in repo.rglob("*") if p.is_file()]
    files = sorted((f for f in listed if _wanted(f)), key=_priority)[:max_files]
    out = [f"=== SOURCE: local:{repo.name} ==="]
    for rel in files:
        path = repo / rel
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if len(data) > MAX_FILE_BYTES or b"\x00" in data[:4096]:
            continue
        out.append(f"--- FILE: {rel} ---\n{data.decode('utf-8', errors='replace')}")
    return "\n\n".join(out) + "\n", len(out) - 1


def _setup(repo: Path) -> SimpleNamespace:
    """Point NoX at Gemma and keep every checkpoint inside the repo."""
    from .core.config import settings
    from .services import local_storage

    settings.NOX_AI_BACKEND = "local"
    settings.AI_MODE = "local"
    settings.NOX_EMBEDDINGS = False
    settings.STORAGE_BACKEND = "local"
    if os.environ.get("NOX_LOCAL_MODEL"):
        settings.NOX_LOCAL_MODEL = os.environ["NOX_LOCAL_MODEL"]
    cache = repo / ".nox" / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    local_storage.LOCAL_STORAGE_DIR = str(cache)
    kb_dir = repo / ".nox" / "kb"
    kb_dir.mkdir(parents=True, exist_ok=True)
    ignore = repo / ".nox" / ".gitignore"
    if not ignore.exists():
        ignore.write_text("cache/\n")
    return SimpleNamespace(cache=cache, kb=kb_dir, manifest=kb_dir / "nox-kb.json", model=settings.NOX_LOCAL_MODEL)


def _write_kb(kb_dir: Path, files: dict[str, str]) -> list[str]:
    written = []
    for path, md in files.items():
        if path.startswith(".") and not path.startswith(".nox/"):
            continue
        target = kb_dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(md)
        written.append(path)
    return sorted(written)


def _read_kb(kb_dir: Path) -> dict[str, str]:
    return {str(p.relative_to(kb_dir)): p.read_text() for p in kb_dir.rglob("*.md")}


async def build(repo: Path, app: str, max_files: int) -> dict:
    from .ai import telemetry
    from .ai.agents import kb_builder
    from .services.local_storage import clear_kb_checkpoints, upload_content

    env = _setup(repo)
    raw, n = read_repo(repo, max_files)
    kb_id = f"local-{app}"
    clear_kb_checkpoints(kb_id)  # a build starts fresh; `sync` is the incremental path
    upload_content(kb_id, "raw_ingest.txt", raw)
    head = _git(repo, "rev-parse", "HEAD").strip()
    ctx = SimpleNamespace(kb_id=kb_id, app_name=app, org_slug="local", candidate_contracts=[], commit_sha=head[:7])

    async def log(kind: str, payload: dict) -> None:
        if payload.get("message"):
            print(f"· {payload['message']}", file=sys.stderr, flush=True)

    print(f"· Reading {n} files from {repo} with {env.model} (nothing leaves this machine)", file=sys.stderr, flush=True)
    with telemetry.usage_scope("local-build") as usage:
        files, amap = await kb_builder.build(ctx, raw, log=log, local=True)
    written = _write_kb(env.kb, files)
    manifest = {"app": app, "model": env.model, "commit": head, "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "mode": "build", "pages": written, "interfaces": [i.model_dump() for i in amap.interfaces]}
    env.manifest.write_text(json.dumps(manifest, indent=2))
    return {"ok": True, "app": app, "kb_dir": str(env.kb), "pages": len(written), "files_read": n, "model": env.model,
            "usage": usage.line()}


async def sync(repo: Path, since: str | None) -> dict:
    from .agents.compiler import run_patch_compiler
    from .agents.gatekeeper import run_gatekeeper
    from .ai import telemetry

    env = _setup(repo)
    if not env.manifest.exists():
        return {"ok": False, "error": "No local knowledge base yet: run `nox kb build` first."}
    manifest = json.loads(env.manifest.read_text())
    base = since or manifest.get("commit")
    head = _git(repo, "rev-parse", "HEAD").strip()
    if not base or base == head:
        return {"ok": True, "decision": "none", "changed": [], "note": "Already up to date."}
    diff = _git(repo, "diff", f"{base}..{head}", "--", ".", ":(exclude).nox")
    if not diff.strip():
        manifest["commit"] = head
        env.manifest.write_text(json.dumps(manifest, indent=2))
        return {"ok": True, "decision": "none", "changed": []}

    kb_files = _read_kb(env.kb)
    with telemetry.usage_scope("local-sync") as usage:
        decision = await run_gatekeeper(diff, kb_files=kb_files, local=True)
        changed: list[str] = []
        if decision["decision"] == "significant":
            ctx = SimpleNamespace(kb_id=f"local-{manifest['app']}", app_name=manifest["app"], org_slug="local",
                                  ingested_content=diff, commit_sha=head[:7])
            updated = await run_patch_compiler(ctx, decision.get("affected_files") or [])
            changed = _write_kb(env.kb, updated)
    manifest.update({"commit": head, "synced_at": datetime.now(UTC).isoformat(timespec="seconds"), "mode": "sync",
                     "last_changed": changed})
    env.manifest.write_text(json.dumps(manifest, indent=2))
    return {"ok": True, "decision": decision["decision"], "reason": decision.get("reason"), "changed": changed,
            "fast_path": decision.get("fast_path", False), "usage": usage.line()}


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m nox_api.local", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--path", default=".")
    b.add_argument("--app", required=True)
    b.add_argument("--max-files", type=int, default=150)
    s = sub.add_parser("sync")
    s.add_argument("--path", default=".")
    s.add_argument("--since")
    args = ap.parse_args()
    repo = Path(args.path).resolve()
    t = time.monotonic()
    try:
        result = asyncio.run(build(repo, args.app, args.max_files) if args.cmd == "build" else sync(repo, args.since))
    except Exception as e:
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    result["seconds"] = round(time.monotonic() - t, 1)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
