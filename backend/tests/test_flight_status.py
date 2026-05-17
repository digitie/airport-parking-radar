from __future__ import annotations

import asyncio
import json
from datetime import date

import httpx

from app.core.config import Settings
from app.services.flight_status import (
    FlightSourceResponse,
    FlightStatusService,
    parse_flight_status_xml,
    parse_incheon_flight_status_json,
    parse_kac_flight_detail_json,
)


class _FlakyFlightStatusClient:
    def __init__(self) -> None:
        self.calls = 0

    async def fetch_status(self, airport_code: str, local_date: date) -> FlightSourceResponse:
        self.calls += 1
        if self.calls == 1:
            request = httpx.Request(
                "GET",
                "https://api.odcloud.kr/api/FlightStatusListDTL/v1/getFlightStatusListDetail?serviceKey=secret-key&page=1",
            )
            response = httpx.Response(400, request=request, text='{"message":"bad condition"}')
            raise httpx.HTTPStatusError(
                "Client error '400 Bad Request' for url "
                "'https://api.odcloud.kr/api/FlightStatusListDTL/v1/getFlightStatusListDetail?serviceKey=secret-key&page=1'",
                request=request,
                response=response,
            )

        body = json.dumps(
            {
                "data": [
                    {
                        "AIRLINE_ENGLISH": "AIR BUSAN",
                        "AIRPORT": airport_code,
                        "AIR_FLN": "BX8804",
                        "ARRIVED_ENG": "GIMPO",
                        "BOARDING_ENG": "GIMHAE",
                        "ETD": "0915",
                        "FLIGHT_DATE": local_date.strftime("%Y%m%d"),
                        "IO": "O",
                        "LINE": "DOMESTIC",
                        "RMK_ENG": "DEPARTED",
                        "STD": "0910",
                    }
                ]
            }
        )
        return FlightSourceResponse(
            source="kac_flight_detail_status",
            endpoint="https://api.odcloud.kr/api/FlightStatusListDTL/v1/getFlightStatusListDetail",
            request_params={"airport_code": airport_code},
            status_code=200,
            body_text=body,
        )


def test_flight_status_does_not_cache_or_leak_upstream_http_errors() -> None:
    service = FlightStatusService(
        Settings(
            data_go_kr_service_key=None,
            use_sample_client_when_no_key=False,
            flight_status_cache_seconds=300,
        )
    )
    flaky_client = _FlakyFlightStatusClient()
    service.client = flaky_client

    async def fetch_twice() -> tuple[dict, dict, dict]:
        first = await service.get_status("PUS", date(2026, 5, 17))
        second = await service.get_status("PUS", date(2026, 5, 17))
        third = await service.get_status("PUS", date(2026, 5, 17))
        return first, second, third

    first_payload, second_payload, third_payload = asyncio.run(fetch_twice())

    assert first_payload["status"] == "upstream_error"
    assert "secret-key" not in (first_payload["error_message"] or "")
    assert "serviceKey=" not in (first_payload["error_message"] or "")
    assert second_payload["status"] == "success"
    assert len(second_payload["items"]) == 1
    assert third_payload == second_payload
    assert flaky_client.calls == 2


def test_parse_flight_status_xml_reports_upstream_error() -> None:
    body = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>99</resultCode>
    <resultMsg>SERVICE ACCESS DENIED ERROR.</resultMsg>
  </header>
</response>
"""

    items, error_message = parse_flight_status_xml(body, "GMP", date(2026, 4, 25))

    assert items == []
    assert error_message == "kac_flight_status API error 99: SERVICE ACCESS DENIED ERROR."


def test_parse_flight_status_xml_normalizes_route_and_times() -> None:
    body = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <airFln>KE1101</airFln>
        <airlineKorean>대한항공</airlineKorean>
        <boardingKor>김포</boardingKor>
        <arrivedKor>제주</arrivedKor>
        <io>O</io>
        <line>국내</line>
        <std>0830</std>
        <etd>0840</etd>
        <rmkKor>출발</rmkKor>
      </item>
    </items>
  </body>
</response>
"""

    items, error_message = parse_flight_status_xml(body, "GMP", date(2026, 4, 25))

    assert error_message is None
    assert len(items) == 1
    assert items[0]["direction"] == "departure"
    assert items[0]["flight_number"] == "KE1101"
    assert items[0]["origin_airport"] == "김포"
    assert items[0]["destination_airport"] == "제주"
    assert items[0]["marker_at"].isoformat() == "2026-04-24T23:40:00+00:00"


