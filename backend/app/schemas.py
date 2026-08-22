from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ParkingLotSummary(BaseModel):
    id: int
    name: str
    terminal: str | None = None
    category: str | None = None
    is_active: bool


class AirportSummary(BaseModel):
    code: str
    name_ko: str
    name_en: str | None = None
    source: str
    parking_lots: list[ParkingLotSummary]


class ParkingStatus(BaseModel):
    airport_code: str
    airport_name: str
    parking_lot_id: int
    parking_lot_name: str
    terminal: str | None = None
    category: str | None = None
    observed_at: datetime
    collected_at: datetime
    occupied_spaces: int
    total_spaces: int
    available_spaces: int
    congestion_label: str | None = None
    congestion_ratio: float | None = None
    status_level: str


class ParkingCurrentResponse(BaseModel):
    generated_at: datetime
    items: list[ParkingStatus]


class HistoryPoint(BaseModel):
    observed_at: datetime
    occupied_spaces: int
    total_spaces: int
    available_spaces: int


class ParkingHistoryResponse(BaseModel):
    items: list[HistoryPoint]


class TimeSeriesPoint(BaseModel):
    bucket_at: datetime
    available_spaces: int
    occupied_spaces: int
    total_spaces: int
    lot_observations: int


class ParkingTimeSeriesResponse(BaseModel):
    generated_at: datetime
    airport_code: str | None = None
    parking_lot_id: int | None = None
    days: int
    interval_minutes: int
    future_hours: int = 0
    items: list[TimeSeriesPoint]


class FlightStatusItem(BaseModel):
    airport_code: str
    direction: str
    flight_number: str
    codeshare_flight_numbers: list[str] = Field(default_factory=list)
    airline: str | None = None
    scheduled_at: datetime
    estimated_at: datetime | None = None
    marker_at: datetime
    origin_airport: str
    destination_airport: str
    status: str | None = None
    line_type: str | None = None


class FlightStatusResponse(BaseModel):
    generated_at: datetime
    airport_code: str
    local_date: str
    source: str
    status: str
    error_message: str | None = None
    items: list[FlightStatusItem]


class HourlyBucket(BaseModel):
    hour: int
    average_available_spaces: float
    min_available_spaces: int
    max_available_spaces: int
    observations: int


class WeekdayBucket(BaseModel):
    weekday: int
    weekday_name: str
    average_available_spaces: float
    min_available_spaces: int
    max_available_spaces: int
    observations: int


class WeekdayHourBucket(BaseModel):
    hour: int
    average_available_spaces: float | None = None
    min_available_spaces: int | None = None
    max_available_spaces: int | None = None
    observations: int


class WeekdayHourlyPattern(BaseModel):
    weekday: int
    weekday_name: str
    average_available_spaces: float | None = None
    min_available_spaces: int | None = None
    max_available_spaces: int | None = None
    observations: int
    hourly_buckets: list[WeekdayHourBucket]


class HolidayItemSummary(BaseModel):
    local_date: str
    name: str
    weekday: int
    weekday_name: str


class HolidaySummaryResponse(BaseModel):
    generated_at: datetime
    start_date: str
    end_date: str
    source: str
    status: str
    error_message: str | None = None
    sentence: str
    items: list[HolidayItemSummary]


class HolidayPatternItem(BaseModel):
    local_date: str
    name: str
    day_type: Literal["holiday", "saturday", "sunday"] = "holiday"
    weekday: int
    weekday_name: str
    average_available_spaces: float | None = None
    min_available_spaces: int | None = None
    max_available_spaces: int | None = None
    observations: int
    hourly_buckets: list[WeekdayHourBucket]


class HolidayPatternResponse(BaseModel):
    generated_at: datetime
    airport_code: str | None = None
    parking_lot_id: int | None = None
    source: str
    status: str
    error_message: str | None = None
    items: list[HolidayPatternItem]


class ThresholdEvent(BaseModel):
    parking_lot_id: int
    parking_lot_name: str
    airport_code: str
    airport_name: str
    threshold: int
    direction: str
    crossed_at: datetime
    previous_available_spaces: int
    current_available_spaces: int


class ThresholdWeekdayTime(BaseModel):
    threshold: int
    weekday: int
    weekday_name: str
    typical_minutes_of_day: int | None = None
    sample_count: int


class ThresholdDateHistoryItem(BaseModel):
    threshold: int
    local_date: str
    weekday: int
    weekday_name: str
    crossed_at: datetime
    minutes_of_day: int
    available_spaces: int


class ThresholdInsightsResponse(BaseModel):
    generated_at: datetime
    airport_code: str | None = None
    parking_lot_id: int | None = None
    days: int
    interval_minutes: int
    weekday_items: list[ThresholdWeekdayTime]
    history_items: list[ThresholdDateHistoryItem]


class FeeCalculationRequest(BaseModel):
    airport_code: str
    parking_lot_id: int | None = None
    vehicle_size: str = Field(default="small")
    entry_at: datetime
    exit_at: datetime


class FeeBreakdown(BaseModel):
    date: str
    day_type: str
    duration_minutes: int
    applied_fee: int


class FeeCalculationResponse(BaseModel):
    supported: bool
    airport_code: str
    vehicle_size: str
    total_fee: int | None = None
    currency: str = "KRW"
    message: str | None = None
    breakdown: list[FeeBreakdown] = Field(default_factory=list)


class CollectionSummary(BaseModel):
    collection_run_id: int
    status: str
    client_mode: str
    raw_response_count: int
    snapshot_count: int
    fee_rule_count: int
    errors: list[str]


class CollectionRunStatus(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None = None
    status: str
    trigger: str
    error_message: str | None = None
    raw_response_count: int
    snapshot_count: int


class CollectorStatusResponse(BaseModel):
    scheduler_enabled: bool
    collect_interval_seconds: int
    manual_collect_min_interval_seconds: int
    client_mode: str
    enabled_sources: list[str]
    data_go_kr_service_key_configured: bool
    supported_airport_codes: list[str]
    latest_snapshot_observed_at: datetime | None = None
    latest_snapshot_collected_at: datetime | None = None
    manual_collect_available_at: datetime | None = None
    manual_collect_blocked: bool = False
    upstream_rate_limited: bool = False
    upstream_rate_limited_until: datetime | None = None
    last_run: CollectionRunStatus | None = None
    recent_runs: list[CollectionRunStatus]


class HealthResponse(BaseModel):
    status: str
    database: str
    seeded: bool


class BackupFile(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime


class BackupListResponse(BaseModel):
    items: list[BackupFile]


class BackupRestoreResponse(BaseModel):
    status: Literal["restored"]
    backup: BackupFile


class DashboardBootstrapResponse(BaseModel):
    """The minimum payload required to paint the first dashboard view."""

    airports: list[AirportSummary]
    current: ParkingCurrentResponse
    collector: CollectorStatusResponse
    holidays: HolidaySummaryResponse


class DashboardAnalyticsResponse(BaseModel):
    """Cached, lazy-loaded analytics returned in one network round trip."""

    threshold_events: list[ThresholdEvent]
    threshold_insights: ThresholdInsightsResponse
    weekday_hour_patterns: list[WeekdayHourlyPattern]
    holiday_patterns: HolidayPatternResponse
    time_series: ParkingTimeSeriesResponse
