from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.time_utils import now_utc
from app.main import create_app
from app.models import CollectionRun


def assert_is_utc_iso(value: str | None) -> None:
    assert value is not None
    assert value.endswith("Z") or value.endswith("+00:00")


def build_client(tmp_path: Path, **overrides) -> TestClient:
    settings = Settings(
        **{
            "database_url": f"sqlite+aiosqlite:///{tmp_path / 'test.sqlite3'}",
            "seed_sample_data": True,
            "enable_scheduler": False,
            "collect_interval_seconds": 300,
            "manual_collect_min_interval_seconds": 300,
            "data_go_kr_service_key": None,
            "use_sample_client_when_no_key": True,
            "airport_codes_csv": "GMP,PUS,CJU",
            "cors_origins_csv": "http://localhost:3000",
            **overrides,
        }
    )
    app = create_app(settings)
    return TestClient(app)


async def insert_collection_run(
    client: TestClient,
    *,
    status: str,
    trigger: str,
    error_message: str | None,
    started_at: datetime | None = None,
) -> None:
    session_factory = client.app.state.session_factory
    started_at = started_at or (now_utc() - timedelta(minutes=1))
    finished_at = started_at + timedelta(seconds=1)
    async with session_factory() as session:
        session.add(
            CollectionRun(
                started_at=started_at,
                finished_at=finished_at,
                status=status,
                trigger=trigger,
                error_message=error_message,
            )
        )
        await session.commit()


def test_health(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["seeded"] is True


def test_security_headers(client) -> None:
    response = client.get("/health", headers={"x-forwarded-proto": "https"})
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"


def test_api_docs_can_be_disabled(tmp_path: Path) -> None:
    with build_client(tmp_path, enable_api_docs=False) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_trusted_host_rejects_unexpected_hosts(tmp_path: Path) -> None:
    with build_client(tmp_path, trusted_hosts_csv="parking.local") as client:
        rejected = client.get("/health", headers={"host": "unexpected.local"})
        accepted = client.get("/health", headers={"host": "parking.local"})

    assert rejected.status_code == 400
    assert accepted.status_code == 200


def test_airports(client) -> None:
    response = client.get("/airports")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) >= 4

    airports = {airport["code"]: airport for airport in payload}
    assert len(airports["PUS"]["parking_lots"]) == 3
    assert len(airports["GMP"]["parking_lots"]) >= 4
    assert any(lot["name"].startswith("P1") for lot in airports["PUS"]["parking_lots"])


def test_current_and_analytics(client) -> None:
    current = client.get("/parking/current", params={"airport_code": "GMP"})
    assert current.status_code == 200
    current_payload = current.json()
    assert current_payload["items"]
    assert_is_utc_iso(current_payload["generated_at"])
    assert_is_utc_iso(current_payload["items"][0]["observed_at"])
    assert_is_utc_iso(current_payload["items"][0]["collected_at"])

    hourly = client.get("/parking/analytics/by-hour", params={"airport_code": "GMP"})
    weekday = client.get("/parking/analytics/by-weekday", params={"airport_code": "GMP"})
    weekday_hour = client.get("/parking/analytics/by-weekday-hour", params={"airport_code": "GMP"})
    timeseries = client.get(
        "/parking/analytics/timeseries",
        params={"airport_code": "GMP", "days": 7, "interval_minutes": 30},
    )
    holiday_summary = client.get(
        "/holidays/summary",
        params={"start_date": "2026-05-01", "end_date": "2026-05-31"},
    )
    holiday_patterns = client.get("/parking/analytics/holiday-patterns", params={"airport_code": "GMP"})
    thresholds = client.get("/parking/analytics/threshold-events", params={"airport_code": "GMP"})
    threshold_insights = client.get(
        "/parking/analytics/threshold-insights",
        params={"airport_code": "GMP", "days": 21, "interval_minutes": 10},
    )
    assert hourly.status_code == 200
    assert weekday.status_code == 200
    assert weekday_hour.status_code == 200
    assert timeseries.status_code == 200
    assert holiday_summary.status_code == 200
    assert holiday_patterns.status_code == 200
    assert thresholds.status_code == 200
    assert threshold_insights.status_code == 200
    assert hourly.json()
    assert weekday.json()
    weekday_hour_payload = weekday_hour.json()
    assert weekday_hour_payload
    assert weekday_hour_payload[0]["hourly_buckets"]
    assert len(weekday_hour_payload[0]["hourly_buckets"]) == 24

    timeseries_payload = timeseries.json()
    assert_is_utc_iso(timeseries_payload["generated_at"])
    assert timeseries_payload["days"] == 7
    assert timeseries_payload["interval_minutes"] == 30
    assert timeseries_payload["future_hours"] == 4
    assert len(timeseries_payload["items"]) == 344
    assert max(point["lot_observations"] for point in timeseries_payload["items"]) >= 1
    assert_is_utc_iso(timeseries_payload["items"][0]["bucket_at"])
    latest_observed_point = next(
        point for point in reversed(timeseries_payload["items"]) if point["lot_observations"] > 0
    )
    assert latest_observed_point["available_spaces"] == sum(
        item["available_spaces"] for item in current_payload["items"]
    )
    assert timeseries_payload["items"][-1]["lot_observations"] == 0

    holiday_summary_payload = holiday_summary.json()
    assert holiday_summary_payload["status"] == "sample"
    assert "5/5 (화) 어린이날" in holiday_summary_payload["sentence"]
    assert any(item["name"] == "부처님오신 날" for item in holiday_summary_payload["items"])

    holiday_patterns_payload = holiday_patterns.json()
    assert holiday_patterns_payload["items"]
    assert len(holiday_patterns_payload["items"][0]["hourly_buckets"]) == 24

    threshold_payload = thresholds.json()
    assert threshold_payload
    assert_is_utc_iso(threshold_payload[0]["crossed_at"])

    threshold_insights_payload = threshold_insights.json()
    assert_is_utc_iso(threshold_insights_payload["generated_at"])
    assert threshold_insights_payload["interval_minutes"] == 10
    assert len(threshold_insights_payload["weekday_items"]) == 14
    assert "sample_count" in threshold_insights_payload["weekday_items"][0]


