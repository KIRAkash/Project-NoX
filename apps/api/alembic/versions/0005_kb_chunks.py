"""kb_chunks: knowledge-base pages split by section, for hybrid (vector + full-text) search

Revision ID: 0005
Revises: 0004

The embedding column needs pgvector (always there on Cloud SQL). Where the extension can't be created
(e.g. a local Postgres without it) the table is still made, and search runs on full-text alone.
"""
from typing import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '0005'
down_revision: str | Sequence[str] | None = '0004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMBED_DIM = 768


def _try_vector(conn) -> bool:
    try:
        with conn.begin_nested():
            conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        return True
    except Exception:
        return False


def upgrade() -> None:
    conn = op.get_bind()
    has_vector = _try_vector(conn)
    op.create_table(
        'kb_chunks',
        sa.Column('id', sa.UUID(), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('kb_id', sa.UUID(), sa.ForeignKey('knowledge_bases.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.UUID(), nullable=True),
        sa.Column('app_name', sa.String(), nullable=False),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('heading', sa.String(), nullable=False, server_default=''),
        sa.Column('idx', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('content_hash', sa.String(64), nullable=False),
        sa.Column('tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('embedded_with', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    )
    # Identifiers like order.refunded.v1 or /v2/reversals are single tokens to Postgres; index a copy with the
    # separators turned into spaces too, so "order refunded" finds them.
    op.execute("ALTER TABLE kb_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS "
               "(setweight(to_tsvector('english', coalesce(path, '') || ' ' || coalesce(heading, '')), 'A') || "
               "to_tsvector('english', content) || "
               "to_tsvector('english', regexp_replace(content, '[._/:{}-]+', ' ', 'g'))) STORED")
    op.create_index('ix_kb_chunks_kb_path', 'kb_chunks', ['kb_id', 'path', 'idx'], unique=True)
    op.execute("CREATE INDEX ix_kb_chunks_tsv ON kb_chunks USING gin (tsv)")
    if has_vector:
        op.execute(f"ALTER TABLE kb_chunks ADD COLUMN embedding vector({EMBED_DIM})")
        op.execute("CREATE INDEX ix_kb_chunks_embedding ON kb_chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.drop_table('kb_chunks')
