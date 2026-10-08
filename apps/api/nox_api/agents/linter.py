import logging
import re

from pydantic import BaseModel, Field

from . import okf

logger = logging.getLogger(__name__)

def _reserved(path: str) -> bool:
    """OKF's reserved files (any folder's index.md, and log.md) aren't concept pages."""
    return path.rsplit('/', 1)[-1] in okf.RESERVED


class LintIssue(BaseModel):
    category: str  # 'schema', 'wikilink', 'orphan', 'index', 'stub', 'security'
    severity: str  # 'error', 'warning', 'info'
    file_path: str
    message: str
    line_number: int | None = None

class LintReport(BaseModel):
    is_valid: bool = True
    total_files: int = 0
    errors: list[LintIssue] = Field(default_factory=list)
    warnings: list[LintIssue] = Field(default_factory=list)
    stats: dict[str, int] = Field(default_factory=dict)


def check_schemas(files: dict[str, str]) -> list[LintIssue]:
    """Validate that knowledge-base pages adhere to structural schema requirements."""
    issues = []
    
    # Required sections for specific folders
    schema_rules = {
        'decisions/': ['## Status', '## Context', '## Decision'],
        'entities/': ['## Responsibilities', '## Dependencies'],
    }
    
    for path, content in files.items():
        if _reserved(path):
            continue
        for prefix, required_sections in schema_rules.items():
            if path.startswith(prefix) and path.endswith('.md'):
                for section in required_sections:
                    if section.lower() not in content.lower():
                        issues.append(
                            LintIssue(
                                category='schema',
                                severity='warning',
                                file_path=path,
                                message=f"Missing recommended section header: '{section}'",
                            )
                        )
    return issues


def check_wikilinks(
    files: dict[str, str],
    valid_cross_kb_targets: set[str] | None = None
) -> tuple[list[LintIssue], dict[str, set[str]]]:
    """Verify that all [[wikilinks]] point to existing files (or valid cross-KB repositories) and return inbound link map."""
    issues = []
    
    # Build set of valid link targets (with and without .md extension)
    valid_targets = set()
    for path in files.keys():
        clean_name = path.replace('.md', '')
        valid_targets.add(clean_name)
        valid_targets.add(path)
        valid_targets.add(clean_name.split('/')[-1])
        
    inbound_links: dict[str, set[str]] = {p: set() for p in files.keys()}
    link_pattern = re.compile(r'\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]')

    for path, content in files.items():
        # Strip fenced code blocks and inline code spans to avoid checking code examples
        clean_content = re.sub(r'```[\s\S]*?```', '', content)
        clean_content = re.sub(r'`[^`\n]+`', '', clean_content)
        
        # OKF folder indexes link with standard, bundle-absolute Markdown links: count them as inbound links too
        for target in re.findall(r'\]\(/([^)\s#]+\.md)\)', clean_content):
            if target in inbound_links:
                inbound_links[target].add(path)

        matches = link_pattern.findall(clean_content)
        for target in matches:
            target_clean = target.strip().replace('.md', '')
            
            # Handle Cross-KB Links: [[ap:<repo>/<path>]] or [[kb:<app>/<path>]]
            if target_clean.startswith('ap:') or target_clean.startswith('kb:'):
                prefix_len = 3
                parts = target_clean[prefix_len:].split('/', 1)
                if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                    # Valid cross-KB link format
                    continue
                else:
                    issues.append(
                        LintIssue(
                            category='wikilink',
                            severity='error',
                            file_path=path,
                            message=f"Malformed cross-KB wikilink: '[[{target}]]'. Expected format: [[ap:<repo-name>/<page-path>]].",
                        )
                    )
                continue


            target_leaf = target_clean.split('/')[-1]
            
            matched_file = None
            for p in files.keys():
                p_clean = p.replace('.md', '')
                if p_clean == target_clean or p == target or p_clean.split('/')[-1] == target_leaf:
                    matched_file = p
                    break
                    
            if matched_file:
                inbound_links[matched_file].add(path)
            else:
                issues.append(
                    LintIssue(
                        category='wikilink',
                        severity='error',
                        file_path=path,
                        message=f"Broken wikilink: '[[{target}]]' does not resolve to any page in the knowledge base.",
                    )
                )

    return issues, inbound_links


