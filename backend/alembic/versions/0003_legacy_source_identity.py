"""Preserve the legacy API lot identity alongside provider identities."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_legacy_source_identity"
down_revision = "0002_integrity_and_freshness"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The composite lot/airport FK added in 0002 is the ownership guard. The
    # original single-column FKs are redundant and otherwise leave model
    # metadata out of sync with the migrated schema.
    op.drop_constraint("parking_snapshots_airport_id_fkey", "parking_snapshots", type_="foreignkey")
    op.drop_constraint("parking_snapshots_parking_lot_id_fkey", "parking_snapshots", type_="foreignkey")
    op.add_column("parking_lots", sa.Column("legacy_source_lot_id", sa.String(length=120), nullable=True))
    op.create_index(
        "uq_parking_lot_legacy_source",
        "parking_lots",
        ["airport_id", "legacy_source_lot_id"],
        unique=True,
        postgresql_where=sa.text("legacy_source_lot_id IS NOT NULL"),
        sqlite_where=sa.text("legacy_source_lot_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_parking_lot_legacy_source", table_name="parking_lots")
    op.drop_column("parking_lots", "legacy_source_lot_id")
    op.create_foreign_key(
        "parking_snapshots_parking_lot_id_fkey",
        "parking_snapshots",
        "parking_lots",
        ["parking_lot_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "parking_snapshots_airport_id_fkey",
        "parking_snapshots",
        "airports",
        ["airport_id"],
        ["id"],
        ondelete="CASCADE",
    )
