import logging
import re

from pydantic import BaseModel

logger = logging.getLogger(__name__)

class CodeAnchor(BaseModel):
    kb_file: str
    source_file: str
    line_start: int
    line_end: int
    commit_sha: str | None = None

class AnchorIntersection(BaseModel):
    anchor: CodeAnchor
    kb_file: str
    source_file: str
    reason: str


def generate_anchor_tag(source_file: str, line_start: int, line_end: int, commit_sha: str = "") -> str:
    """Format an HTML anchor comment for embedding in Markdown documents."""
    sha_part = f" sha:{commit_sha}" if commit_sha else ""
    return f"<!-- anchor: {source_file}:L{line_start}-L{line_end}{sha_part} -->"


def extract_anchors_from_kb(kb_files: dict[str, str]) -> list[CodeAnchor]:
    """Extract all code anchor tags embedded in the knowledge base markdown files."""
    anchors = []
    # Pattern matching: <!-- anchor: path/to/file.py:L10-L50 sha:abc1234 -->
    pattern = re.compile(
        r'<!--\s*anchor:\s*([^:\s]+):L?(\d+)-L?(\d+)(?:\s+sha:([a-fA-F0-9]+))?\s*-->'
    )

    for kb_path, content in kb_files.items():
        matches = pattern.findall(content)
        for source_file, l_start, l_end, sha in matches:
            anchors.append(
                CodeAnchor(
                    kb_file=kb_path,
                    source_file=source_file.strip(),
                    line_start=int(l_start),
                    line_end=int(l_end),
                    commit_sha=sha if sha else None,
                )
            )
    return anchors


def parse_git_diff_hunks(diff_text: str) -> dict[str, list[tuple[int, int]]]:
    """Parse unified git diff headers into modified line ranges per source file."""
    modified_ranges: dict[str, list[tuple[int, int]]] = {}
    current_file = None
    
    file_header_pattern = re.compile(r'^\+\+\+\s+(?:b/)?(.*)$')
    hunk_header_pattern = re.compile(r'^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@')

    for line in diff_text.splitlines():
        # Match target file path
        if line.startswith('+++ '):
            m = file_header_pattern.match(line)
            if m:
                path = m.group(1).strip()
                current_file = path if path != '/dev/null' else None
                if current_file and current_file not in modified_ranges:
                    modified_ranges[current_file] = []
            continue

        # Match hunk line ranges: @@ -10,5 +20,8 @@
        if line.startswith('@@ ') and current_file:
            m = hunk_header_pattern.match(line)
            if m:
                start_line = int(m.group(1))
                count = int(m.group(2)) if m.group(2) else 1
                end_line = start_line + max(1, count) - 1
                modified_ranges[current_file].append((start_line, end_line))

    return modified_ranges


def find_intersecting_anchors(
    diff_text: str, kb_files: dict[str, str]
) -> list[AnchorIntersection]:
    """Deterministically check if git diff modifications overlap with any active KB code anchors."""
    anchors = extract_anchors_from_kb(kb_files)
    if not anchors:
        return []

    diff_hunks = parse_git_diff_hunks(diff_text)
    intersections = []

    for anchor in anchors:
        # Match against exact filename or leaf filename
        matching_hunks = []
        for diff_file, hunks in diff_hunks.items():
            if diff_file == anchor.source_file or diff_file.endswith(anchor.source_file) or anchor.source_file.endswith(diff_file):
                matching_hunks.extend(hunks)

        for diff_start, diff_end in matching_hunks:
            # Check interval intersection: [diff_start, diff_end] overlaps with [anchor.line_start, anchor.line_end]
            if max(diff_start, anchor.line_start) <= min(diff_end, anchor.line_end):
                intersections.append(
                    AnchorIntersection(
                        anchor=anchor,
                        kb_file=anchor.kb_file,
                        source_file=anchor.source_file,
                        reason=(
                            f"Code lines {diff_start}-{diff_end} modified in {anchor.source_file} "
                            f"intersect documented range L{anchor.line_start}-L{anchor.line_end} "
                            f"in '{anchor.kb_file}'"
                        ),
                    )
                )
                break  # one intersection per anchor is sufficient

    return intersections
