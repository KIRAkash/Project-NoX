"""team memory: lessons people taught NoX by sending work back, per application and seat (CP20)

Revision ID: 0010
Revises: 0009

Postgres is the record of which lessons are active and where each came from. With NOX_MEMORY=memory_bank,
Agent Platform Memory Bank consolidates and searches them, and `bank_name` points at its memory.
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0010'
down_revision: str | Sequence[str] | None = '0009'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    role = postgresql.ENUM('business', 'product', 'engineering', 'developer', name='role', create_type=False)
    op.create_table(
        'team_memories',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kb_id', sa.UUID(), sa.ForeignKey('knowledge_bases.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seat', role, nullable=True),
        sa.Column('fact', sa.Text(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False, server_default='team_rule'),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('sources', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('bank_name', sa.String(), nullable=True),
        sa.Column('embedding', sa.JSON(), nullable=True),
        sa.Column('applied_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('forgotten_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('forgotten_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_team_memories_kb_status', 'team_memories', ['kb_id', 'status'])
    op.create_index('ix_team_memories_org_id', 'team_memories', ['org_id'])
    op.create_index('ix_team_memories_bank_name', 'team_memories', ['bank_name'])


def downgrade() -> None:
    op.drop_table('team_memories')