def check_orphans_and_stubs(files: dict[str, str], inbound_links: dict[str, set[str]]) -> list[LintIssue]:
    """Flag pages with 0 inbound backlinks (excluding root files) or under-specified stub content."""
    issues = []
    exempt_from_orphan_check = {'index.md', 'AGENTS.md', 'log.md', '.nox/brief.md'}

    for path, content in files.items():
        words = content.split()
        if _reserved(path):
            continue
        if len(words) < 25 and path.endswith('.md') and path not in exempt_from_orphan_check:
            issues.append(
                LintIssue(
                    category='stub',
                    severity='warning',
                    file_path=path,
                    message=f'Page is an under-specified stub ({len(words)} words). Minimum recommended is 25 words.',
                )
            )

        if path not in exempt_from_orphan_check and path.endswith('.md'):
            incoming = inbound_links.get(path, set())
            if len(incoming) == 0:
                issues.append(
                    LintIssue(
                        category='orphan',
                        severity='warning',
                        file_path=path,
                        message='Orphan page: No other pages contain a [[wikilink]] pointing to this page.',
                    )
                )

    return issues


def check_index_coverage(files: dict[str, str]) -> list[LintIssue]:
    """Ensure every content markdown file is referenced in index.md."""
    issues = []
    index_content = files.get('index.md', '')
    exempt_from_index = {'index.md', 'AGENTS.md', 'log.md', '.nox/brief.md'}

    for path in files.keys():
        if path not in exempt_from_index and path.endswith('.md') and not _reserved(path):
            slug = path.replace('.md', '')
            leaf = slug.split('/')[-1]
            folder_index = files.get(f"{path.split('/', 1)[0]}/index.md", '') if '/' in path else ''
            if slug not in index_content and leaf not in index_content and f"(/{path})" not in folder_index:
                issues.append(
                    LintIssue(
                        category='index',
                        severity='warning',
                        file_path=path,
                        message="Page is missing from 'index.md' navigation overview.",
                    )
                )

    return issues


# (pattern, label, kind). A pattern with a `value` group redacts only that group; otherwise the whole match.
SECRET_PATTERNS = [
    (r'-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----', 'Private Key block detected', 'private_key'),
    (r'(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}', 'GitHub Personal Access Token detected', 'github_token'),
    (r'sk-[a-zA-Z0-9]{32,}', 'API Secret Key pattern detected', 'api_key'),
    (r'AIza[0-9A-Za-z-_]{35}', 'Google API Key detected', 'google_api_key'),
    # Vendor-style tokens: a short prefix, an underscore, then 24+ letters and digits (e.g. xyz_live_9f3b…).
    (r'\b[A-Za-z][A-Za-z0-9]{1,15}_(?:live_|test_)?(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{24,}\b',
     'Prefixed API token detected', 'api_token'),
    # A value assigned to something named like a secret: api_key = "…", "password": "…".
    (r'(?i)(?:api[_-]?key|secret|token|passw(?:or)?d)["\'`]?\s*[:=]\s*["\'`](?P<value>[^"\'`\s]{12,})["\'`]',
     'Secret assignment detected', 'secret_assignment'),
]
WITHHELD_SECRET = "[NoX Shield withheld a secret]"


