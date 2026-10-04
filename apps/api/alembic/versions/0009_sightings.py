"""sightings: changes NoX suggests per seat, their runs, feedback and schedule (CP18)

Revision ID: 0009
Revises: 0008

Also gives missions a `sighting_id`: the sighting a mission was started from.
"""
from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = '0009'
down_revision: str | Sequence[str] | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ('open', 'snoozed', 'dismissed', 'launched', 'shipped', 'outdated')


def upgrade() -> None:
    role = postgresql.ENUM('business', 'product', 'engineering', 'developer', name='role', create_type=False)
    op.create_table(
        'sighting_runs',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('trigger', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('apps_scanned', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('apps_skipped', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('counts', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('usage', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('started_by', sa.UUID(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_sighting_runs_org_id', 'sighting_runs', ['org_id'])
    op.create_index('ix_sighting_runs_started_at', 'sighting_runs', ['started_at'])
    op.create_table(
        'sightings',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('run_id', sa.UUID(), sa.ForeignKey('sighting_runs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('kb_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('claim', sa.Text(), nullable=False),
        sa.Column('evidence', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('views', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('open_questions', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('impact', sa.String(), nullable=False, server_default='medium'),
        sa.Column('effort', sa.String(), nullable=True),
        sa.Column('status', sa.Enum(*STATUSES, name='sightingstatus'), nullable=False),
        sa.Column('status_reason', sa.Text(), nullable=True),
        sa.Column('mission_id', sa.UUID(), sa.ForeignKey('missions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('fingerprint', sa.String(), nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=True),
        sa.Column('snoozed_until', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_sightings_org_id', 'sightings', ['org_id'])
    op.create_index('ix_sightings_status', 'sightings', ['status'])
    op.create_index('ix_sightings_fingerprint', 'sightings', ['fingerprint'])
    op.create_index('ix_sightings_created_at', 'sightings', ['created_at'])
    op.create_table(
        'sighting_feedback',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('sighting_id', sa.UUID(), sa.ForeignKey('sightings.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seat', role, nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_sighting_feedback_sighting_id', 'sighting_feedback', ['sighting_id'])
    op.create_table(
        'sighting_schedules',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('org_id', sa.UUID(), sa.ForeignKey('orgs.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('cadence', sa.String(), nullable=False, server_default='weekly'),
        sa.Column('weekday', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('hour', sa.Integer(), nullable=False, server_default='8'),
        sa.Column('timezone', sa.String(), nullable=False, server_default='UTC'),
        sa.Column('seats', sa.JSON(), nullable=False, server_default='["business", "product", "engineering", "developer"]'),
        sa.Column('focus', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('fingerprints', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('next_run_at', sa.DateTime(), nullable=True),
        sa.Column('last_run_at', sa.DateTime(), nullable=True),
        sa.Column('updated_by', sa.UUID(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_sighting_schedules_next_run_at', 'sighting_schedules', ['next_run_at'])
    op.add_column('missions', sa.Column('sighting_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_missions_sighting_id', 'missions', 'sightings', ['sighting_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_missions_sighting_id', 'missions', type_='foreignkey')
    op.drop_column('missions', 'sighting_id')
    op.drop_table('sighting_schedules')
    op.drop_table('sighting_feedback')
    op.drop_table('sightings')
    op.drop_table('sighting_runs')
    sa.Enum(name='sightingstatus').drop(op.get_bind(), checkfirst=True)
