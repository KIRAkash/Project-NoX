import logging
import re

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class Constraint(BaseModel):
    id: str
    source_file: str
    rule_text: str
    keywords: list[str] = Field(default_factory=list)
    category: str = "architecture"

class ConstraintViolation(BaseModel):
    constraint_id: str
    source_file: str
    rule_text: str
    violation_context: str
    message: str


def extract_constraints_from_kb(kb_files: dict[str, str]) -> list[Constraint]:
    """Extract active architectural constraints and invariants from decisions/ and concepts/."""
    constraints = []
    modal_verbs = ["must not", "never", "only", "always", "strictly forbidden", "shall not", "do not", "requires", "enforces", "must"]
    
    idx = 1
    for path, content in kb_files.items():
        if (path.startswith('decisions/') or path.startswith('concepts/')) and path.endswith('.md'):
            for line in content.splitlines():
                line_clean = line.strip(' -*#')
                line_lower = line_clean.lower()
                if any(verb in line_lower for verb in modal_verbs) and len(line_clean.split()) >= 4:
                    words = [w.lower() for w in re.findall(r'\w+', line_clean)]
                    constraints.append(
                        Constraint(
                            id=f"C-{idx:03d}",
                            source_file=path,
                            rule_text=line_clean,
                            keywords=words,
                            category="decision" if path.startswith("decisions/") else "concept",
                        )
                    )
                    idx += 1

    return constraints


def evaluate_diff_against_constraints(
    diff_text: str, constraints: list[Constraint]
) -> list[ConstraintViolation]:
    """Evaluate incoming git diff lines against active architectural constraints (<80ms)."""
    violations = []
    
    # Extract added/modified code lines
    added_lines = [
        line[1:].strip()
        for line in diff_text.splitlines()
        if line.startswith('+') and not line.startswith('+++')
    ]
    added_text = ' '.join(added_lines).lower()
    
    if not added_text or not constraints:
        return []

    for c in constraints:
        rule_lower = c.rule_text.lower()
        overlap_keywords = [kw for kw in c.keywords if len(kw) > 3 and kw in added_text]
        
        # High-confidence triggers on negative constraints
        if any(neg in rule_lower for neg in ["never", "forbidden", "must not", "do not"]):
            if len(overlap_keywords) >= 2:
                violations.append(
                    ConstraintViolation(
                        constraint_id=c.id,
                        source_file=c.source_file,
                        rule_text=c.rule_text,
                        violation_context=f"Added code contains matching keywords: {', '.join(overlap_keywords)}",
                        message=f"Architectural Rule Alert: Incoming code may conflict with rule in '{c.source_file}': '{c.rule_text}'",
                    )
                )

    return violations
