"""Create the parking-radar PostgreSQL schema."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

JSONB = postgresql.JSONB(astext_type=sa.Text())
UTC = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "airports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=10), nullable=False),
        sa.Column("name_ko", sa.String(length=120), nullable=False),
        sa.Column("name_en", sa.String(length=120), nullable=True),
        sa.Column("source", sa.String(length=30), nullable=False),
        sa.Column("created_at", UTC, nullable=False),
        sa.Column("updated_at", UTC, nullable=False),
        sa.UniqueConstraint("code", name="uq_airports_code"),
    )
    op.create_index("ix_airports_code", "airports", ["code"], unique=False)

    op.create_table(
        "parking_lots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("airport_id", sa.Integer(), nullable=False),
        sa.Column("source_lot_id", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("terminal", sa.String(length=40), nullable=True),
        sa.Column("category", sa.String(length=40), nullable=True),
        sa.Column("total_spaces_hint", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", UTC, nullable=False),
        sa.Column("updated_at", UTC, nullable=False),
        sa.ForeignKeyConstraint(["airport_id"], ["airports.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("airport_id", "source_lot_id", name="uq_parking_lot_source"),
        sa.UniqueConstraint("id", "airport_id", name="uq_parking_lot_id_airport"),
    )
    op.create_index("ix_parking_lots_airport_id", "parking_lots", ["airport_id"], unique=False)

    op.create_table(
        "collection_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", UTC, nullable=False),
        sa.Column("finished_at", UTC, nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("trigger", sa.String(length=30), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_collection_runs_started_at", "collection_runs", ["started_at"], unique=False)

    op.create_table(
        "raw_api_responses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("collection_run_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("endpoint", sa.String(length=255), nullable=False),
        sa.Column("request_params_json", JSONB, nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("received_at", UTC, nullable=False),
        sa.Column("parse_status", sa.String(length=30), nullable=False),
        sa.Column("parse_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["collection_run_id"], ["collection_runs.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_raw_api_responses_collection_run_id", "raw_api_responses", ["collection_run_id"], unique=False)
    op.create_index("ix_raw_api_responses_source", "raw_api_responses", ["source"], unique=False)

    op.create_table(
        "parking_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("collection_run_id", sa.Integer(), nullable=True),
        sa.Column("airport_id", sa.Integer(), nullable=False),
        sa.Column("parking_lot_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("observed_at", UTC, nullable=False),
        sa.Column("collected_at", UTC, nullable=False),
        sa.Column("occupied_spaces", sa.Integer(), nullable=False),
        sa.Column("total_spaces", sa.Integer(), nullable=False),
        sa.Column("available_spaces", sa.Integer(), nullable=False),
        sa.Column("congestion_label", sa.String(length=40), nullable=True),
        sa.Column("congestion_ratio", sa.Float(), nullable=True),
        sa.Column("raw_item_json", JSONB, nullable=True),
        sa.ForeignKeyConstraint(["collection_run_id"], ["collection_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["airport_id"], ["airports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parking_lot_id"], ["parking_lots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parking_lot_id", "airport_id"],
            ["parking_lots.id", "parking_lots.airport_id"],
            ondelete="CASCADE",
            name="fk_snapshot_lot_airport",
        ),
        sa.UniqueConstraint("parking_lot_id", "observed_at", "source", name="uq_parking_snapshot"),
        sa.CheckConstraint(
            "occupied_spaces >= 0 AND total_spaces >= 0 AND available_spaces >= 0",
            name="ck_snapshot_nonnegative_spaces",
        ),
        sa.CheckConstraint(
            "occupied_spaces <= total_spaces AND available_spaces <= total_spaces",
            name="ck_snapshot_spaces_within_capacity",
        ),
        sa.CheckConstraint(
            "congestion_ratio IS NULL OR (congestion_ratio >= 0 AND congestion_ratio <= 100)",
            name="ck_snapshot_congestion_ratio",
        ),
    )
    op.create_index("ix_parking_snapshots_collection_run_id", "parking_snapshots", ["collection_run_id"], unique=False)
    op.create_index("ix_parking_snapshots_airport_id", "parking_snapshots", ["airport_id"], unique=False)
    op.create_index("ix_parking_snapshots_parking_lot_id", "parking_snapshots", ["parking_lot_id"], unique=False)
    op.create_index("ix_parking_snapshots_observed_at", "parking_snapshots", ["observed_at"], unique=False)
    op.create_index("ix_parking_snapshots_collected_at", "parking_snapshots", ["collected_at"], unique=False)
    op.create_index("ix_parking_snapshots_airport_observed", "parking_snapshots", ["airport_id", "observed_at"], unique=False)
    op.create_index("ix_parking_snapshots_lot_observed", "parking_snapshots", ["parking_lot_id", "observed_at"], unique=False)
    op.create_index("ix_parking_snapshots_airport_lot_observed", "parking_snapshots", ["airport_id", "parking_lot_id", "observed_at"], unique=False)
    op.execute(
        "CREATE INDEX ix_parking_snapshots_airport_lot_observed_desc "
        "ON parking_snapshots (airport_id, parking_lot_id, observed_at DESC, id DESC)"
    )

    op.create_table(
        "analytics_caches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("metric", sa.String(length=60), nullable=False),
        sa.Column("scope_key", sa.String(length=80), nullable=False),
        sa.Column("airport_code", sa.String(length=10), nullable=True),
        sa.Column("parking_lot_id", sa.Integer(), nullable=True),
        sa.Column("days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("future_hours", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_at", UTC, nullable=False),
        sa.Column("source_observed_at", UTC, nullable=True),
        sa.Column("payload_json", JSONB, nullable=False),
        sa.Column("updated_at", UTC, nullable=False),
        sa.UniqueConstraint("metric", "scope_key", "days", "interval_minutes", "limit", "future_hours", name="uq_analytics_cache_scope"),
    )
    op.create_index("ix_analytics_caches_lookup", "analytics_caches", ["metric", "scope_key"], unique=False)

    op.create_table(
        "parking_fee_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("airport_id", sa.Integer(), nullable=False),
        sa.Column("parking_lot_id", sa.Integer(), nullable=True),
        sa.Column("vehicle_size", sa.String(length=20), nullable=False),
        sa.Column("day_type", sa.String(length=20), nullable=False),
        sa.Column("free_minutes", sa.Integer(), nullable=False),
        sa.Column("basic_minutes", sa.Integer(), nullable=False),
        sa.Column("basic_fee", sa.Integer(), nullable=False),
        sa.Column("unit_minutes", sa.Integer(), nullable=False),
        sa.Column("unit_fee", sa.Integer(), nullable=False),
        sa.Column("daily_max_fee", sa.Integer(), nullable=False),
        sa.Column("source_updated_at", UTC, nullable=False),
        sa.Column("raw_item_json", JSONB, nullable=True),
        sa.ForeignKeyConstraint(["airport_id"], ["airports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parking_lot_id"], ["parking_lots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["parking_lot_id", "airport_id"],
            ["parking_lots.id", "parking_lots.airport_id"],
            name="fk_fee_rule_lot_airport",
        ),
        sa.CheckConstraint(
            "free_minutes >= 0 AND basic_minutes > 0 AND unit_minutes > 0",
            name="ck_fee_rule_valid_intervals",
        ),
        sa.CheckConstraint(
            "basic_fee >= 0 AND unit_fee >= 0 AND daily_max_fee >= 0",
            name="ck_fee_rule_nonnegative_fees",
        ),
    )
    op.create_index("ix_parking_fee_rules_airport_id", "parking_fee_rules", ["airport_id"], unique=False)
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


def downgrade() -> None:
    op.drop_table("parking_fee_rules")
    op.drop_table("analytics_caches")
    op.drop_table("parking_snapshots")
    op.drop_table("raw_api_responses")
    op.drop_table("collection_runs")
    op.drop_table("parking_lots")
    op.drop_table("airports")
