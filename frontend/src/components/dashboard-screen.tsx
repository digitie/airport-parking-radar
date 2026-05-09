"use client";

import type { CSSProperties } from "react";

import { DailyFlightOverlayChart } from "@/components/daily-flight-overlay-chart";
import { HistoryChart } from "@/components/history-chart";
import { formatDateTimeWithZone, formatMinutesOfDay, formatNumber } from "@/lib/format";
import type {
  Airport,
  CollectorStatusResponse,
  FlightStatusResponse,
  HolidayPatternItem,
  HolidayPatternResponse,
  HolidaySummaryResponse,
  ParkingLot,
  ParkingStatus,
  ParkingTimeSeriesResponse,
  ThresholdDateHistoryItem,
  ThresholdEvent,
  ThresholdInsightsResponse,
  ThresholdWeekdayTime,
  WeekdayHourBucket,
  WeekdayHourlyPattern,
} from "@/lib/types";

type DashboardScreenProps = {
  airports: Airport[];
  parkingLots: ParkingLot[];
  selectedAirportCode: string;
  selectedParkingLotId: number | null;
  selectedParkingLotName: string | null;
  scopeItems: ParkingStatus[];
  currentItems: ParkingStatus[];
  thresholdEvents: ThresholdEvent[];
  thresholdInsights: ThresholdInsightsResponse | null;
  weekdayHourlyPatterns: WeekdayHourlyPattern[];
  holidaySummary: HolidaySummaryResponse | null;
  holidayPatterns: HolidayPatternResponse | null;
  timeSeries: ParkingTimeSeriesResponse | null;
  flightStatus: FlightStatusResponse | null;
  collectorStatus: CollectorStatusResponse | null;
  isMobile: boolean;
  loading: boolean;
  collecting: boolean;
  error: string | null;
  actionMessage: string | null;
  actionMessageIsError: boolean;
  onAirportChange: (airportCode: string) => void;
  onParkingLotChange: (parkingLotId: number | null) => void;
  onRefresh: () => void;
  onManualCollect: () => void;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const THRESHOLDS = [50, 10] as const;

function statusTone(statusLevel: ParkingStatus["status_level"]): string {
  switch (statusLevel) {
    case "full":
      return "tone-full";
    case "critical":
      return "tone-critical";
    case "warning":
      return "tone-warning";
    case "busy":
      return "tone-busy";
    default:
      return "tone-stable";
  }
}

function statusLabel(statusLevel: ParkingStatus["status_level"]): string {
  switch (statusLevel) {
    case "full":
      return "만차";
    case "critical":
      return "10대 미만";
    case "warning":
      return "50대 미만";
    case "busy":
      return "여유 적음";
    default:
      return "원활";
  }
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatThresholdLabel(threshold: number): string {
  return `${formatNumber(threshold)}대 미만`;
}

function formatDateCell(localDate: string, weekdayName: string): string {
  const [year, month, day] = localDate.split("-");
  if (!year || !month || !day) {
    return `${localDate} (${weekdayName})`;
  }
  return `${month}.${day} (${weekdayName})`;
}

function formatHolidayDate(localDate: string, weekdayName: string): string {
  const [year, month, day] = localDate.split("-");
  if (!year || !month || !day) {
    return `${localDate} (${weekdayName})`;
  }
  return `${Number(month)}/${Number(day)} (${weekdayName})`;
}

function getObservedBuckets(hourlyBuckets: WeekdayHourBucket[]): WeekdayHourBucket[] {
  return hourlyBuckets.filter(
    (bucket): bucket is WeekdayHourBucket & { average_available_spaces: number } =>
      bucket.average_available_spaces !== null && bucket.observations > 0
  );
}

function buildAvailabilityHeatStyle(value: number | null, maxValue: number): CSSProperties | undefined {
  if (value === null || maxValue <= 0) {
    return undefined;
  }

  const ratio = Math.min(Math.max(value / maxValue, 0), 1);
  const hue = 6 + ratio * 214;
  const lightness = 86 - ratio * 30;

  return {
    background: `hsl(${hue} 78% ${lightness}%)`,
    borderColor: `hsla(${hue} 72% 38% / 0.16)`,
    color: ratio > 0.56 ? "white" : undefined,
  };
}

function summarizePattern(pattern: WeekdayHourlyPattern): {
  tightestHour: WeekdayHourBucket | null;
  loosestHour: WeekdayHourBucket | null;
} {
  const observedBuckets = getObservedBuckets(pattern.hourly_buckets);
  if (observedBuckets.length === 0) {
    return { tightestHour: null, loosestHour: null };
  }

  const sorted = [...observedBuckets].sort(
    (left, right) => (left.average_available_spaces ?? 0) - (right.average_available_spaces ?? 0)
  );

  return {
    tightestHour: sorted[0],
    loosestHour: sorted[sorted.length - 1],
  };
}

function summarizeHolidayPattern(pattern: HolidayPatternItem): {
  tightestHour: WeekdayHourBucket | null;
  loosestHour: WeekdayHourBucket | null;
} {
  const observedBuckets = getObservedBuckets(pattern.hourly_buckets);
  if (observedBuckets.length === 0) {
    return { tightestHour: null, loosestHour: null };
  }

  const sorted = [...observedBuckets].sort(
    (left, right) => (left.average_available_spaces ?? 0) - (right.average_available_spaces ?? 0)
  );

  return {
    tightestHour: sorted[0],
    loosestHour: sorted[sorted.length - 1],
  };
}

function summarizeAverageAvailability(patterns: WeekdayHourlyPattern[]): {
  tightest: { weekdayName: string; hour: number; value: number } | null;
  roomiest: { weekdayName: string; hour: number; value: number } | null;
} {
  const observedHours = patterns.flatMap((pattern) =>
    pattern.hourly_buckets
      .filter(
        (bucket): bucket is WeekdayHourBucket & { average_available_spaces: number } =>
          bucket.average_available_spaces !== null && bucket.observations > 0
      )
      .map((bucket) => ({
        weekdayName: pattern.weekday_name,
        hour: bucket.hour,
        value: bucket.average_available_spaces,
      }))
  );

  if (observedHours.length === 0) {
    return { tightest: null, roomiest: null };
  }

  const sorted = [...observedHours].sort((left, right) => left.value - right.value);
  return {
    tightest: sorted[0],
    roomiest: sorted[sorted.length - 1],
  };
}

function findLatestValue(items: ParkingStatus[], key: "observed_at"): string | null {
  if (items.length === 0) {
    return null;
  }

  return items.reduce((latest, item) => {
    if (latest === null) {
      return item[key];
    }
    return Date.parse(item[key]) > Date.parse(latest) ? item[key] : latest;
  }, null as string | null);
}

function getThresholdWeekdayItem(
  items: ThresholdWeekdayTime[],
  threshold: number,
  weekday: number
): ThresholdWeekdayTime | null {
  return items.find((item) => item.threshold === threshold && item.weekday === weekday) ?? null;
}

function hasThresholdSamples(items: ThresholdWeekdayTime[]): boolean {
  return items.some((item) => item.sample_count > 0);
}

function historyLabel(selectedParkingLotName: string | null, airportName: string | undefined): string {
  return selectedParkingLotName ?? `${airportName ?? "공항"} 전체`;
}

export function DashboardScreen({
  airports,
  parkingLots,
  selectedAirportCode,
  selectedParkingLotId,
  selectedParkingLotName,
  scopeItems,
  currentItems,
  thresholdEvents,
  thresholdInsights,
  weekdayHourlyPatterns,
  holidaySummary,
  holidayPatterns,
  timeSeries,
  flightStatus,
  collectorStatus,
  isMobile,
  loading,
  collecting,
  error,
  actionMessage,
  actionMessageIsError,
  onAirportChange,
  onParkingLotChange,
  onRefresh,
  onManualCollect,
}: DashboardScreenProps) {
  const selectedAirport = airports.find((airport) => airport.code === selectedAirportCode);
  const visibleItems = currentItems;
  const latestObservedAt = findLatestValue(scopeItems, "observed_at");
  const latestSyncedAt = collectorStatus?.latest_snapshot_collected_at ?? null;
  const sortedByAvailable = [...scopeItems].sort((left, right) => left.available_spaces - right.available_spaces);
  const tightestLot = sortedByAvailable[0];
  const roomiestLot = sortedByAvailable[sortedByAvailable.length - 1];
  const totalAvailableSpaces = scopeItems.reduce((sum, item) => sum + item.available_spaces, 0);
  const totalOccupiedSpaces = scopeItems.reduce((sum, item) => sum + item.occupied_spaces, 0);
  const totalSpaces = scopeItems.reduce((sum, item) => sum + item.total_spaces, 0);
  const focusedLot = selectedParkingLotId !== null ? scopeItems[0] ?? null : null;
  const scopeLabel = historyLabel(selectedParkingLotName, selectedAirport?.name_ko);
  const maxHeatValue = Math.max(
    ...weekdayHourlyPatterns.flatMap((pattern) =>
      pattern.hourly_buckets.map((bucket) => bucket.average_available_spaces ?? 0)
    ),
    1
  );
  const thresholdWeekdayItems = thresholdInsights?.weekday_items ?? [];
  const thresholdHistoryItems = thresholdInsights?.history_items ?? [];
  const showThresholdInsights = hasThresholdSamples(thresholdWeekdayItems);
  const averageAvailabilitySummary = summarizeAverageAvailability(weekdayHourlyPatterns);
  const holidayPatternItems = holidayPatterns?.items ?? [];
  const maxHolidayHeatValue = Math.max(
    ...holidayPatternItems.flatMap((pattern) =>
      pattern.hourly_buckets.map((bucket) => bucket.average_available_spaces ?? 0)
    ),
    1
  );

  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="site-mark">parking-radar</p>
        <h1>공항 주차</h1>
      </header>

      <section className="control-band">
        <label className="field">
          <span>공항 선택</span>
          <select
            aria-label="공항 선택"
            className="input"
            value={selectedAirportCode}
            onChange={(event) => onAirportChange(event.target.value)}
          >
            {airports.map((airport) => (
              <option key={airport.code} value={airport.code}>
                {airport.name_ko}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>세부 주차장</span>
          <select
            aria-label="세부 주차장"
            className="input"
            value={selectedParkingLotId ?? "all"}
            onChange={(event) => onParkingLotChange(event.target.value === "all" ? null : Number(event.target.value))}
          >
            <option value="all">전체 주차장</option>
            {parkingLots.map((parkingLot) => (
              <option key={parkingLot.id} value={parkingLot.id}>
                {parkingLot.name}
              </option>
            ))}
          </select>
        </label>

        <div className="action-stack">
          <button className="button secondary" type="button" onClick={onRefresh}>
            새로고침
          </button>
          <button
            aria-label="즉시 수집 실행"
            className="button"
            data-testid="manual-collect-button"
            disabled={collecting}
            type="button"
            onClick={onManualCollect}
          >
            {collecting ? "수집 중..." : "지금 수집"}
          </button>
          {collectorStatus?.manual_collect_available_at ? (
            <p className="action-hint">
              다음 수동 수집 가능: {formatDateTimeWithZone(collectorStatus.manual_collect_available_at)}
            </p>
          ) : null}
        </div>
      </section>

      <section className="status-header">
        <div>
          <h2>{selectedAirport?.name_ko ?? "공항"}</h2>
          <div className="status-meta">
            <span>데이터 기준 시각: {latestObservedAt ? formatDateTimeWithZone(latestObservedAt) : "데이터 없음"}</span>
            {latestSyncedAt ? <span>수집기 마지막 동기화: {formatDateTimeWithZone(latestSyncedAt)}</span> : null}
            {holidaySummary ? <span className="holiday-sentence">{holidaySummary.sentence}</span> : null}
          </div>
        </div>

        <div className="spotlight">
          <span>지금 주차 여유</span>
          <strong>{formatNumber(totalAvailableSpaces)}대</strong>
          <small>{scopeLabel}</small>
        </div>
      </section>

      <section className="detail-ribbon detail-ribbon-compact">
        <div className="metric-card detail-card">
          <span>현재 잔여 주차면</span>
          <strong>{formatNumber(totalAvailableSpaces)}대</strong>
          <small>{selectedParkingLotName ? "선택 주차장 기준" : "공항 합산 기준"}</small>
        </div>

        <div className="metric-card detail-card">
          <span>{focusedLot ? "현재 상태" : "가장 빠듯한 곳"}</span>
          <strong>{focusedLot ? statusLabel(focusedLot.status_level) : tightestLot?.parking_lot_name ?? "-"}</strong>
          <small>
            {focusedLot
              ? `${formatNumber(focusedLot.available_spaces)}대 남음`
              : tightestLot
                ? `${formatNumber(tightestLot.available_spaces)}대 남음`
                : "데이터 없음"}
          </small>
        </div>

        <div className="metric-card detail-card">
          <span>{focusedLot ? "전체 주차면" : "가장 여유 있는 곳"}</span>
          <strong>{focusedLot ? `${formatNumber(totalSpaces)}대` : roomiestLot?.parking_lot_name ?? "-"}</strong>
          <small>
            {focusedLot
              ? `점유 ${formatNumber(totalOccupiedSpaces)} / 전체 ${formatNumber(totalSpaces)}`
              : roomiestLot
                ? `${formatNumber(roomiestLot.available_spaces)}대 남음`
                : "데이터 없음"}
          </small>
        </div>
      </section>

      {actionMessage ? <p className={`notice ${actionMessageIsError ? "error" : ""}`}>{actionMessage}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}
      {loading ? <p className="notice">데이터를 불러오는 중입니다.</p> : null}

      {isMobile ? (
        <section className="lot-card-grid" data-testid="mobile-lot-grid">
          {visibleItems.map((item) => (
            <article key={item.parking_lot_id} className={`lot-card ${statusTone(item.status_level)}`}>
              <div className="lot-card-top">
                <div>
                  <h3>{item.parking_lot_name}</h3>
                  <p>{item.terminal ?? "터미널 정보 없음"}</p>
                </div>
                <span className="pill">{statusLabel(item.status_level)}</span>
              </div>
              <div className="lot-card-stats">
                <div>
                  <span>잔여</span>
                  <strong>{formatNumber(item.available_spaces)}대</strong>
                </div>
                <div>
                  <span>점유/전체</span>
                  <strong>
                    {formatNumber(item.occupied_spaces)}/{formatNumber(item.total_spaces)}
                  </strong>
                </div>
              </div>
              <p className="stamp">기준 시각 {formatDateTimeWithZone(item.observed_at)}</p>
            </article>
          ))}
        </section>
      ) : (
        <section className="table-surface" data-testid="desktop-lot-table">
          <table className="lot-table">
            <thead>
              <tr>
                <th>주차장</th>
                <th>상태</th>
                <th>잔여</th>
                <th>점유/전체</th>
                <th>기준 시각</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.parking_lot_id}>
                  <td>
                    <strong>{item.parking_lot_name}</strong>
                    <span>{item.terminal ?? "터미널 정보 없음"}</span>
                  </td>
                  <td>
                    <span className={`pill ${statusTone(item.status_level)}`}>{statusLabel(item.status_level)}</span>
                  </td>
                  <td>{formatNumber(item.available_spaces)}대</td>
                  <td>
                    {formatNumber(item.occupied_spaces)}/{formatNumber(item.total_spaces)}
                  </td>
                  <td>{formatDateTimeWithZone(item.observed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="analytics-grid">
        <HistoryChart
          holidays={holidaySummary?.items ?? []}
          series={timeSeries}
          scopeLabel={scopeLabel}
        />

        <DailyFlightOverlayChart
          flightStatus={flightStatus}
          holidays={holidaySummary?.items ?? []}
          series={timeSeries}
          scopeLabel={scopeLabel}
        />

        <article className="panel-surface panel-full-span">
          <div className="panel-head">
            <h3>요일별 시간대 평균 잔여 주차면</h3>
          </div>
          {weekdayHourlyPatterns.length === 0 ? (
            <p className="notice">표시할 요일별 시간대 데이터가 없습니다.</p>
          ) : (
            <>
              <div className="pattern-summary-strip">
                <div className="pattern-summary-card">
                  <span>평균으로 가장 빠듯</span>
                  <strong>
                    {averageAvailabilitySummary.tightest
                      ? `${averageAvailabilitySummary.tightest.weekdayName} ${formatHourLabel(averageAvailabilitySummary.tightest.hour)}`
                      : "-"}
                  </strong>
                  <small>
                    {averageAvailabilitySummary.tightest
                      ? `평균 ${formatNumber(Math.round(averageAvailabilitySummary.tightest.value))}대`
                      : "데이터 없음"}
                  </small>
                </div>
                <div className="pattern-summary-card">
                  <span>평균으로 가장 여유</span>
                  <strong>
                    {averageAvailabilitySummary.roomiest
                      ? `${averageAvailabilitySummary.roomiest.weekdayName} ${formatHourLabel(averageAvailabilitySummary.roomiest.hour)}`
                      : "-"}
                  </strong>
                  <small>
                    {averageAvailabilitySummary.roomiest
                      ? `평균 ${formatNumber(Math.round(averageAvailabilitySummary.roomiest.value))}대`
                      : "데이터 없음"}
                  </small>
                </div>
                <div className="pattern-summary-card pattern-summary-legend">
                  <span>색상 범례</span>
                  <div className="availability-legend">
                    <small>적음</small>
                    <div className="availability-gradient" />
                    <small>많음</small>
                  </div>
                  <small>{scopeLabel} 기준 평균 잔여 주차면</small>
                </div>
              </div>

              <div className="heatmap-scroll" data-testid="weekday-hour-heatmap">
                <table className="heatmap-table">
                  <thead>
                    <tr>
                      <th>요일</th>
                      {HOURS.map((hour) => (
                        <th key={`heatmap-hour-${hour}`}>{String(hour).padStart(2, "0")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weekdayHourlyPatterns.map((pattern) => (
                      <tr key={`heatmap-row-${pattern.weekday}`}>
                        <th>{pattern.weekday_name}</th>
                        {pattern.hourly_buckets.map((bucket) => (
                          <td
                            key={`heatmap-${pattern.weekday}-${bucket.hour}`}
                            data-testid={`weekday-hour-cell-${pattern.weekday}-${bucket.hour}`}
                            style={buildAvailabilityHeatStyle(bucket.average_available_spaces, maxHeatValue)}
                            title={
                              bucket.average_available_spaces === null
                                ? `${pattern.weekday_name} ${formatHourLabel(bucket.hour)} 관측 없음`
                                : `${pattern.weekday_name} ${formatHourLabel(bucket.hour)} 평균 ${Math.round(bucket.average_available_spaces)}대`
                            }
                          >
                            {bucket.average_available_spaces === null ? "-" : Math.round(bucket.average_available_spaces)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </article>

        <article className="panel-surface panel-full-span">
          <div className="panel-head">
            <h3>요일별 패턴</h3>
          </div>
          {weekdayHourlyPatterns.length === 0 ? (
            <p className="notice">표시할 요일별 패턴 데이터가 없습니다.</p>
          ) : (
            <div className="weekday-pattern-grid" data-testid="weekday-pattern-grid">
              {weekdayHourlyPatterns.map((pattern) => {
                const { tightestHour, loosestHour } = summarizePattern(pattern);
                return (
                  <article key={`weekday-pattern-${pattern.weekday}`} className="weekday-detail-card">
                    <div className="weekday-detail-head">
                      <div>
                        <h4>{pattern.weekday_name}</h4>
                        <p>
                          평균{" "}
                          {pattern.average_available_spaces === null
                            ? "-"
                            : `${formatNumber(Math.round(pattern.average_available_spaces))}대`}
                        </p>
                      </div>
                      <div className="weekday-detail-summary">
                        <span>
                          가장 빠듯함{" "}
                          {tightestHour?.average_available_spaces !== null && tightestHour
                            ? `${formatHourLabel(tightestHour.hour)} ${formatNumber(Math.round(tightestHour.average_available_spaces))}대`
                            : "-"}
                        </span>
                        <span>
                          가장 여유{" "}
                          {loosestHour?.average_available_spaces !== null && loosestHour
                            ? `${formatHourLabel(loosestHour.hour)} ${formatNumber(Math.round(loosestHour.average_available_spaces))}대`
                            : "-"}
                        </span>
                      </div>
                    </div>
                    <div className="hour-chip-grid">
                      {pattern.hourly_buckets.map((bucket) => (
                        <div
                          key={`hour-chip-${pattern.weekday}-${bucket.hour}`}
                          className="hour-chip"
                          style={buildAvailabilityHeatStyle(bucket.average_available_spaces, maxHeatValue)}
                        >
                          <span>{formatHourLabel(bucket.hour)}</span>
                          <strong>
                            {bucket.average_available_spaces === null
                              ? "-"
                              : `${formatNumber(Math.round(bucket.average_available_spaces))}대`}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel-surface panel-full-span">
          <div className="panel-head">
            <div>
              <h3>공휴일 패턴</h3>
              <p>최근 8개 공휴일 날짜별 시간대 잔여 주차면</p>
            </div>
          </div>
          {holidayPatternItems.length === 0 ? (
            <p className="notice">표시할 공휴일 패턴 데이터가 없습니다.</p>
          ) : (
            <>
              {holidayPatterns?.error_message ? (
                <p className="notice error">{holidayPatterns.error_message}</p>
              ) : null}
              <div className="heatmap-scroll" data-testid="holiday-pattern-heatmap">
                <table className="heatmap-table holiday-heatmap-table">
                  <thead>
                    <tr>
                      <th>공휴일</th>
                      {HOURS.map((hour) => (
                        <th key={`holiday-hour-${hour}`}>{String(hour).padStart(2, "0")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holidayPatternItems.map((pattern) => (
                      <tr key={`holiday-row-${pattern.local_date}-${pattern.name}`}>
                        <th>
                          <strong>{formatHolidayDate(pattern.local_date, pattern.weekday_name)}</strong>
                          <small>{pattern.name}</small>
                        </th>
                        {pattern.hourly_buckets.map((bucket) => (
                          <td
                            key={`holiday-cell-${pattern.local_date}-${bucket.hour}`}
                            data-testid={`holiday-hour-cell-${pattern.local_date}-${bucket.hour}`}
                            style={buildAvailabilityHeatStyle(bucket.average_available_spaces, maxHolidayHeatValue)}
                            title={
                              bucket.average_available_spaces === null
                                ? `${pattern.name} ${formatHourLabel(bucket.hour)} 관측 없음`
                                : `${pattern.name} ${formatHourLabel(bucket.hour)} 평균 ${Math.round(bucket.average_available_spaces)}대`
                            }
                          >
                            {bucket.average_available_spaces === null ? "-" : Math.round(bucket.average_available_spaces)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="holiday-pattern-grid" data-testid="holiday-pattern-grid">
                {holidayPatternItems.map((pattern) => {
                  const { tightestHour, loosestHour } = summarizeHolidayPattern(pattern);
                  return (
                    <article key={`holiday-card-${pattern.local_date}-${pattern.name}`} className="weekday-detail-card">
                      <div className="weekday-detail-head">
                        <div>
                          <h4>{formatHolidayDate(pattern.local_date, pattern.weekday_name)}</h4>
                          <p>{pattern.name}</p>
                        </div>
                        <div className="weekday-detail-summary">
                          <span>
                            평균{" "}
                            {pattern.average_available_spaces === null
                              ? "-"
                              : `${formatNumber(Math.round(pattern.average_available_spaces))}대`}
                          </span>
                          <span>관측 {formatNumber(pattern.observations)}개</span>
                        </div>
                      </div>
                      <div className="holiday-extreme-row">
                        <span>
                          가장 빠듯함{" "}
                          {tightestHour?.average_available_spaces !== null && tightestHour
                            ? `${formatHourLabel(tightestHour.hour)} ${formatNumber(Math.round(tightestHour.average_available_spaces))}대`
                            : "-"}
                        </span>
                        <span>
                          가장 여유{" "}
                          {loosestHour?.average_available_spaces !== null && loosestHour
                            ? `${formatHourLabel(loosestHour.hour)} ${formatNumber(Math.round(loosestHour.average_available_spaces))}대`
                            : "-"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </article>

        <article className="panel-surface">
          <div className="panel-head">
            <h3>요일별 임계 달성 시간</h3>
          </div>
          {showThresholdInsights ? (
            <div className="threshold-table-wrap" data-testid="threshold-weekday-grid">
              <table className="threshold-table">
                <thead>
                  <tr>
                    <th>기준</th>
                    {WEEKDAYS.map((weekday) => (
                      <th key={`threshold-weekday-${weekday}`}>{weekday}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {THRESHOLDS.map((threshold) => (
                    <tr key={`threshold-row-${threshold}`}>
                      <th>{formatThresholdLabel(threshold)}</th>
                      {WEEKDAYS.map((_, weekday) => {
                        const item = getThresholdWeekdayItem(thresholdWeekdayItems, threshold, weekday);
                        return (
                          <td key={`threshold-cell-${threshold}-${weekday}`}>
                            <strong>{formatMinutesOfDay(item?.typical_minutes_of_day ?? null)}</strong>
                            <small>{item && item.sample_count > 0 ? `${item.sample_count}회` : "기록 없음"}</small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="notice">임계 달성 시각을 계산할 만큼 충분한 기록이 없습니다.</p>
          )}
        </article>

        <article className="panel-surface">
          <div className="panel-head">
            <h3>날짜별 임계 달성 시간</h3>
          </div>
          {thresholdHistoryItems.length > 0 ? (
            <div className="threshold-scroll" data-testid="threshold-history-scroll">
              <table className="threshold-history-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>기준</th>
                    <th>달성 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholdHistoryItems.map((item: ThresholdDateHistoryItem) => (
                    <tr key={`${item.threshold}-${item.local_date}-${item.crossed_at}`}>
                      <td>{formatDateCell(item.local_date, item.weekday_name)}</td>
                      <td>{formatThresholdLabel(item.threshold)}</td>
                      <td>
                        {formatMinutesOfDay(item.minutes_of_day)}
                        <small>{formatNumber(item.available_spaces)}대</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="notice">최근 기준에서 임계 달성 기록이 없습니다.</p>
          )}
        </article>

        <article className="panel-surface panel-full-span threshold-panel">
          <div className="panel-head">
            <h3>임계치 이벤트</h3>
          </div>
          {thresholdEvents.length === 0 ? (
            <p className="notice">선택한 기준에서 최근 임계치 이벤트가 없습니다.</p>
          ) : (
            <div className="threshold-scroll" data-testid="threshold-events-scroll">
              <ul className="threshold-list">
                {thresholdEvents.map((event) => (
                  <li key={`${event.parking_lot_id}-${event.threshold}-${event.crossed_at}-${event.direction}`}>
                    <div>
                      <strong>{event.parking_lot_name}</strong>
                      <span>{formatDateTimeWithZone(event.crossed_at)}</span>
                    </div>
                    <p>
                      {formatNumber(event.threshold)}대{" "}
                      {event.direction === "down" ? "미만 진입" : "이상 회복"}:{" "}
                      {formatNumber(event.previous_available_spaces)}대에서{" "}
                      {formatNumber(event.current_available_spaces)}대로 변했습니다.
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </section>

      {visibleItems.length === 0 ? <p className="notice">조건에 맞는 주차장이 없습니다.</p> : null}
    </main>
  );
}
