from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.time_utils import now_utc, serialize_utc
from app.models import Airport, AnalyticsCache, ParkingLot, ParkingSnapshot
from app.services.analytics import (
    build_threshold_insights,
    build_time_series,
    build_weekday_hour_patterns,
    detect_threshold_events,
)

METRIC_TIMESERIES = "timeseries"
METRIC_WEEKDAY_HOUR = "weekday_hour"
METRIC_THRESHOLD_EVENTS = "threshold_events"
METRIC_THRESHOLD_INSIGHTS = "threshold_insights"

DEFAULT_TIMESERIES_DAYS = 7
DEFAULT_TIMESERIES_INTERVAL_MINUTES = 10
DEFAULT_TIMESERIES_FUTURE_HOURS = 0
DEFAULT_WEEKDAY_HOUR_DAYS = 14
DEFAULT_THRESHOLD_EVENTS_DAYS = 14
DEFAULT_THRESHOLD_EVENTS_LIMIT = 20
DEFAULT_THRESHOLD_INSIGHTS_DAYS = 21
DEFAULT_THRESHOLD_INSIGHTS_INTERVAL_MINUTES = 10


def build_analytics_scope_key(airport_code: str | None, parking_lot_id: int | None) -> str:
    airport_part = (airport_code or "*").upper()
    lot_part = str(parking_lot_id) if parking_lot_id is not None else "*"
    return f"{airport_part}:{lot_part}"


def serialize_json_payload(value: Any) -> Any:
    if isinstance(value, datetime):
        return serialize_utc(value).isoformat()
    if isinstance(value, list):
        return [serialize_json_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize_json_payload(item) for key, item in value.items()}
    return value


async def load_cached_analytics(
    session: AsyncSession,
    *,
    metric: str,
    airport_code: str | None,
    parking_lot_id: int | None,
    days: int = 0,
    interval_minutes: int = 0,
    limit: int = 0,
    future_hours: int = 0,
) -> Any | None:
    cached = await session.scalar(
        select(AnalyticsCache).where(
            AnalyticsCache.metric == metric,
            AnalyticsCache.scope_key == build_analytics_scope_key(airport_code, parking_lot_id),
            AnalyticsCache.days == days,
            AnalyticsCache.interval_minutes == interval_minutes,
            AnalyticsCache.limit == limit,
            AnalyticsCache.future_hours == future_hours,
        )
    )
    return cached.payload_json if cached else None


async def store_cached_analytics(
    session: AsyncSession,
    *,
    metric: str,
    airport_code: str,
    parking_lot_id: int | None,
    days: int = 0,
    interval_minutes: int = 0,
    limit: int = 0,
    future_hours: int = 0,
    source_observed_at: datetime | None,
    payload: Any,
) -> None:
    generated_at = now_utc()
    scope_key = build_analytics_scope_key(airport_code, parking_lot_id)
    cached = await session.scalar(
        select(AnalyticsCache).where(
            AnalyticsCache.metric == metric,
            AnalyticsCache.scope_key == scope_key,
            AnalyticsCache.days == days,
            AnalyticsCache.interval_minutes == interval_minutes,
            AnalyticsCache.limit == limit,
            AnalyticsCache.future_hours == future_hours,
        )
    )
    serialized_payload = serialize_json_payload(payload)
    if cached is None:
        session.add(
            AnalyticsCache(
                metric=metric,
                scope_key=scope_key,
                airport_code=airport_code,
                parking_lot_id=parking_lot_id,
                days=days,
                interval_minutes=interval_minutes,
                limit=limit,
                future_hours=future_hours,
                generated_at=generated_at,
                source_observed_at=source_observed_at,
                payload_json=serialized_payload,
                updated_at=generated_at,
            )
        )
        return

    cached.airport_code = airport_code
    cached.parking_lot_id = parking_lot_id
    cached.generated_at = generated_at
    cached.source_observed_at = source_observed_at
    cached.payload_json = serialized_payload
    cached.updated_at = generated_at


