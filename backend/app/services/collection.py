from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from xml.etree import ElementTree

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.time_utils import now_utc, serialize_utc
from app.models import Airport, CollectionRun, ParkingFeeRule, ParkingLot, ParkingSnapshot, RawApiResponse
from app.services.parsers import (
    ParsedFeeRule,
    ParsedParkingObservation,
    parse_incheon_fee,
    parse_incheon_parking,
    parse_kac_fee,
    parse_kac_parking,
)


KAC_PARKING_ENDPOINT = "http://openapi.airport.co.kr/service/rest/AirportParking/airportparkingRT"
INCHEON_PARKING_ENDPOINT = "http://apis.data.go.kr/B551177/StatusOfParking/getTrackingParking"
KAC_FEE_ENDPOINT = "http://openapi.airport.co.kr/service/rest/AirportParkingFee/parkingfee"
INCHEON_FEE_ENDPOINT = "http://apis.data.go.kr/B551177/ParkingChargeInfo/getParkingChargeInformation"
UPSTREAM_RATE_LIMIT_MARKER = "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR."

logger = logging.getLogger(__name__)

SAMPLE_KAC_PARKING_ITEMS = [
    {"aprEng": "GIMPO INTERNATIONAL AIRPORT", "aprKor": "김포국제공항", "parkingAirportCodeName": "국내선 제1주차장", "parkingFullSpace": "2279", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "1813", "parkingIoutcnt": "1507", "parkingIstay": "2046"},
    {"aprEng": "GIMPO INTERNATIONAL AIRPORT", "aprKor": "김포국제공항", "parkingAirportCodeName": "국내선 제2주차장", "parkingFullSpace": "1733", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "914", "parkingIoutcnt": "820", "parkingIstay": "1358"},
    {"aprEng": "GIMPO INTERNATIONAL AIRPORT", "aprKor": "김포국제공항", "parkingAirportCodeName": "국제선 주차빌딩", "parkingFullSpace": "567", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "301", "parkingIoutcnt": "282", "parkingIstay": "434"},
    {"aprEng": "GIMPO INTERNATIONAL AIRPORT", "aprKor": "김포국제공항", "parkingAirportCodeName": "국제선 지하", "parkingFullSpace": "599", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "318", "parkingIoutcnt": "295", "parkingIstay": "485"},
    {"aprEng": "GIMHAE INTERNATIONAL AIRPORT", "aprKor": "김해국제공항", "parkingAirportCodeName": "P1 여객주차장", "parkingFullSpace": "2005", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "1114", "parkingIoutcnt": "970", "parkingIstay": "1782"},
    {"aprEng": "GIMHAE INTERNATIONAL AIRPORT", "aprKor": "김해국제공항", "parkingAirportCodeName": "P2 여객주차장", "parkingFullSpace": "2453", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "1337", "parkingIoutcnt": "1255", "parkingIstay": "2362"},
    {"aprEng": "GIMHAE INTERNATIONAL AIRPORT", "aprKor": "김해국제공항", "parkingAirportCodeName": "P3 여객(화물)", "parkingFullSpace": "878", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "342", "parkingIoutcnt": "349", "parkingIstay": "809"},
    {"aprEng": "JEJU INTERNATIONAL AIRPORT", "aprKor": "제주국제공항", "parkingAirportCodeName": "P1주차장", "parkingFullSpace": "1763", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "3573", "parkingIoutcnt": "3333", "parkingIstay": "1417"},
    {"aprEng": "JEJU INTERNATIONAL AIRPORT", "aprKor": "제주국제공항", "parkingAirportCodeName": "P2장기주차장", "parkingFullSpace": "488", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "124", "parkingIoutcnt": "109", "parkingIstay": "325"},
    {"aprEng": "JEJU INTERNATIONAL AIRPORT", "aprKor": "제주국제공항", "parkingAirportCodeName": "화물주차장", "parkingFullSpace": "732", "parkingGetdate": "2026-04-25", "parkingGettime": "09:20:03", "parkingIincnt": "98", "parkingIoutcnt": "92", "parkingIstay": "418"},
]

