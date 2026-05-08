from __future__ import annotations

import json

from app.services.parsers import (
    parse_incheon_fee,
    parse_incheon_parking,
    parse_kac_congestion,
    parse_kac_fee,
    parse_kac_parking,
)


def test_parse_kac_congestion(fixtures_dir) -> None:
    xml_text = (fixtures_dir / "kac_congestion_gmp.xml").read_text(encoding="utf-8")
    parsed = parse_kac_congestion(xml_text, "GMP")

    assert len(parsed) == 2
    assert parsed[0].airport_code == "GMP"
    assert parsed[0].lot_name == "국내선 제1주차장"
    assert parsed[0].occupied_spaces == 482
    assert parsed[0].total_spaces == 510


def test_parse_kac_parking(fixtures_dir) -> None:
    xml_text = (fixtures_dir / "kac_parking_rt.xml").read_text(encoding="utf-8")
    parsed = parse_kac_parking(xml_text, allowed_airport_codes=["PUS", "CJU"])

    assert len(parsed) == 2
    assert {item.airport_code for item in parsed} == {"PUS", "CJU"}
    assert next(item for item in parsed if item.airport_code == "PUS").lot_name == "P3 여객(화물)주차장"
    assert next(item for item in parsed if item.airport_code == "PUS").lot_id == "pus-p3"
    assert next(item for item in parsed if item.airport_code == "CJU").lot_name == "P1 주차장"
    assert next(item for item in parsed if item.airport_code == "CJU").lot_id == "cju-p1"
    assert next(item for item in parsed if item.airport_code == "PUS").congestion_ratio == 92.1


def test_parse_incheon_parking(fixtures_dir) -> None:
    payload = json.loads((fixtures_dir / "incheon_parking.json").read_text(encoding="utf-8"))
    parsed = parse_incheon_parking(payload)

    assert len(parsed) == 2
    assert parsed[0].airport_code == "ICN"
    assert parsed[0].lot_name == "T1 단기주차장"
    assert parsed[1].total_spaces == 910


def test_parse_incheon_parking_accepts_live_timestamp_shape() -> None:
    parsed = parse_incheon_parking(
        {
            "response": {
                "body": {
                    "items": [
                        {
                            "floor": "T1 단기주차장지하1층",
                            "parking": "276",
                            "parkingarea": "378",
                            "datetm": "20260509060956.000",
                        }
                    ]
                }
            }
        }
    )

    assert parsed[0].lot_name == "T1 단기주차장지하1층"
    assert parsed[0].category == "short"
    assert parsed[0].observed_at.isoformat() == "2026-05-08T21:09:00+00:00"


def test_parse_incheon_fee_builds_short_and_long_rules() -> None:
    parsed = parse_incheon_fee(
        {
            "response": {
                "body": {
                    "items": [
                        {"charid": "FB00000001", "chardesc": "최초 00:30 에 한해 1200원 적용", "datetime": "202605080630"},
                        {"charid": "FB00000001", "chardesc": "00:15 초과 시 600원 부과", "datetime": "202605080630"},
                        {"charid": "FB00000002", "chardesc": "01:00 초과 시 1000원 부과", "datetime": "202605080630"},
                        {"charid": "NF00000001", "chardesc": "일일 최대 24000원 적용", "datetime": "202605080630"},
                        {"charid": "NF00000002", "chardesc": "일일 최대 9000원 적용", "datetime": "202605080630"},
                    ]
                }
            }
        }
    )

    short_rule = next(rule for rule in parsed if rule.parking_lot_name == "T1 단기주차장" and rule.day_type == "weekday")
    long_rule = next(rule for rule in parsed if rule.parking_lot_name == "T1 장기주차장" and rule.day_type == "weekday")
    assert short_rule.basic_minutes == 30
    assert short_rule.basic_fee == 1200
    assert short_rule.unit_minutes == 15
    assert short_rule.unit_fee == 600
    assert short_rule.daily_max_fee == 24000
    assert long_rule.basic_minutes == 60
    assert long_rule.basic_fee == 1000
    assert long_rule.daily_max_fee == 9000


def test_parse_kac_fee(fixtures_dir) -> None:
    xml_text = (fixtures_dir / "kac_fee_gmp.xml").read_text(encoding="utf-8")
    parsed = parse_kac_fee(xml_text, "GMP")

    assert len(parsed) == 4
    assert {rule.day_type for rule in parsed} == {"weekday", "holiday"}
    assert {rule.vehicle_size for rule in parsed} == {"small", "large"}
    assert next(rule for rule in parsed if rule.vehicle_size == "small" and rule.day_type == "weekday").basic_fee == 1000
