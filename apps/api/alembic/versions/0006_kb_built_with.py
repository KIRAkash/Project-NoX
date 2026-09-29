"""knowledge_bases.built_with: where the current pages were generated ('cloud:<model>' or 'local:<model>')

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0006'
down_revision: str | Sequence[str] | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('knowledge_bases', sa.Column('built_with', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('knowledge_bases', 'built_with')