async def refresh_default_analytics_cache(
    session: AsyncSession,
    settings: Settings,
    airport_codes: Iterable[str] | None = None,
) -> int:
    codes = [code.upper() for code in (airport_codes or settings.supported_airport_codes)]
    airports = (
        await session.execute(
            select(Airport)
            .where(Airport.code.in_(codes))
            .order_by(Airport.code)
        )
    ).scalars().all()

    refreshed = 0
    for airport in airports:
        lot_ids = (
            await session.execute(
                select(ParkingLot.id)
                .where(ParkingLot.airport_id == airport.id, ParkingLot.is_active.is_(True))
                .order_by(ParkingLot.id)
            )
        ).scalars().all()
        for parking_lot_id in [None, *lot_ids]:
            refreshed += await refresh_scope_analytics_cache(session, settings, airport, parking_lot_id)
    return refreshed


async def refresh_scope_analytics_cache(
    session: AsyncSession,
    settings: Settings,
    airport: Airport,
    parking_lot_id: int | None,
) -> int:
    refreshed = 0
    source_observed_at = await _load_latest_observed_at(session, airport.id, parking_lot_id)

    time_series_snapshots = await _load_snapshots(
        session,
        airport.id,
        parking_lot_id,
        DEFAULT_TIMESERIES_DAYS,
        buffer_minutes=DEFAULT_TIMESERIES_INTERVAL_MINUTES,
    )
    await store_cached_analytics(
        session,
        metric=METRIC_TIMESERIES,
        airport_code=airport.code,
        parking_lot_id=parking_lot_id,
        days=DEFAULT_TIMESERIES_DAYS,
        interval_minutes=DEFAULT_TIMESERIES_INTERVAL_MINUTES,
        future_hours=DEFAULT_TIMESERIES_FUTURE_HOURS,
        source_observed_at=source_observed_at,
        payload={
            "generated_at": now_utc(),
            "airport_code": airport.code,
            "parking_lot_id": parking_lot_id,
            "days": DEFAULT_TIMESERIES_DAYS,
            "interval_minutes": DEFAULT_TIMESERIES_INTERVAL_MINUTES,
            "future_hours": DEFAULT_TIMESERIES_FUTURE_HOURS,
            "items": build_time_series(
                time_series_snapshots,
                days=DEFAULT_TIMESERIES_DAYS,
                interval_minutes=DEFAULT_TIMESERIES_INTERVAL_MINUTES,
                future_hours=DEFAULT_TIMESERIES_FUTURE_HOURS,
                tz_name=settings.app_timezone,
            ),
        },
    )
    refreshed += 1

    weekday_snapshots = await _load_snapshots(session, airport.id, parking_lot_id, DEFAULT_WEEKDAY_HOUR_DAYS)
    await store_cached_analytics(
        session,
        metric=METRIC_WEEKDAY_HOUR,
        airport_code=airport.code,
        parking_lot_id=parking_lot_id,
        days=DEFAULT_WEEKDAY_HOUR_DAYS,
        source_observed_at=source_observed_at,
        payload=build_weekday_hour_patterns(weekday_snapshots, tz_name=settings.app_timezone),
    )
    refreshed += 1

    threshold_rows = await _load_snapshot_rows(session, airport.id, parking_lot_id, DEFAULT_THRESHOLD_EVENTS_DAYS)
    threshold_events = [
        {**event, "crossed_at": serialize_utc(event["crossed_at"])}
        for event in detect_threshold_events(threshold_rows, limit=DEFAULT_THRESHOLD_EVENTS_LIMIT)
    ]
    await store_cached_analytics(
        session,
        metric=METRIC_THRESHOLD_EVENTS,
        airport_code=airport.code,
        parking_lot_id=parking_lot_id,
        days=DEFAULT_THRESHOLD_EVENTS_DAYS,
        limit=DEFAULT_THRESHOLD_EVENTS_LIMIT,
        source_observed_at=source_observed_at,
        payload=threshold_events,
    )
    refreshed += 1

    threshold_snapshots = await _load_snapshots(
        session,
        airport.id,
        parking_lot_id,
        DEFAULT_THRESHOLD_INSIGHTS_DAYS,
        buffer_minutes=DEFAULT_THRESHOLD_INSIGHTS_INTERVAL_MINUTES,
    )
    threshold_points = build_time_series(
        threshold_snapshots,
        days=DEFAULT_THRESHOLD_INSIGHTS_DAYS,
        interval_minutes=DEFAULT_THRESHOLD_INSIGHTS_INTERVAL_MINUTES,
        tz_name=settings.app_timezone,
    )
    threshold_insights = build_threshold_insights(threshold_points, tz_name=settings.app_timezone)
    await store_cached_analytics(
        session,
        metric=METRIC_THRESHOLD_INSIGHTS,
        airport_code=airport.code,
        parking_lot_id=parking_lot_id,
        days=DEFAULT_THRESHOLD_INSIGHTS_DAYS,
        interval_minutes=DEFAULT_THRESHOLD_INSIGHTS_INTERVAL_MINUTES,
        source_observed_at=source_observed_at,
        payload={
            "generated_at": now_utc(),
            "airport_code": airport.code,
            "parking_lot_id": parking_lot_id,
            "days": DEFAULT_THRESHOLD_INSIGHTS_DAYS,
            "interval_minutes": DEFAULT_THRESHOLD_INSIGHTS_INTERVAL_MINUTES,
            "weekday_items": threshold_insights["weekday_items"],
            "history_items": threshold_insights["history_items"],
        },
    )
    refreshed += 1
    return refreshed


