from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.core.config import Settings
from app.services.collection import (
    CollectionService,
    FixturePublicDataClient,
    LivePublicDataClient,
    build_public_data_client,
    compute_upstream_rate_limit_retry_at,
    is_upstream_rate_limit_error,
    normalize_upstream_rate_limit_error,
    validate_source_response_body,
)


def test_build_public_data_client_uses_fixture_without_key() -> None:
    settings = Settings(
        data_go_kr_service_key=None,
        use_sample_client_when_no_key=True,
    )

    client = build_public_data_client(settings)

    assert isinstance(client, FixturePublicDataClient)


def test_build_public_data_client_requires_key_when_sample_disabled() -> None:
    settings = Settings(
        data_go_kr_service_key=None,
        use_sample_client_when_no_key=False,
    )

    with pytest.raises(ValueError):
        build_public_data_client(settings)


def test_build_public_data_client_uses_live_client_with_key() -> None:
    settings = Settings(
        data_go_kr_service_key="test-key",
        use_sample_client_when_no_key=False,
    )

    client = build_public_data_client(settings)

    assert isinstance(client, LivePublicDataClient)


def test_collection_service_reports_enabled_sources() -> None:
    settings = Settings(
        use_sample_client_when_no_key=True,
        enable_incheon_collection=True,
        enable_fee_collection=True,
        enable_incheon_fee_collection=True,
    )

    service = CollectionService(settings, client=FixturePublicDataClient())

    assert service.enabled_sources == ["kac_parking", "incheon_parking", "kac_fee", "incheon_fee"]


def test_validate_source_response_body_detects_kac_access_denied() -> None:
    with pytest.raises(ValueError, match="SERVICE ACCESS DENIED ERROR"):
        validate_source_response_body(
            "kac_parking",
            """<?xml version="1.0" encoding="UTF-8"?>
            <response>
              <header>
                <resultCode>99</resultCode>
                <resultMsg>SERVICE ACCESS DENIED ERROR.</resultMsg>
              </header>
            </response>
            """,
        )


def test_validate_source_response_body_detects_incheon_error_payload() -> None:
    with pytest.raises(ValueError, match="INVALID REQUEST"):
        validate_source_response_body(
            "incheon_parking",
            """{
              "response": {
                "header": {
                  "resultCode": "99",
                  "resultMsg": "INVALID REQUEST"
                }
              }
            }""",
        )


def test_validate_source_response_body_detects_incheon_fee_error_payload() -> None:
    with pytest.raises(ValueError, match="SERVICE ACCESS DENIED"):
        validate_source_response_body(
            "incheon_fee",
            """{
              "response": {
                "header": {
                  "resultCode": "99",
                  "resultMsg": "SERVICE ACCESS DENIED"
                }
              }
            }""",
        )


def test_is_upstream_rate_limit_error_detects_quota_message() -> None:
    assert is_upstream_rate_limit_error("kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR.")
    assert not is_upstream_rate_limit_error("kac_parking API error 99: SERVICE ACCESS DENIED ERROR.")


def test_compute_upstream_rate_limit_retry_at_uses_backoff_seconds() -> None:
    reference_at = datetime(2026, 4, 29, 8, 18, 2, tzinfo=ZoneInfo("UTC"))

    blocked_until = compute_upstream_rate_limit_retry_at(reference_at, 3600)

    assert blocked_until == datetime(2026, 4, 29, 9, 18, 2, tzinfo=ZoneInfo("UTC"))


def test_normalize_upstream_rate_limit_error_strips_nested_skip_prefix() -> None:
    normalized = normalize_upstream_rate_limit_error(
        "kac_parking upstream rate limit active until 2026-04-29T15:05:00Z: "
        "kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR."
    )

    assert normalized == "kac_parking API error 99: LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR."
