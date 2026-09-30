"""shield_findings: what NoX Shield (Model Armor + Sensitive Data Protection) flagged; hashes only, never text

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0007'
down_revision: str | Sequence[str] | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'shield_findings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('org_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('kb_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('mission_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('where', sa.String(), nullable=False),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('confidence', sa.String(), nullable=True),
        sa.Column('excerpt_sha', sa.String(), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['org_id'], ['orgs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['kb_id'], ['knowledge_bases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_shield_findings_org_id'), 'shield_findings', ['org_id'], unique=False)
    op.create_index(op.f('ix_shield_findings_kb_id'), 'shield_findings', ['kb_id'], unique=False)
    op.create_index(op.f('ix_shield_findings_mission_id'), 'shield_findings', ['mission_id'], unique=False)
    op.create_index(op.f('ix_shield_findings_created_at'), 'shield_findings', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_shield_findings_created_at'), table_name='shield_findings')
    op.drop_index(op.f('ix_shield_findings_mission_id'), table_name='shield_findings')
    op.drop_index(op.f('ix_shield_findings_kb_id'), table_name='shield_findings')
    op.drop_index(op.f('ix_shield_findings_org_id'), table_name='shield_findings')
    op.drop_table('shield_findings')
