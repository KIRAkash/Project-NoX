"""media_assets: screenshots, screen recordings, videos and voice notes shown to NoX (CP15)

Revision ID: 0007
Revises: 0006

Also gives spec_chat_messages a `media_ids` list, for captures attached to a chat message.
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0007'
down_revision: str | Sequence[str] | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = ('image', 'screenshot', 'screen_recording', 'video', 'audio')
STATUSES = ('uploading', 'analyzing', 'ready', 'failed', 'withheld', 'deleted')


def upgrade() -> None:
    role = postgresql.ENUM('business', 'product', 'engineering', 'developer', name='role', create_type=False)
    op.create_table(
        'media_assets',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('mission_id', sa.UUID(), sa.ForeignKey('missions.id', ondelete='CASCADE'), nullable=True),
        sa.Column('spec_role', role, nullable=True),
        sa.Column('chat_message_id', sa.UUID(), sa.ForeignKey('spec_chat_messages.id', ondelete='SET NULL'), nullable=True),
        sa.Column('uploaded_by', sa.UUID(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('uploaded_as', role, nullable=False),
        sa.Column('kind', sa.Enum(*KINDS, name='mediakind'), nullable=False),
        sa.Column('mime', sa.String(), nullable=False),
        sa.Column('bytes', sa.BigInteger(), nullable=False),
        sa.Column('duration_s', sa.Float(), nullable=True),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('clip_start_s', sa.Float(), nullable=True),
        sa.Column('clip_end_s', sa.Float(), nullable=True),
        sa.Column('storage_uri', sa.String(), nullable=False),
        sa.Column('annotated_of', sa.UUID(), sa.ForeignKey('media_assets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum(*STATUSES, name='mediastatus'), nullable=False),
        sa.Column('status_reason', sa.Text(), nullable=True),
        sa.Column('observation', sa.JSON(), nullable=True),
        sa.Column('grounding', sa.JSON(), nullable=True),
        sa.Column('views', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('usage', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('analyzed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_media_assets_org_id', 'media_assets', ['org_id'])
    op.create_index('ix_media_assets_mission_id', 'media_assets', ['mission_id'])
    op.create_index('ix_media_assets_uploaded_by', 'media_assets', ['uploaded_by'])
    op.add_column('spec_chat_messages', sa.Column('media_ids', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('spec_chat_messages', 'media_ids')
    op.drop_table('media_assets')
    sa.Enum(name='mediastatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='mediakind').drop(op.get_bind(), checkfirst=True)