async def _load_latest_observed_at(
    session: AsyncSession,
    airport_id: int,
    parking_lot_id: int | None,
) -> datetime | None:
    query = select(func.max(ParkingSnapshot.observed_at)).where(ParkingSnapshot.airport_id == airport_id)
    if parking_lot_id is not None:
        query = query.where(ParkingSnapshot.parking_lot_id == parking_lot_id)
    return await session.scalar(query)


async def _load_snapshots(
    session: AsyncSession,
    airport_id: int,
    parking_lot_id: int | None,
    days: int,
    buffer_minutes: int = 0,
) -> list[ParkingSnapshot]:
    cutoff = now_utc() - timedelta(days=days, minutes=buffer_minutes)
    query = (
        select(ParkingSnapshot)
        .where(ParkingSnapshot.airport_id == airport_id, ParkingSnapshot.observed_at >= cutoff)
        .order_by(ParkingSnapshot.parking_lot_id, ParkingSnapshot.observed_at)
    )
    if parking_lot_id is not None:
        query = query.where(ParkingSnapshot.parking_lot_id == parking_lot_id)
    return (await session.execute(query)).scalars().all()


async def _load_snapshot_rows(
    session: AsyncSession,
    airport_id: int,
    parking_lot_id: int | None,
    days: int,
) -> list[tuple[ParkingSnapshot, ParkingLot, Airport]]:
    cutoff = now_utc() - timedelta(days=days)
    query = (
        select(ParkingSnapshot, ParkingLot, Airport)
        .join(ParkingLot, ParkingLot.id == ParkingSnapshot.parking_lot_id)
        .join(Airport, Airport.id == ParkingSnapshot.airport_id)
        .where(ParkingSnapshot.airport_id == airport_id, ParkingSnapshot.observed_at >= cutoff)
        .order_by(ParkingLot.id, ParkingSnapshot.observed_at)
    )
    if parking_lot_id is not None:
        query = query.where(ParkingSnapshot.parking_lot_id == parking_lot_id)
    return (await session.execute(query)).all()
