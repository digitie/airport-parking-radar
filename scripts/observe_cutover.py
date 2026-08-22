"""Repeat the per-lot cutover verifier for the complete five-minute gate."""

from __future__ import annotations

import argparse
import asyncio
import json
from types import SimpleNamespace

from verify_cutover import verify


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-base-url", required=True)
    parser.add_argument("--target-base-url", required=True)
    parser.add_argument("--days", type=int, default=1, choices=range(1, 8))
    # A 300-second scheduler has a short collection/HTTP propagation tail;
    # 360 seconds detects a missed tick without rejecting the normal boundary.
    parser.add_argument("--max-age-seconds", type=int, default=360, choices=range(60, 1801))
    parser.add_argument("--max-source-lag-seconds", type=int, default=360, choices=range(60, 1801))
    parser.add_argument("--max-run-gap-seconds", type=int, default=360, choices=range(60, 1801))
    parser.add_argument("--samples", type=int, default=6, choices=range(2, 21))
    parser.add_argument("--sample-interval-seconds", type=int, default=60, choices=range(5, 3601))
    return parser.parse_args()


async def observe(args: argparse.Namespace) -> int:
    verifier_args = SimpleNamespace(
        source_base_url=args.source_base_url,
        target_base_url=args.target_base_url,
        days=args.days,
        max_age_seconds=args.max_age_seconds,
        max_source_lag_seconds=args.max_source_lag_seconds,
        max_run_gap_seconds=args.max_run_gap_seconds,
    )
    statuses: list[int] = []
    for sample_index in range(args.samples):
        statuses.append(await verify(verifier_args))
        if sample_index + 1 < args.samples:
            await asyncio.sleep(args.sample_interval_seconds)

    result = {
        "samples": args.samples,
        "sample_interval_seconds": args.sample_interval_seconds,
        "gate_duration_seconds": (args.samples - 1) * args.sample_interval_seconds,
        "failed_samples": sum(status != 0 for status in statuses),
        "max_source_lag_seconds": args.max_source_lag_seconds,
        "max_run_gap_seconds": args.max_run_gap_seconds,
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 1 if any(statuses) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(observe(parse_args())))
