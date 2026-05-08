from __future__ import annotations

from datetime import date

from app.services.flight_status import parse_flight_status_xml, parse_incheon_flight_status_json, parse_kac_flight_detail_json


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
