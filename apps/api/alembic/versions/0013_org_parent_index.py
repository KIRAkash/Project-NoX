"""index orgs.parent_org_id for recursive hierarchy traversal

Revision ID: 0013
Revises: 0012
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(op.f("ix_orgs_parent_org_id"), "orgs", ["parent_org_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_orgs_parent_org_id"), table_name="orgs")
