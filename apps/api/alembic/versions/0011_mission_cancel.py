"""mission cancel: the creator can cancel a mission (kept, read-only) and restore it

Revision ID: 0011
Revises: 0010
"""
from typing import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0011'
down_revision: str | Sequence[str] | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('missions', sa.Column('cancelled_at', sa.DateTime(), nullable=True))
    op.add_column('missions', sa.Column('cancelled_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('missions', sa.Column('cancel_reason', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('missions', 'cancel_reason')
    op.drop_column('missions', 'cancelled_by')
    op.drop_column('missions', 'cancelled_at')