SAMPLE_INCHEON_JSON = json.dumps(
    {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
            "body": {
                "items": {
                    "item": [
                        {"floor": "T1 단기주차장", "parking": "575", "parkingarea": "640", "datetm": "2026-04-25 09:20"},
                        {"floor": "T2 장기주차장", "parking": "832", "parkingarea": "910", "datetm": "2026-04-25 09:20"},
                    ]
                }
            },
        }
    },
    ensure_ascii=False,
)

SAMPLE_INCHEON_FEE_JSON = json.dumps(
    {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {
                "items": [
                    {"charid": "FB00000001", "chardesc": "최초 00:30 에 한해 1200원 적용", "datetime": "202605080630"},
                    {"charid": "FB00000001", "chardesc": "00:15 초과 시 600원 부과", "datetime": "202605080630"},
                    {"charid": "FB00000002", "chardesc": "01:00 초과 시 1000원 부과", "datetime": "202605080630"},
                    {"charid": "FB00000003", "chardesc": "00:30 초과 시 1200원 부과", "datetime": "202605080630"},
                    {"charid": "NF00000001", "chardesc": "일일 최대 24000원 적용", "datetime": "202605080630"},
                    {"charid": "NF00000002", "chardesc": "일일 최대 9000원 적용", "datetime": "202605080630"},
                    {"charid": "NF00000003", "chardesc": "일일 최대 12000원 적용", "datetime": "202605080630"},
                ]
            },
        }
    },
    ensure_ascii=False,
)

SAMPLE_KAC_FEE_LOT_NAMES = {
    "GMP": ("김포국제공항", ["국내선 제1주차장", "국내선 제2주차장", "국제선 지하주차장", "국제선 주차빌딩"]),
    "PUS": ("김해국제공항", ["P1 여객주차장", "P2 여객주차장", "P3 여객(화물)주차장"]),
    "CJU": ("제주국제공항", ["P1 주차장", "P2 장기주차장", "화물터미널주차장"]),
}


def _build_kac_parking_xml() -> str:
    item_xml = []
    for item in SAMPLE_KAC_PARKING_ITEMS:
        item_xml.append(
            "<item>"
            + "".join(f"<{key}>{value}</{key}>" for key, value in item.items())
            + "</item>"
        )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<response>
  <body>
    <items>
      {"".join(item_xml)}
    </items>
  </body>
</response>
"""


def _build_kac_fee_xml(airport_code: str) -> str:
    airport_name, lot_names = SAMPLE_KAC_FEE_LOT_NAMES.get(airport_code, SAMPLE_KAC_FEE_LOT_NAMES["GMP"])
    item_xml = []
    for lot_name in lot_names:
        item_xml.append(
            f"""<item>
        <SITE_NAME>{airport_name}</SITE_NAME>
        <PARKING_PARKING_NAME>{lot_name}</PARKING_PARKING_NAME>
        <PARKING_BASIC_ACCOUNT>1000</PARKING_BASIC_ACCOUNT>
        <PARKING_BASIC_M>30</PARKING_BASIC_M>
        <PARKING_FREE_M>30</PARKING_FREE_M>
        <PARKING_MINUTE_ACCOUNT>500</PARKING_MINUTE_ACCOUNT>
        <PARKING_MINUTE_M>15</PARKING_MINUTE_M>
        <PARKING_MAX_ACCOUNT>20000</PARKING_MAX_ACCOUNT>
        <PARKING_HOLI_BASIC_ACCOUNT>1500</PARKING_HOLI_BASIC_ACCOUNT>
        <PARKING_HOLI_BASIC_M>30</PARKING_HOLI_BASIC_M>
        <PARKING_HOLI_FREE_M>30</PARKING_HOLI_FREE_M>
        <PARKING_HOLI_MINUTE_ACCOUNT>700</PARKING_HOLI_MINUTE_ACCOUNT>
        <PARKING_HOLI_MINUTE_M>15</PARKING_HOLI_MINUTE_M>
        <PARKING_HOLI_MAX_ACCOUNT>25000</PARKING_HOLI_MAX_ACCOUNT>
        <PARKING_BASIC_ACCOUNTD>1200</PARKING_BASIC_ACCOUNTD>
        <PARKING_BASIC_MD>30</PARKING_BASIC_MD>
        <PARKING_FREE_MD>30</PARKING_FREE_MD>
        <PARKING_MINUTE_ACCOUNTD>600</PARKING_MINUTE_ACCOUNTD>
        <PARKING_MINUTE_MD>15</PARKING_MINUTE_MD>
        <PARKING_MAX_ACCOUNTD>25000</PARKING_MAX_ACCOUNTD>
        <PARKING_HOLI_BASIC_ACCOUNTD>1800</PARKING_HOLI_BASIC_ACCOUNTD>
        <PARKING_HOLI_BASIC_MD>30</PARKING_HOLI_BASIC_MD>
        <PARKING_HOLI_FREE_MD>30</PARKING_HOLI_FREE_MD>
        <PARKING_HOLI_MINUTE_ACCOUNTD>800</PARKING_HOLI_MINUTE_ACCOUNTD>
        <PARKING_HOLI_MINUTE_MD>15</PARKING_HOLI_MINUTE_MD>
        <PARKING_HOLI_MAX_ACCOUNTD>30000</PARKING_HOLI_MAX_ACCOUNTD>
      </item>"""
        )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<response>
  <body>
    <items>
      {"".join(item_xml)}
    </items>
  </body>
</response>
"""


