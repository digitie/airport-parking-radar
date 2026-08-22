"""Merge duplicate same-name parking lots after a source-ID migration.

The legacy HTTP API exposes numeric lot IDs while the live providers use stable
provider slugs. When both paths have already run, this script keeps the lot
with the most observations, moves non-conflicting snapshots and fee rules to
it, invalidates affected analytics caches, and removes the duplicate row.
Run it only against the PostgreSQL database on server14.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.session import create_engine_and_session_factory
from app.models import AnalyticsCache, Airport, ParkingFeeRule, ParkingLot, ParkingSnapshot


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


async def merge_lot(session: AsyncSession, canonical: ParkingLot, duplicate: ParkingLot) -> tuple[int, int, int]:
    moved_snapshots = 0
    deleted_snapshots = 0
    moved_fee_rules = 0

    snapshots = (
        await session.scalars(
            select(ParkingSnapshot).where(ParkingSnapshot.parking_lot_id == duplicate.id).order_by(ParkingSnapshot.id)
        )
    ).all()
    for snapshot in snapshots:
        existing = await session.scalar(
            select(ParkingSnapshot).where(
                ParkingSnapshot.parking_lot_id == canonical.id,
                ParkingSnapshot.source == snapshot.source,
                ParkingSnapshot.observed_at == snapshot.observed_at,
            )
        )
        if existing is not None:
            await session.delete(snapshot)
            deleted_snapshots += 1
            continue
        snapshot.parking_lot_id = canonical.id
        snapshot.airport_id = canonical.airport_id
        moved_snapshots += 1

    rules = (await session.scalars(select(ParkingFeeRule).where(ParkingFeeRule.parking_lot_id == duplicate.id))).all()
    for rule in rules:
        existing = await session.scalar(
            select(ParkingFeeRule).where(
                ParkingFeeRule.airport_id == rule.airport_id,
                ParkingFeeRule.parking_lot_id == canonical.id,
                ParkingFeeRule.vehicle_size == rule.vehicle_size,
                ParkingFeeRule.day_type == rule.day_type,
            )
        )
        if existing is not None:
            await session.delete(rule)
            continue
        rule.parking_lot_id = canonical.id
        moved_fee_rules += 1

    await session.execute(delete(AnalyticsCache).where(AnalyticsCache.parking_lot_id == duplicate.id))
    await session.delete(duplicate)
    return moved_snapshots, deleted_snapshots, moved_fee_rules


async def reconcile(args: argparse.Namespace) -> int:
    settings = Settings()
    engine, session_factory = create_engine_and_session_factory(settings.database_url)
    merged = moved_snapshots = deleted_snapshots = moved_fee_rules = 0

    async with session_factory() as session:
        airports = (await session.scalars(select(Airport).order_by(Airport.code))).all()
        for airport in airports:
            lots = (
                await session.scalars(
                    select(ParkingLot).where(ParkingLot.airport_id == airport.id).order_by(ParkingLot.id)
                )
            ).all()
            by_name: dict[str, list[ParkingLot]] = {}
            for lot in lots:
                by_name.setdefault(lot.name, []).append(lot)

            for same_name_lots in by_name.values():
                if len(same_name_lots) < 2:
                    continue
                count_rows = (
                    await session.execute(
                        select(ParkingSnapshot.parking_lot_id, func.count(ParkingSnapshot.id))
                        .where(ParkingSnapshot.parking_lot_id.in_([lot.id for lot in same_name_lots]))
                        .group_by(ParkingSnapshot.parking_lot_id)
                    )
                ).all()
                counts = dict(count_rows)
                canonical = max(same_name_lots, key=lambda lot: (counts.get(lot.id, 0), -lot.id))
                for duplicate in same_name_lots:
                    if duplicate.id == canonical.id:
                        continue
                    moved, deleted, fees = await merge_lot(session, canonical, duplicate)
                    merged += 1
                    moved_snapshots += moved
                    deleted_snapshots += deleted
                    moved_fee_rules += fees

        if args.dry_run:
            await session.rollback()
        else:
            await session.commit()

    await engine.dispose()
    print(
        f"merged_lots={merged} moved_snapshots={moved_snapshots} "
        f"deleted_conflicting_snapshots={deleted_snapshots} moved_fee_rules={moved_fee_rules} "
        f"dry_run={args.dry_run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(reconcile(parse_args())))
