"""onboarding: the welcome choice (demo or fresh) and the guided tours each user has seen

Everyone signed up before this keeps what they had: they're marked onboarded into the demo with every tour
seen, so only new accounts get the welcome screen and the tours.

Revision ID: 0012
Revises: 0011
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0012'
down_revision: str | Sequence[str] | None = '0011'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors services/onboarding.TOUR_KEYS at the time of this migration.
_ALL_TOURS = '["home:business", "home:product", "home:engineering", "home:developer", "fresh", "mission", "atlas", "kb"]'


def upgrade() -> None:
    op.add_column('users', sa.Column('onboarded_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('estate', sa.String(), nullable=True))
    op.add_column('users', sa.Column('tours_seen', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.execute(f"UPDATE users SET onboarded_at = COALESCE(created_at, now()), estate = 'demo', tours_seen = '{_ALL_TOURS}'")


def downgrade() -> None:
    op.drop_column('users', 'tours_seen')
    op.drop_column('users', 'estate')
    op.drop_column('users', 'onboarded_at')