@dataclass(slots=True)
class SourceResponse:
    source: str
    endpoint: str
    request_params: dict[str, Any]
    status_code: int
    body_text: str


@dataclass(slots=True)
class UpstreamRateLimitState:
    is_blocked: bool
    blocked_until: datetime | None = None
    source: str | None = None
    error_message: str | None = None


class PublicDataClient:
    async def fetch_kac_parking(self) -> SourceResponse:
        raise NotImplementedError

    async def fetch_incheon_parking(self) -> SourceResponse:
        raise NotImplementedError

    async def fetch_incheon_fee(self) -> SourceResponse:
        raise NotImplementedError

    async def fetch_kac_fee(self, airport_code: str) -> SourceResponse:
        raise NotImplementedError


class FixturePublicDataClient(PublicDataClient):
    async def fetch_kac_parking(self) -> SourceResponse:
        return SourceResponse(
            source="kac_parking",
            endpoint=KAC_PARKING_ENDPOINT,
            request_params={"scope": "all"},
            status_code=200,
            body_text=_build_kac_parking_xml(),
        )

    async def fetch_incheon_parking(self) -> SourceResponse:
        return SourceResponse(
            source="incheon_parking",
            endpoint=INCHEON_PARKING_ENDPOINT,
            request_params={"type": "json"},
            status_code=200,
            body_text=SAMPLE_INCHEON_JSON,
        )

    async def fetch_incheon_fee(self) -> SourceResponse:
        return SourceResponse(
            source="incheon_fee",
            endpoint=INCHEON_FEE_ENDPOINT,
            request_params={"type": "json"},
            status_code=200,
            body_text=SAMPLE_INCHEON_FEE_JSON,
        )

    async def fetch_kac_fee(self, airport_code: str) -> SourceResponse:
        return SourceResponse(
            source="kac_fee",
            endpoint=KAC_FEE_ENDPOINT,
            request_params={"schAirportCode": airport_code},
            status_code=200,
            body_text=_build_kac_fee_xml(airport_code),
        )


