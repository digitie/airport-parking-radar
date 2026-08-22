from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


JSON_TYPE = JSON().with_variant(JSONB, "postgresql")


class Airport(Base):
    __tablename__ = "airports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name_ko: Mapped[str] = mapped_column(String(120))
    name_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    parking_lots: Mapped[list["ParkingLot"]] = relationship(back_populates="airport")


class ParkingLot(Base):
    __tablename__ = "parking_lots"
    __table_args__ = (
        UniqueConstraint("airport_id", "source_lot_id", name="uq_parking_lot_source"),
        UniqueConstraint("id", "airport_id", name="uq_parking_lot_id_airport"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    airport_id: Mapped[int] = mapped_column(ForeignKey("airports.id", ondelete="CASCADE"), index=True)
    source_lot_id: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(120))
    terminal: Mapped[str | None] = mapped_column(String(40), nullable=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    total_spaces_hint: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    airport: Mapped[Airport] = relationship(back_populates="parking_lots")
    snapshots: Mapped[list["ParkingSnapshot"]] = relationship(back_populates="parking_lot")


class CollectionRun(Base):
    __tablename__ = "collection_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(30))
    trigger: Mapped[str] = mapped_column(String(30))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class RawApiResponse(Base):
    __tablename__ = "raw_api_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    collection_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("collection_runs.id", ondelete="SET NULL"),
        index=True,
    )
    source: Mapped[str] = mapped_column(String(40), index=True)
    endpoint: Mapped[str] = mapped_column(String(255))
    request_params_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE, nullable=True)
    status_code: Mapped[int] = mapped_column(Integer)
    body_text: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    parse_status: Mapped[str] = mapped_column(String(30))
    parse_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ParkingSnapshot(Base):
    __tablename__ = "parking_snapshots"
    __table_args__ = (
        UniqueConstraint("parking_lot_id", "observed_at", "source", name="uq_parking_snapshot"),
        ForeignKeyConstraint(
            ["parking_lot_id", "airport_id"],
            ["parking_lots.id", "parking_lots.airport_id"],
            ondelete="CASCADE",
            name="fk_snapshot_lot_airport",
        ),
        CheckConstraint(
            "occupied_spaces >= 0 AND total_spaces >= 0 AND available_spaces >= 0",
            name="ck_snapshot_nonnegative_spaces",
        ),
        CheckConstraint(
            "available_spaces <= total_spaces",
            name="ck_snapshot_available_within_capacity",
        ),
        CheckConstraint(
            "congestion_ratio IS NULL OR (congestion_ratio >= 0 AND congestion_ratio <= 100)",
            name="ck_snapshot_congestion_ratio",
        ),
        Index("ix_parking_snapshots_airport_observed", "airport_id", "observed_at"),
        Index("ix_parking_snapshots_lot_observed", "parking_lot_id", "observed_at"),
        Index("ix_parking_snapshots_airport_lot_observed", "airport_id", "parking_lot_id", "observed_at"),
        Index("ix_parking_snapshots_collection_run_id", "collection_run_id"),
        Index("ix_parking_snapshots_collected_at", "collected_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    collection_run_id: Mapped[int | None] = mapped_column(ForeignKey("collection_runs.id", ondelete="SET NULL"))
    airport_id: Mapped[int] = mapped_column(Integer, index=True)
    parking_lot_id: Mapped[int] = mapped_column(Integer, index=True)
    source: Mapped[str] = mapped_column(String(40))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    occupied_spaces: Mapped[int] = mapped_column(Integer)
    total_spaces: Mapped[int] = mapped_column(Integer)
    available_spaces: Mapped[int] = mapped_column(Integer)
    congestion_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    congestion_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_item_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE, nullable=True)

    parking_lot: Mapped[ParkingLot] = relationship(back_populates="snapshots")


class AnalyticsCache(Base):
    __tablename__ = "analytics_caches"
    __table_args__ = (
        UniqueConstraint(
            "metric",
            "scope_key",
            "days",
            "interval_minutes",
            "limit",
            "future_hours",
            name="uq_analytics_cache_scope",
        ),
        Index("ix_analytics_caches_lookup", "metric", "scope_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    metric: Mapped[str] = mapped_column(String(60))
    scope_key: Mapped[str] = mapped_column(String(80))
    airport_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    parking_lot_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    days: Mapped[int] = mapped_column(Integer, default=0)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=0)
    limit: Mapped[int] = mapped_column(Integer, default=0)
    future_hours: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source_observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_json: Mapped[Any] = mapped_column(JSON_TYPE)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ParkingFeeRule(Base):
    __tablename__ = "parking_fee_rules"
    __table_args__ = (
        ForeignKeyConstraint(
            ["parking_lot_id", "airport_id"],
            ["parking_lots.id", "parking_lots.airport_id"],
            name="fk_fee_rule_lot_airport",
        ),
        Index(
            "uq_parking_fee_rule_lot",
            "airport_id",
            "parking_lot_id",
            "vehicle_size",
            "day_type",
            unique=True,
            postgresql_where=text("parking_lot_id IS NOT NULL"),
            sqlite_where=text("parking_lot_id IS NOT NULL"),
        ),
        Index(
            "uq_parking_fee_rule_generic",
            "airport_id",
            "vehicle_size",
            "day_type",
            unique=True,
            postgresql_where=text("parking_lot_id IS NULL"),
            sqlite_where=text("parking_lot_id IS NULL"),
        ),
        CheckConstraint(
            "free_minutes >= 0 AND basic_minutes > 0 AND unit_minutes > 0",
            name="ck_fee_rule_valid_intervals",
        ),
        CheckConstraint(
            "basic_fee >= 0 AND unit_fee >= 0 AND daily_max_fee >= 0",
            name="ck_fee_rule_nonnegative_fees",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    airport_id: Mapped[int] = mapped_column(ForeignKey("airports.id", ondelete="CASCADE"), index=True)
    parking_lot_id: Mapped[int | None] = mapped_column(ForeignKey("parking_lots.id", ondelete="SET NULL"), nullable=True)
    vehicle_size: Mapped[str] = mapped_column(String(20))
    day_type: Mapped[str] = mapped_column(String(20))
    free_minutes: Mapped[int] = mapped_column(Integer)
    basic_minutes: Mapped[int] = mapped_column(Integer)
    basic_fee: Mapped[int] = mapped_column(Integer)
    unit_minutes: Mapped[int] = mapped_column(Integer)
    unit_fee: Mapped[int] = mapped_column(Integer)
    daily_max_fee: Mapped[int] = mapped_column(Integer)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    raw_item_json: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE, nullable=True)