def test_flight_status_returns_sample_markers(client) -> None:
    response = client.get("/flights/status", params={"airport_code": "GMP", "local_date": "2026-04-25"})
    assert response.status_code == 200
    payload = response.json()

    assert payload["airport_code"] == "GMP"
    assert payload["local_date"] == "2026-04-25"
    assert payload["status"] == "sample"
    assert payload["items"]
    assert {item["direction"] for item in payload["items"]} >= {"departure", "arrival"}
    assert_is_utc_iso(payload["generated_at"])
    assert_is_utc_iso(payload["items"][0]["marker_at"])
    assert payload["items"][0]["flight_number"]
    assert payload["items"][0]["origin_airport"]
    assert payload["items"][0]["destination_airport"]


def test_flight_status_rejects_invalid_local_date(client) -> None:
    response = client.get("/flights/status", params={"airport_code": "GMP", "local_date": "2026/04/25"})
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_fee_calculation(client) -> None:
    entry = datetime(2026, 4, 24, 9, 0, tzinfo=ZoneInfo("Asia/Seoul"))
    exit_at = entry + timedelta(hours=2)
    response = client.post(
        "/fees/calculate",
        json={
            "airport_code": "GMP",
            "vehicle_size": "small",
            "entry_at": entry.isoformat(),
            "exit_at": exit_at.isoformat(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["supported"] is True
    assert payload["total_fee"] == 3000


def test_incheon_fee_calculation_is_supported(client) -> None:
    entry = datetime(2026, 4, 24, 9, 0, tzinfo=ZoneInfo("Asia/Seoul"))
    response = client.post(
        "/fees/calculate",
        json={
            "airport_code": "ICN",
            "vehicle_size": "small",
            "entry_at": entry.isoformat(),
            "exit_at": (entry + timedelta(hours=1)).isoformat(),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["supported"] is True
    assert payload["total_fee"] == 1000


def test_admin_collect_returns_cooldown_error(tmp_path: Path) -> None:
    with build_client(tmp_path, manual_collect_min_interval_seconds=999999999) as client:
        response = client.post("/admin/collect")
        assert response.status_code == 409
        assert response.json()["detail"]


def test_admin_collect_succeeds_when_cooldown_is_disabled(tmp_path: Path) -> None:
    with build_client(tmp_path, manual_collect_min_interval_seconds=0) as client:
        response = client.post("/admin/collect")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] in {"success", "partial_success"}
        assert payload["client_mode"] == "sample"
        assert payload["raw_response_count"] >= 1


def test_admin_collect_requires_token_when_configured(tmp_path: Path) -> None:
    with build_client(tmp_path, admin_api_token="secret-token", manual_collect_min_interval_seconds=0) as client:
        missing = client.post("/admin/collect")
        wrong = client.post("/admin/collect", headers={"X-Admin-Token": "wrong-token"})
        accepted = client.post("/admin/collect", headers={"X-Admin-Token": "secret-token"})

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert accepted.status_code == 200


def test_admin_collector_status(client) -> None:
    response = client.get("/admin/collector-status")
    assert response.status_code == 200
    payload = response.json()

    assert payload["scheduler_enabled"] is False
    assert payload["collect_interval_seconds"] == 300
    assert payload["manual_collect_min_interval_seconds"] == 300
    assert payload["client_mode"] == "sample"
    assert payload["enabled_sources"] == ["kac_parking", "incheon_parking"]
    assert payload["data_go_kr_service_key_configured"] is False
    assert payload["supported_airport_codes"] == ["GMP", "PUS", "CJU"]
    assert_is_utc_iso(payload["latest_snapshot_observed_at"])
    assert_is_utc_iso(payload["latest_snapshot_collected_at"])
    assert isinstance(payload["manual_collect_blocked"], bool)
    if payload["manual_collect_available_at"] is not None:
        assert_is_utc_iso(payload["manual_collect_available_at"])
    assert payload["upstream_rate_limited"] is False
    assert payload["upstream_rate_limited_until"] is None
    assert payload["recent_runs"] == []


def test_admin_collector_status_reports_upstream_rate_limit(tmp_path: Path) -> None:
    with build_client(
        tmp_path,
        data_go_kr_service_key="test-key",
        use_sample_client_when_no_key=False,
        seed_sample_data=False,
    ) as client:
        asyncio.run(
            insert_collection_run(
                client,
                status="failed",
                trigger="scheduler",
                error_message="kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.",
            )
        )

        response = client.get("/admin/collector-status")
        assert response.status_code == 200
        payload = response.json()
        assert payload["upstream_rate_limited"] is True
        assert_is_utc_iso(payload["upstream_rate_limited_until"])


def test_admin_collect_returns_upstream_rate_limit_error(tmp_path: Path) -> None:
    with build_client(
        tmp_path,
        data_go_kr_service_key="test-key",
        use_sample_client_when_no_key=False,
        seed_sample_data=False,
        enable_incheon_collection=False,
        enable_incheon_fee_collection=False,
    ) as client:
        asyncio.run(
            insert_collection_run(
                client,
                status="failed",
                trigger="scheduler",
                error_message="kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.",
            )
        )

        response = client.post("/admin/collect")
        assert response.status_code == 429
        assert "공공데이터 API 요청 한도" in response.json()["detail"]


def test_admin_collect_continues_incheon_when_kac_rate_limited(tmp_path: Path) -> None:
    with build_client(
        tmp_path,
        seed_sample_data=False,
        enable_incheon_collection=True,
        enable_incheon_fee_collection=False,
    ) as client:
        service = client.app.state.collection_service
        blocked_state = type(
            "State",
            (),
            {
                "is_blocked": True,
                "blocked_until": now_utc() + timedelta(hours=1),
                "source": "kac_parking",
                "error_message": "kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.",
            },
        )()

        with patch.object(
            service,
            "get_upstream_rate_limit_state",
            new=AsyncMock(return_value=blocked_state),
        ):
            response = client.post("/admin/collect")

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "partial_success"
        assert payload["raw_response_count"] == 1
        assert payload["snapshot_count"] >= 1
        assert "LIMITED NUMBER OF SERVICE REQUESTS" in payload["errors"][0]


def test_admin_collector_status_does_not_extend_rate_limit_from_skipped_runs(tmp_path: Path) -> None:
    with build_client(
        tmp_path,
        data_go_kr_service_key="test-key",
        use_sample_client_when_no_key=False,
        seed_sample_data=False,
    ) as client:
        expired_failed_at = now_utc() - timedelta(days=2)
        recent_skipped_at = now_utc() - timedelta(minutes=5)
        asyncio.run(
            insert_collection_run(
                client,
                status="failed",
                trigger="scheduler",
                error_message="kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.",
                started_at=expired_failed_at,
            )
        )
        asyncio.run(
            insert_collection_run(
                client,
                status="skipped",
                trigger="scheduler",
                error_message=(
                    "kac_parking upstream rate limit active until 2099-01-01T00:05:00Z: "
                    "kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR."
                ),
                started_at=recent_skipped_at,
            )
        )

        response = client.get("/admin/collector-status")
        assert response.status_code == 200
        payload = response.json()
        assert payload["upstream_rate_limited"] is False
        assert payload["upstream_rate_limited_until"] is None


def test_admin_collect_raises_429_when_collection_fails_due_to_rate_limit(tmp_path: Path) -> None:
    with build_client(
        tmp_path,
        data_go_kr_service_key="test-key",
        use_sample_client_when_no_key=False,
        seed_sample_data=False,
    ) as client:
        service = client.app.state.collection_service
        unblocked_state = type(
            "State",
            (),
            {
                "is_blocked": False,
                "blocked_until": None,
            },
        )()
        blocked_state = type(
            "State",
            (),
            {
                "is_blocked": True,
                "blocked_until": now_utc() + timedelta(hours=1),
            },
        )()
        with patch.object(
            service,
            "collect",
            new=AsyncMock(
                return_value={
                    "collection_run_id": 1,
                    "status": "failed",
                    "client_mode": "live",
                    "raw_response_count": 1,
                    "snapshot_count": 0,
                    "fee_rule_count": 0,
                    "errors": ["kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR."],
                }
            ),
        ), patch.object(
            service,
            "get_upstream_rate_limit_state",
            new=AsyncMock(side_effect=[unblocked_state, blocked_state]),
        ):
            response = client.post("/admin/collect")

        assert response.status_code == 429
        assert "공공데이터 API 요청 한도" in response.json()["detail"]