def test_parse_kac_flight_detail_json_normalizes_odcloud_response() -> None:
    body = """{
      "page": 1,
      "perPage": 2,
      "totalCount": 1751281,
      "currentCount": 2,
      "matchCount": 2,
      "data": [
        {
          "AIRLINE_KOREAN": "제주항공",
          "AIRLINE_ENGLISH": "JEJU AIR",
          "AIRPORT": "GMP",
          "AIR_FLN": "7C104",
          "ARRIVED_KOR": "김포",
          "BOARDING_KOR": "제주",
          "CITY": "CJU",
          "ETD": "1032",
          "FLIGHT_DATE": "20260509",
          "IO": "I",
          "LINE": "국내",
          "RMK_KOR": "도착",
          "STD": "1040",
          "UFID": "20260509GMPI7C104"
        },
        {
          "AIRLINE_KOREAN": "대한항공",
          "AIRLINE_ENGLISH": "KOREAN AIR",
          "AIRPORT": "GMP",
          "AIR_FLN": "KE1101",
          "ARRIVED_KOR": "제주",
          "BOARDING_KOR": "김포",
          "CITY": "CJU",
          "ETD": "0840",
          "FLIGHT_DATE": "20260509",
          "IO": "O",
          "LINE": "국내",
          "RMK_KOR": "출발",
          "STD": "0830",
          "UFID": "20260509GMPOKE1101"
        }
      ]
    }"""

    items, error_message = parse_kac_flight_detail_json(body, "GMP", date(2026, 5, 9))

    assert error_message is None
    assert len(items) == 2
    assert items[0]["direction"] == "departure"
    assert items[0]["flight_number"] == "KE1101"
    assert items[0]["origin_airport"] == "김포"
    assert items[0]["destination_airport"] == "제주"
    assert items[0]["marker_at"].isoformat() == "2026-05-08T23:40:00+00:00"
    assert items[1]["direction"] == "arrival"
    assert items[1]["origin_airport"] == "제주"
    assert items[1]["destination_airport"] == "김포"


def test_parse_kac_flight_detail_json_groups_codeshare_markers() -> None:
    body = """{
      "data": [
        {
          "AIRLINE_KOREAN": "대한항공",
          "AIRPORT": "GMP",
          "AIR_FLN": "KE123",
          "ARRIVED_KOR": "제주",
          "BOARDING_KOR": "김포",
          "ETD": "0840",
          "FLIGHT_DATE": "20260509",
          "IO": "O",
          "LINE": "국내",
          "RMK_KOR": "출발",
          "STD": "0830"
        },
        {
          "AIRLINE_KOREAN": "델타항공",
          "AIRPORT": "GMP",
          "AIR_FLN": "DL9123",
          "ARRIVED_KOR": "제주",
          "BOARDING_KOR": "김포",
          "ETD": "0840",
          "FLIGHT_DATE": "20260509",
          "IO": "O",
          "LINE": "국내",
          "RMK_KOR": "출발",
          "STD": "0830"
        }
      ]
    }"""

    items, error_message = parse_kac_flight_detail_json(body, "GMP", date(2026, 5, 9))

    assert error_message is None
    assert len(items) == 1
    assert items[0]["flight_number"] == "DL9123 / KE123"
    assert items[0]["codeshare_flight_numbers"] == ["DL9123", "KE123"]
    assert items[0]["origin_airport"] == "김포"
    assert items[0]["destination_airport"] == "제주"


def test_parse_incheon_flight_status_json_normalizes_departures_and_arrivals() -> None:
    body = """{
      "departures": {
        "response": {
          "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
          "body": {
            "items": [
              {
                "airline": "에티오피아항공",
                "flightId": "ET673",
                "scheduleDateTime": "202605090020",
                "estimatedDateTime": "202605090043",
                "airport": "아디스아바바/볼레",
                "remark": "출발",
                "typeOfFlight": "I"
              }
            ]
          }
        }
      },
      "arrivals": {
        "response": {
          "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
          "body": {
            "items": [
              {
                "airline": "에어로케이항공",
                "flightId": "RF313",
                "scheduleDateTime": "202605090005",
                "estimatedDateTime": "202605090011",
                "airport": "오사카/ 간사이",
                "remark": "도착",
                "typeOfFlight": "I"
              }
            ]
          }
        }
      }
    }"""

    items, error_message = parse_incheon_flight_status_json(body, date(2026, 5, 9))

    assert error_message is None
    assert len(items) == 2
    assert items[0]["direction"] == "arrival"
    assert items[0]["origin_airport"] == "오사카/ 간사이"
    assert items[0]["destination_airport"] == "인천"
    assert items[1]["direction"] == "departure"
    assert items[1]["origin_airport"] == "인천"
    assert items[1]["destination_airport"] == "아디스아바바/볼레"
