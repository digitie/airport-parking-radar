from __future__ import annotations

from datetime import date

from app.services.holidays import HolidayItem, collapse_holidays_by_date, format_holiday_sentence, parse_holiday_response


def test_parse_holiday_xml_normalizes_public_holiday_items() -> None:
    body = """<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>NORMAL SERVICE.</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <dateName>어린이날</dateName>
        <isHoliday>Y</isHoliday>
        <locdate>20260505</locdate>
      </item>
      <item>
        <dateName>기념일</dateName>
        <isHoliday>N</isHoliday>
        <locdate>20260509</locdate>
      </item>
    </items>
  </body>
</response>
"""

    items, error_message = parse_holiday_response(body)

    assert error_message is None
    assert len(items) == 2
    assert items[0].local_date == date(2026, 5, 5)
    assert items[0].name == "어린이날"
    assert items[0].is_holiday is True
    assert items[1].is_holiday is False


def test_parse_holiday_json_reports_upstream_error() -> None:
    body = """{
      "response": {
        "header": {
          "resultCode": "99",
          "resultMsg": "SERVICE ACCESS DENIED ERROR."
        }
      }
    }"""

    items, error_message = parse_holiday_response(body)

    assert items == []
    assert error_message == "holiday API error 99: SERVICE ACCESS DENIED ERROR."


def test_format_holiday_sentence_collapses_same_date_names() -> None:
    items = collapse_holidays_by_date(
        [
            HolidayItem(local_date=date(2026, 5, 5), name="어린이날"),
            HolidayItem(local_date=date(2026, 5, 5), name="부처님오신 날"),
        ]
    )

    assert format_holiday_sentence(items) == "5/5 (화) 부처님오신 날 / 어린이날 입니다."
