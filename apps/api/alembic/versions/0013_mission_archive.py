"""mission archive: board triage can archive missions off active lanes and unarchive them

Revision ID: 0013
Revises: 0012
"""
from typing import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0013'
down_revision: str | Sequence[str] | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('missions', sa.Column('archived_at', sa.DateTime(), nullable=True))
    op.add_column('missions', sa.Column('archived_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))


def downgrade() -> None:
    op.drop_column('missions', 'archived_by')
    op.drop_column('missions', 'archived_at')