class LivePublicDataClient(PublicDataClient):
    def __init__(self, settings: Settings) -> None:
        if not settings.data_go_kr_service_key:
            raise ValueError("공공데이터 서비스 키가 필요합니다.")
        self.settings = settings

    async def _request(self, endpoint: str, params: dict[str, Any], source: str) -> SourceResponse:
        async with httpx.AsyncClient(timeout=self.settings.api_timeout_seconds) as client:
            response = await client.get(endpoint, params=params)
            response.raise_for_status()
            return SourceResponse(
                source=source,
                endpoint=endpoint,
                request_params=params,
                status_code=response.status_code,
                body_text=response.text,
            )

    async def fetch_kac_parking(self) -> SourceResponse:
        return await self._request(
            KAC_PARKING_ENDPOINT,
            {
                "serviceKey": self.settings.data_go_kr_service_key,
            },
            "kac_parking",
        )

    async def fetch_incheon_parking(self) -> SourceResponse:
        return await self._request(
            INCHEON_PARKING_ENDPOINT,
            {
                "serviceKey": self.settings.data_go_kr_service_key,
                "pageNo": 1,
                "numOfRows": 50,
                "type": "json",
            },
            "incheon_parking",
        )

    async def fetch_incheon_fee(self) -> SourceResponse:
        return await self._request(
            INCHEON_FEE_ENDPOINT,
            {
                "serviceKey": self.settings.data_go_kr_service_key,
                "pageNo": 1,
                "numOfRows": 100,
                "type": "json",
            },
            "incheon_fee",
        )

    async def fetch_kac_fee(self, airport_code: str) -> SourceResponse:
        return await self._request(
            KAC_FEE_ENDPOINT,
            {
                "serviceKey": self.settings.data_go_kr_service_key,
                "pageNo": 1,
                "numOfRows": 50,
                "schAirportCode": airport_code,
            },
            "kac_fee",
        )


def validate_source_response_body(source: str, body_text: str) -> None:
    if source in {"kac_parking", "kac_congestion", "kac_fee"}:
        root = ElementTree.fromstring(body_text)
        result_code = (root.findtext(".//resultCode") or "").strip()
        result_msg = (root.findtext(".//resultMsg") or "").strip()
        if result_code and result_code not in {"00", "0"}:
            raise ValueError(f"{source} API error {result_code}: {result_msg}")
        return

    if source in {"incheon_parking", "incheon_fee"}:
        document = json.loads(body_text)
        header = document.get("response", {}).get("header", {})
        result_code = str(header.get("resultCode") or "").strip()
        result_msg = str(header.get("resultMsg") or "").strip()
        if result_code and result_code not in {"00", "0"}:
            raise ValueError(f"{source} API error {result_code}: {result_msg}")


def build_public_data_client(settings: Settings) -> PublicDataClient:
    if settings.data_go_kr_service_key:
        return LivePublicDataClient(settings)
    if settings.use_sample_client_when_no_key:
        return FixturePublicDataClient()
    raise ValueError("DATA_GO_KR_SERVICE_KEY가 없으면 실데이터 수집을 시작할 수 없습니다.")


def is_upstream_rate_limit_error(message: str | None) -> bool:
    if not message:
        return False
    return UPSTREAM_RATE_LIMIT_MARKER in message.upper()


def normalize_upstream_rate_limit_error(message: str | None) -> str:
    if not is_upstream_rate_limit_error(message):
        return message or UPSTREAM_RATE_LIMIT_MARKER
    if message and "upstream rate limit active until" not in message.lower():
        return message
    return f"kac_parking API error 99: {UPSTREAM_RATE_LIMIT_MARKER}"


def compute_upstream_rate_limit_retry_at(reference_at: datetime, backoff_seconds: int) -> datetime:
    return serialize_utc(reference_at) + timedelta(seconds=max(backoff_seconds, 0))