def redact_secrets(files: dict[str, str]) -> tuple[dict[str, str], list[tuple[str, str, str]]]:
    """Replace secrets in generated pages with a withheld note, so a key copied from source never reaches a
    knowledge base. Returns the cleaned files and one (path, kind, original text) per redaction."""
    found: list[tuple[str, str, str]] = []
    out = {}
    for path, content in files.items():
        for pattern, _label, kind in SECRET_PATTERNS:
            def swap(m: re.Match, kind=kind, path=path) -> str:
                if "value" in m.re.groupindex:
                    found.append((path, kind, m.group("value")))
                    start, end = m.span("value")
                    return m.group(0)[: start - m.start()] + WITHHELD_SECRET + m.group(0)[end - m.start():]
                found.append((path, kind, m.group(0)))
                return WITHHELD_SECRET
            content = re.sub(pattern, swap, content)
        out[path] = content
    return out, found


def check_secrets_and_pii(files: dict[str, str]) -> list[LintIssue]:
    """Screen generated markdown for accidental leakage of API keys, private keys, or passwords."""
    issues = []
    patterns = [(p, label) for p, label, _ in SECRET_PATTERNS]

    for path, content in files.items():
        for pattern, label in patterns:
            if re.search(pattern, content):
                issues.append(
                    LintIssue(
                        category='security',
                        severity='error',
                        file_path=path,
                        message=f'Security alert: {label}',
                    )
                )

    return issues


def run_linter(files: dict[str, str], plan: list | None = None) -> LintReport:
    """Run all deterministic quality gates across the knowledge base files."""
    report = LintReport(total_files=len(files))
    
    schema_issues = check_schemas(files)
    wikilink_issues, inbound_links = check_wikilinks(files)
    orphan_stub_issues = check_orphans_and_stubs(files, inbound_links)
    index_issues = check_index_coverage(files)
    security_issues = check_secrets_and_pii(files)
    
    all_issues = schema_issues + wikilink_issues + orphan_stub_issues + index_issues + security_issues
    
    for issue in all_issues:
        if issue.severity == 'error':
            report.errors.append(issue)
        else:
            report.warnings.append(issue)
            
    report.is_valid = len(report.errors) == 0
    report.stats = {
        'total_files': len(files),
        'total_errors': len(report.errors),
        'total_warnings': len(report.warnings),
        'total_wikilinks': sum(len(links) for links in inbound_links.values()),
        # Open Knowledge Format: pages still missing frontmatter or a `type` (headers are added at commit time)
        'okf_problems': len(okf.problems(files)),
    }
    
    return report


class SecretLeakError(RuntimeError):
    """Generated KB content contains something that looks like a credential; nothing was committed."""


def assert_no_secrets(files: dict[str, str]) -> None:
    """Refuse to commit KB content that trips the secret/PII screen: the regexes always (offline and NoX Local),
    then NoX Shield's Sensitive Data Protection check when Shield is on (services/shield.py)."""
    leaks = [i for i in check_secrets_and_pii(files) if i.severity == "error"]
    if leaks:
        where = ", ".join(sorted({i.file_path for i in leaks})[:5])
        raise SecretLeakError(f"Blocked commit: possible secrets in {where} ({leaks[0].message})")
    from ..services import shield

    shield.assert_pages_clean(files)


def lint_summary_markdown(report: LintReport, max_items: int = 8) -> str:
    """A short 'Quality gate' section for PR bodies."""
    icon = "✅" if report.is_valid else "⚠️"
    lines = [
        "",
        "---",
        f"### {icon} Quality gate",
        f"{report.total_files} pages · {len(report.errors)} errors · {len(report.warnings)} warnings",
    ]
    if 'okf_problems' in report.stats:
        missing = report.stats['okf_problems']
        lines.append(f"Open Knowledge Format {okf.OKF_VERSION}: " + ("conformant bundle" if not missing else f"{missing} pages without OKF frontmatter"))
    for issue in (report.errors + report.warnings)[:max_items]:
        lines.append(f"- `{issue.file_path}` — {issue.severity}: {issue.message}")
    extra = len(report.errors) + len(report.warnings) - max_items
    if extra > 0:
        lines.append(f"- …and {extra} more")
    return "\n".join(lines)
