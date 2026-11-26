"""workspace onboarding checklist: per-workspace setup milestones and dismissal preferences

Revision ID: 0013
Revises: 0012
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0013'
down_revision: str | Sequence[str] | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('checklist_dismissed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_table(
        'workspace_onboarding',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('completed_steps', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('dismissed_by', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('workspace_onboarding')
    op.drop_column('users', 'checklist_dismissed')