class CollectionService:
    def __init__(self, settings: Settings, client: PublicDataClient | None = None) -> None:
        self.settings = settings
        self.client = client or build_public_data_client(settings)

    @property
    def client_mode(self) -> str:
        return "live" if isinstance(self.client, LivePublicDataClient) else "sample"

    @property
    def enabled_sources(self) -> list[str]:
        sources = ["kac_parking"]
        if self.settings.enable_incheon_collection:
            sources.append("incheon_parking")
        if self.settings.enable_fee_collection:
            sources.append("kac_fee")
        if self.settings.enable_incheon_fee_collection:
            sources.append("incheon_fee")
        return sources

    async def get_upstream_rate_limit_state(self, session: AsyncSession) -> UpstreamRateLimitState:
        if self.client_mode != "live":
            return UpstreamRateLimitState(is_blocked=False)

        latest_run = await session.scalar(
            select(CollectionRun)
            .where(CollectionRun.status != "skipped")
            .order_by(CollectionRun.started_at.desc(), CollectionRun.id.desc())
            .limit(1)
        )
        if latest_run is None or not is_upstream_rate_limit_error(latest_run.error_message):
            return UpstreamRateLimitState(is_blocked=False)

        blocked_until = compute_upstream_rate_limit_retry_at(
            latest_run.started_at,
            self.settings.upstream_rate_limit_backoff_seconds,
        )
        if now_utc() >= blocked_until:
            return UpstreamRateLimitState(is_blocked=False)

        return UpstreamRateLimitState(
            is_blocked=True,
            blocked_until=blocked_until,
            source="kac_parking",
            error_message=normalize_upstream_rate_limit_error(latest_run.error_message),
        )

    async def collect(self, session: AsyncSession, trigger: str = "manual") -> dict[str, Any]:
        rate_limit_state = await self.get_upstream_rate_limit_state(session)
        can_collect_incheon = self.settings.enable_incheon_collection or self.settings.enable_incheon_fee_collection
        if rate_limit_state.is_blocked and rate_limit_state.blocked_until is not None and not can_collect_incheon:
            return await self._store_rate_limit_skip(session, trigger, rate_limit_state)

        started_at = now_utc()
        run = CollectionRun(started_at=started_at, finished_at=None, status="running", trigger=trigger, error_message=None)
        session.add(run)
        await session.flush()

        errors: list[str] = []
        raw_count = 0
        snapshot_count = 0
        fee_rule_count = 0

        try:
            if rate_limit_state.is_blocked:
                errors.append(
                    normalize_upstream_rate_limit_error(rate_limit_state.error_message)
                    or f"kac_parking API error 99: {UPSTREAM_RATE_LIMIT_MARKER}"
                )
            else:
                response = await self._safe_fetch(session, run, self.client.fetch_kac_parking, errors)
                if response is not None:
                    raw_count += 1
                    parsed = parse_kac_parking(
                        response.body_text,
                        allowed_airport_codes=self.settings.supported_airport_codes,
                    )
                    snapshot_count += await self._store_observations(session, run.id, parsed)

            if self.settings.enable_incheon_collection:
                response = await self._safe_fetch(session, run, self.client.fetch_incheon_parking, errors)
                if response is None:
                    pass
                else:
                    raw_count += 1
                    parsed = parse_incheon_parking(response.body_text)
                    snapshot_count += await self._store_observations(session, run.id, parsed)

            if self.settings.enable_fee_collection and not rate_limit_state.is_blocked:
                for airport_code in self.settings.supported_airport_codes:
                    if airport_code == "ICN":
                        continue
                    response = await self._safe_fetch(
                        session,
                        run,
                        lambda airport_code=airport_code: self.client.fetch_kac_fee(airport_code),
                        errors,
                    )
                    if response is None:
                        continue
                    raw_count += 1
                    parsed_rules = parse_kac_fee(response.body_text, airport_code)
                    fee_rule_count += await self._store_fee_rules(session, parsed_rules)

            if self.settings.enable_incheon_fee_collection:
                response = await self._safe_fetch(session, run, self.client.fetch_incheon_fee, errors)
                if response is not None:
                    raw_count += 1
                    parsed_rules = parse_incheon_fee(response.body_text)
                    fee_rule_count += await self._store_fee_rules(session, parsed_rules)

            if not errors:
                run.status = "success"
            elif raw_count == 0 and snapshot_count == 0 and fee_rule_count == 0:
                run.status = "failed"
            else:
                run.status = "partial_success"
        except Exception as exc:
            run.status = "failed"
            errors.append(str(exc))
            raise
        finally:
            run.finished_at = now_utc()
            run.error_message = "\n".join(errors) if errors else None
            await session.commit()

        logger.info(
            "collection finished run_id=%s trigger=%s status=%s client_mode=%s raw=%s snapshots=%s fee_rules=%s errors=%s",
            run.id,
            trigger,
            run.status,
            self.client_mode,
            raw_count,
            snapshot_count,
            fee_rule_count,
            len(errors),
        )

        return {
            "collection_run_id": run.id,
            "status": run.status,
            "client_mode": self.client_mode,
            "raw_response_count": raw_count,
            "snapshot_count": snapshot_count,
            "fee_rule_count": fee_rule_count,
            "errors": errors,
        }

    async def _store_rate_limit_skip(
        self,
        session: AsyncSession,
        trigger: str,
        rate_limit_state: UpstreamRateLimitState,
    ) -> dict[str, Any]:
        started_at = now_utc()
        blocked_until = rate_limit_state.blocked_until or started_at
        blocked_until_iso = serialize_utc(blocked_until).isoformat().replace("+00:00", "Z")
        error_message = (
            f"{rate_limit_state.source or 'kac_parking'} upstream rate limit active until "
            f"{blocked_until_iso}: {rate_limit_state.error_message or UPSTREAM_RATE_LIMIT_MARKER}"
        )
        run = CollectionRun(
            started_at=started_at,
            finished_at=started_at,
            status="skipped",
            trigger=trigger,
            error_message=error_message,
        )
        session.add(run)
        await session.commit()
        logger.warning(
            "collection skipped trigger=%s client_mode=%s blocked_until=%s reason=%s",
            trigger,
            self.client_mode,
            blocked_until_iso,
            rate_limit_state.error_message,
        )
        return {
            "collection_run_id": run.id,
            "status": run.status,
            "client_mode": self.client_mode,
            "raw_response_count": 0,
            "snapshot_count": 0,
            "fee_rule_count": 0,
            "errors": [error_message],
        }

    async def _safe_fetch(
        self,
        session: AsyncSession,
        run: CollectionRun,
        fetcher,
        errors: list[str],
    ) -> SourceResponse | None:
        try:
            response = await fetcher()
            raw = RawApiResponse(
                collection_run_id=run.id,
                source=response.source,
                endpoint=response.endpoint,
                request_params_json=response.request_params,
                status_code=response.status_code,
                body_text=response.body_text,
                received_at=now_utc(),
                parse_status="received",
                parse_error=None,
            )
            session.add(raw)
            await session.flush()
            try:
                validate_source_response_body(response.source, response.body_text)
            except Exception as exc:
                raw.parse_status = "failed"
                raw.parse_error = str(exc)
                await session.flush()
                errors.append(str(exc))
                return None
            return response
        except Exception as exc:
            errors.append(str(exc))
            session.add(
                RawApiResponse(
                    collection_run_id=run.id,
                    source="error",
                    endpoint="unknown",
                    request_params_json=None,
                    status_code=0,
                    body_text="",
                    received_at=now_utc(),
                    parse_status="failed",
                    parse_error=str(exc),
                )
            )
            await session.flush()
            return None

    async def _get_or_create_airport(
        self,
        session: AsyncSession,
        airport_code: str,
        name_ko: str,
        name_en: str | None,
        source: str,
    ) -> Airport:
        airport = await session.scalar(select(Airport).where(Airport.code == airport_code))
        timestamp = now_utc()
        if airport is None:
            airport = Airport(
                code=airport_code,
                name_ko=name_ko,
                name_en=name_en,
                source=source,
                created_at=timestamp,
                updated_at=timestamp,
            )
            session.add(airport)
            await session.flush()
        else:
            airport.name_ko = name_ko
            airport.name_en = name_en
            airport.updated_at = timestamp
        return airport

    async def _get_or_create_lot(
        self,
        session: AsyncSession,
        airport_id: int,
        source_lot_id: str,
        name: str,
        terminal: str | None,
        category: str | None,
        total_spaces: int,
    ) -> ParkingLot:
        lot = await session.scalar(
            select(ParkingLot).where(ParkingLot.airport_id == airport_id, ParkingLot.source_lot_id == source_lot_id)
        )
        timestamp = now_utc()
        if lot is None:
            lot = ParkingLot(
                airport_id=airport_id,
                source_lot_id=source_lot_id,
                name=name,
                terminal=terminal,
                category=category,
                total_spaces_hint=total_spaces,
                is_active=total_spaces > 0,
                created_at=timestamp,
                updated_at=timestamp,
            )
            session.add(lot)
            await session.flush()
        else:
            lot.name = name
            lot.terminal = terminal
            lot.category = category
            lot.total_spaces_hint = total_spaces
            lot.is_active = total_spaces > 0
            lot.updated_at = timestamp
        return lot

    async def _store_observations(
        self,
        session: AsyncSession,
        collection_run_id: int,
        observations: list[ParsedParkingObservation],
    ) -> int:
        stored = 0
        for observation in observations:
            airport = await self._get_or_create_airport(
                session,
                observation.airport_code,
                observation.airport_name_ko,
                observation.airport_name_en,
                "incheon" if observation.airport_code == "ICN" else "kac",
            )
            lot = await self._get_or_create_lot(
                session,
                airport.id,
                observation.lot_id,
                observation.lot_name,
                observation.terminal,
                observation.category,
                observation.total_spaces,
            )

            existing = await session.scalar(
                select(ParkingSnapshot).where(
                    ParkingSnapshot.parking_lot_id == lot.id,
                    ParkingSnapshot.observed_at == observation.observed_at,
                    ParkingSnapshot.source == observation.source,
                )
            )
            if existing is not None:
                continue

            available_spaces = max(observation.total_spaces - observation.occupied_spaces, 0)
            session.add(
                ParkingSnapshot(
                    collection_run_id=collection_run_id,
                    airport_id=airport.id,
                    parking_lot_id=lot.id,
                    source=observation.source,
                    observed_at=observation.observed_at,
                    collected_at=now_utc(),
                    occupied_spaces=observation.occupied_spaces,
                    total_spaces=observation.total_spaces,
                    available_spaces=available_spaces,
                    congestion_label=observation.congestion_label,
                    congestion_ratio=observation.congestion_ratio,
                    raw_item_json=observation.raw_item,
                )
            )
            stored += 1
        await session.flush()
        return stored

    async def _store_fee_rules(self, session: AsyncSession, rules: list[ParsedFeeRule]) -> int:
        stored = 0
        for rule in rules:
            airport = await session.scalar(select(Airport).where(Airport.code == rule.airport_code))
            if airport is None:
                airport = await self._get_or_create_airport(
                    session,
                    rule.airport_code,
                    rule.airport_name,
                    None,
                    "incheon" if rule.airport_code == "ICN" else "kac",
                )

            lot_ids = [None]
            if rule.parking_lot_name:
                lot = await session.scalar(
                    select(ParkingLot).where(ParkingLot.airport_id == airport.id, ParkingLot.name == rule.parking_lot_name)
                )
                if lot is not None:
                    lot_ids = [lot.id]
                elif rule.airport_code == "ICN":
                    matching_lots = (
                        await session.execute(
                            select(ParkingLot).where(
                                ParkingLot.airport_id == airport.id,
                                ParkingLot.name.startswith(rule.parking_lot_name),
                            )
                        )
                    ).scalars().all()
                    if matching_lots:
                        lot_ids = [matching_lot.id for matching_lot in matching_lots]

            for lot_id in lot_ids:
                existing = await session.scalar(
                    select(ParkingFeeRule).where(
                        ParkingFeeRule.airport_id == airport.id,
                        ParkingFeeRule.parking_lot_id == lot_id,
                        ParkingFeeRule.vehicle_size == rule.vehicle_size,
                        ParkingFeeRule.day_type == rule.day_type,
                    )
                )

                if existing is None:
                    existing = ParkingFeeRule(
                        airport_id=airport.id,
                        parking_lot_id=lot_id,
                        vehicle_size=rule.vehicle_size,
                        day_type=rule.day_type,
                        free_minutes=rule.free_minutes,
                        basic_minutes=rule.basic_minutes,
                        basic_fee=rule.basic_fee,
                        unit_minutes=rule.unit_minutes,
                        unit_fee=rule.unit_fee,
                        daily_max_fee=rule.daily_max_fee,
                        source_updated_at=rule.source_updated_at,
                        raw_item_json=rule.raw_item,
                    )
                    session.add(existing)
                    stored += 1
                else:
                    existing.free_minutes = rule.free_minutes
                    existing.basic_minutes = rule.basic_minutes
                    existing.basic_fee = rule.basic_fee
                    existing.unit_minutes = rule.unit_minutes
                    existing.unit_fee = rule.unit_fee
                    existing.daily_max_fee = rule.daily_max_fee
                    existing.source_updated_at = rule.source_updated_at
                    existing.raw_item_json = rule.raw_item

        await session.flush()
        return stored
