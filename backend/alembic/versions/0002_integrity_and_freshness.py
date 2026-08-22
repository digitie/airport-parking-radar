"""Enforce lot ownership, valid observations, and deterministic fee rules."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_integrity_and_freshness"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_parking_lot_id_airport",
        "parking_lots",
        ["id", "airport_id"],
    )
    op.create_foreign_key(
        "fk_snapshot_lot_airport",
        "parking_snapshots",
        "parking_lots",
        ["parking_lot_id", "airport_id"],
        ["id", "airport_id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_snapshot_nonnegative_spaces",
        "parking_snapshots",
        "occupied_spaces >= 0 AND total_spaces >= 0 AND available_spaces >= 0",
    )
    op.create_check_constraint(
        "ck_snapshot_spaces_within_capacity",
        "parking_snapshots",
        "occupied_spaces <= total_spaces AND available_spaces <= total_spaces",
    )
    op.create_check_constraint(
        "ck_snapshot_congestion_ratio",
        "parking_snapshots",
        "congestion_ratio IS NULL OR (congestion_ratio >= 0 AND congestion_ratio <= 100)",
    )

    op.create_foreign_key(
        "fk_fee_rule_lot_airport",
        "parking_fee_rules",
        "parking_lots",
        ["parking_lot_id", "airport_id"],
        ["id", "airport_id"],
    )
    op.drop_constraint("uq_parking_fee_rule", "parking_fee_rules", type_="unique")
    op.create_index(
        "uq_parking_fee_rule_lot",
        "parking_fee_rules",
        ["airport_id", "parking_lot_id", "vehicle_size", "day_type"],
        unique=True,
        postgresql_where=sa.text("parking_lot_id IS NOT NULL"),
    )
    op.create_index(
        "uq_parking_fee_rule_generic",
        "parking_fee_rules",
        ["airport_id", "vehicle_size", "day_type"],
        unique=True,
        postgresql_where=sa.text("parking_lot_id IS NULL"),
    )
    op.create_check_constraint(
        "ck_fee_rule_valid_intervals",
        "parking_fee_rules",
        "free_minutes >= 0 AND basic_minutes > 0 AND unit_minutes > 0",
    )
    op.create_check_constraint(
        "ck_fee_rule_nonnegative_fees",
        "parking_fee_rules",
        "basic_fee >= 0 AND unit_fee >= 0 AND daily_max_fee >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_fee_rule_nonnegative_fees", "parking_fee_rules", type_="check")
    op.drop_constraint("ck_fee_rule_valid_intervals", "parking_fee_rules", type_="check")
    op.drop_index("uq_parking_fee_rule_generic", table_name="parking_fee_rules")
    op.drop_index("uq_parking_fee_rule_lot", table_name="parking_fee_rules")
    op.create_unique_constraint(
        "uq_parking_fee_rule",
        "parking_fee_rules",
        ["airport_id", "parking_lot_id", "vehicle_size", "day_type"],
    )
    op.drop_constraint("fk_fee_rule_lot_airport", "parking_fee_rules", type_="foreignkey")

    op.drop_constraint("ck_snapshot_congestion_ratio", "parking_snapshots", type_="check")
    op.drop_constraint("ck_snapshot_spaces_within_capacity", "parking_snapshots", type_="check")
    op.drop_constraint("ck_snapshot_nonnegative_spaces", "parking_snapshots", type_="check")
    op.drop_constraint("fk_snapshot_lot_airport", "parking_snapshots", type_="foreignkey")
    op.drop_constraint("uq_parking_lot_id_airport", "parking_lots", type_="unique")
