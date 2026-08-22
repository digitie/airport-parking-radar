"""Verify per-lot freshness and identity during the 13 → 14 cutover.

This verifier is HTTP-only: it reads the running source proxy and target API,
does not touch Docker on server13, and fails if any source lot is missing or
if the target's latest observation falls behind the source high-watermark.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-base-url", required=True)
    parser.add_argument("--target-base-url", required=True)
    parser.add_argument("--days", type=int, default=1, choices=range(1, 8))
    parser.add_argument("--max-age-seconds", type=int, default=360, choices=range(60, 1801))
    return parser.parse_args()


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def fetch_json(client: httpx.AsyncClient, base_url: str, path: str, **params: Any) -> Any:
    response = await client.get(f"{base_url.rstrip('/')}/{path.lstrip('/')}", params=params or None)
    response.raise_for_status()
    return response.json()


async def latest_lot_history(
    client: httpx.AsyncClient,
    base_url: str,
    airport_code: str,
    lot: dict[str, Any],
    days: int,
) -> tuple[str, str, datetime | None, str | None]:
    try:
        payload = await fetch_json(
            client,
            base_url,
            "/parking/history",
            parking_lot_id=lot["id"],
            days=days,
        )
        items = payload.get("items", [])
        latest = max((parse_timestamp(item.get("observed_at")) for item in items), default=None)
        return airport_code, lot["name"], latest, None
    except Exception as exc:  # pragma: no cover - exercised against live systems
        return airport_code, lot["name"], None, str(exc)


async def verify(args: argparse.Namespace) -> int:
    async with httpx.AsyncClient(timeout=30) as client:
        source_airports, target_airports, target_status = await asyncio.gather(
            fetch_json(client, args.source_base_url, "/airports"),
            fetch_json(client, args.target_base_url, "/airports"),
            fetch_json(client, args.target_base_url, "/admin/collector-status"),
        )

        target_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for airport in target_airports:
            for lot in airport.get("parking_lots", []):
                target_by_key.setdefault((airport["code"].upper(), lot["name"]), []).append(lot)

        source_checks = [
            latest_lot_history(client, args.source_base_url, airport["code"].upper(), lot, args.days)
            for airport in source_airports
            for lot in airport.get("parking_lots", [])
        ]
        source_results = await asyncio.gather(*source_checks)

        target_checks = []
        failures: list[str] = []
        for airport_code, lot_name, source_latest, error in source_results:
            if error:
                failures.append(f"{airport_code}/{lot_name}: source request failed: {error}")
                continue
            candidates = target_by_key.get((airport_code, lot_name), [])
            if len(candidates) != 1:
                failures.append(f"{airport_code}/{lot_name}: target identity count={len(candidates)}")
                continue
            target_checks.append(
                latest_lot_history(
                    client,
                    args.target_base_url,
                    airport_code,
                    candidates[0],
                    args.days,
                )
            )

        target_results = await asyncio.gather(*target_checks)
        source_by_key = {(code, name): latest for code, name, latest, _ in source_results}
        now = datetime.now(timezone.utc)
        for airport_code, lot_name, target_latest, error in target_results:
            key = (airport_code, lot_name)
            source_latest = source_by_key.get(key)
            if error:
                failures.append(f"{airport_code}/{lot_name}: target request failed: {error}")
                continue
            if target_latest is None:
                if source_latest is not None:
                    failures.append(f"{airport_code}/{lot_name}: target has no observation")
                continue
            if source_latest is not None and target_latest < source_latest:
                failures.append(
                    f"{airport_code}/{lot_name}: target={target_latest.isoformat()} < source={source_latest.isoformat()}"
                )

        latest_target_observed = parse_timestamp(target_status.get("latest_snapshot_observed_at"))
        if latest_target_observed is None:
            failures.append("target has no global latest observation")
        elif (now - latest_target_observed).total_seconds() > args.max_age_seconds:
            failures.append(
                f"target global freshness is {(now - latest_target_observed).total_seconds():.1f}s "
                f"> {args.max_age_seconds}s"
            )
        if not target_status.get("scheduler_enabled"):
            failures.append("target scheduler is disabled")
        if target_status.get("collect_interval_seconds") != 300:
            failures.append(f"target interval={target_status.get('collect_interval_seconds')}s, expected 300s")
        last_run = target_status.get("last_run") or {}
        if last_run.get("status") != "success":
            failures.append(f"target last run status={last_run.get('status')!r}")

    result = {
        "source_lots": len(source_results),
        "target_lots_checked": len(target_results),
        "failure_count": len(failures),
        "failures": failures[:20],
        "target_latest_observed_at": target_status.get("latest_snapshot_observed_at"),
        "target_last_run_id": last_run.get("id"),
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(verify(parse_args())))
