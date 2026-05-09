"use client";

import { useMemo, useState } from "react";

import {
  formatAxisTimeLabel,
  formatDateTime,
  formatNumber,
  formatSeoulDateKey,
  getSeoulDateParts,
} from "@/lib/format";
import type { FlightStatusItem, FlightStatusResponse, HolidayItemSummary, ParkingTimeSeriesResponse } from "@/lib/types";

const CHART_WIDTH = 1180;
const CHART_HEIGHT = 320;
const CHART_PADDING_X = 42;
const CHART_PADDING_TOP = 30;
const CHART_PADDING_BOTTOM = 32;
const GRID_LINES = 4;
const HOURS = [0, 6, 12, 18, 24];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type DailyFlightOverlayChartProps = {
  flightStatus: FlightStatusResponse | null;
  holidays: HolidayItemSummary[];
  series: ParkingTimeSeriesResponse | null;
  scopeLabel: string;
};

type DailyPoint = {
  bucketAt: string;
  minuteOfDay: number;
  availableSpaces: number;
};

type DailyLine = {
  localDate: string;
  label: string;
  holidayName: string | null;
  points: DailyPoint[];
};

type PositionedPoint = DailyPoint & {
  x: number;
  y: number;
};

type FlightMarker = FlightStatusItem & {
  key: string;
  x: number;
  y: number;
  label: string;
};

function formatLocalDateLabel(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) {
    return localDate;
  }
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day} (${weekday})`;
}

function minuteToX(minuteOfDay: number): number {
  const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  return CHART_PADDING_X + (Math.min(Math.max(minuteOfDay, 0), 1440) / 1440) * innerWidth;
}

function valueToY(value: number, maxValue: number): number {
  const innerHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;
  return CHART_PADDING_TOP + (1 - value / Math.max(maxValue, 1)) * innerHeight;
}

function buildDailyLines(
  series: ParkingTimeSeriesResponse | null,
  holidays: HolidayItemSummary[]
): DailyLine[] {
  if (!series || series.items.length === 0) {
    return [];
  }

  const holidayByDate = new Map(holidays.map((holiday) => [holiday.local_date, holiday.name] as const));
  const grouped = new Map<string, DailyPoint[]>();

  for (const item of series.items) {
    if (item.lot_observations <= 0) {
      continue;
    }
    const { hour, minute } = getSeoulDateParts(item.bucket_at);
    const localDate = formatSeoulDateKey(item.bucket_at);
    const points = grouped.get(localDate) ?? [];
    points.push({
      bucketAt: item.bucket_at,
      minuteOfDay: hour * 60 + minute,
      availableSpaces: item.available_spaces,
    });
    grouped.set(localDate, points);
  }

  return Array.from(grouped.entries())
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .slice(-7)
    .map(([localDate, points]) => ({
      localDate,
      label: formatLocalDateLabel(localDate),
      holidayName: holidayByDate.get(localDate) ?? null,
      points: points.sort((left, right) => left.minuteOfDay - right.minuteOfDay),
    }));
}

function buildStepPath(points: PositionedPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  const path = [`M ${points[0].x} ${points[0].y}`];
  for (const point of points.slice(1)) {
    path.push(`H ${point.x}`);
    path.push(`V ${point.y}`);
  }
  return path.join(" ");
}

function formatFlightDirection(direction: FlightStatusItem["direction"]): string {
  if (direction === "departure") {
    return "출발";
  }
  if (direction === "arrival") {
    return "도착";
  }
  return "운항";
}

function buildFlightLabel(flight: FlightStatusItem): string {
  const statusLabel = flight.status ? ` (${flight.status})` : "";
  const airlineLabel = flight.airline ? `${flight.airline} ` : "";
  return `${formatDateTime(flight.marker_at)} ${formatFlightDirection(flight.direction)} ${airlineLabel}${flight.flight_number} ${flight.origin_airport} -> ${flight.destination_airport}${statusLabel}`;
}

function buildFlightMarkers(flightStatus: FlightStatusResponse | null): FlightMarker[] {
  if (!flightStatus || flightStatus.items.length === 0) {
    return [];
  }

  return flightStatus.items.map((flight, index) => {
    const { hour, minute } = getSeoulDateParts(flight.marker_at);
    return {
      ...flight,
      key: `${flight.direction}-${flight.marker_at}-${flight.origin_airport}-${flight.destination_airport}-${flight.flight_number}`,
      x: minuteToX(hour * 60 + minute),
      y: CHART_PADDING_TOP + 10 + (index % 4) * 9,
      label: buildFlightLabel(flight),
    };
  });
}

export function DailyFlightOverlayChart({
  flightStatus,
  holidays,
  series,
  scopeLabel,
}: DailyFlightOverlayChartProps) {
  const [hiddenDates, setHiddenDates] = useState<Set<string>>(() => new Set());
  const [showDepartures, setShowDepartures] = useState(true);
  const [showArrivals, setShowArrivals] = useState(true);
  const [hoveredFlightKey, setHoveredFlightKey] = useState<string | null>(null);
  const [selectedFlightKey, setSelectedFlightKey] = useState<string | null>(null);

  const dailyLines = useMemo(() => buildDailyLines(series, holidays), [holidays, series]);
  const maxValue = Math.max(...dailyLines.flatMap((line) => line.points.map((point) => point.availableSpaces)), 1);
  const visibleLines = dailyLines.filter((line) => !hiddenDates.has(line.localDate));
  const positionedLines = visibleLines.map((line) => ({
    ...line,
    points: line.points.map((point) => ({
      ...point,
      x: minuteToX(point.minuteOfDay),
      y: valueToY(point.availableSpaces, maxValue),
    })),
  }));
  const flightMarkers = useMemo(
    () =>
      buildFlightMarkers(flightStatus).filter((marker) => {
        if (marker.direction === "departure") {
          return showDepartures;
        }
        if (marker.direction === "arrival") {
          return showArrivals;
        }
        return showDepartures || showArrivals;
      }),
    [flightStatus, showArrivals, showDepartures]
  );
  const departureCount = flightMarkers.filter((marker) => marker.direction === "departure").length;
  const arrivalCount = flightMarkers.filter((marker) => marker.direction === "arrival").length;
  const activeFlightKey = hoveredFlightKey ?? selectedFlightKey;
  const activeFlight = activeFlightKey ? flightMarkers.find((marker) => marker.key === activeFlightKey) ?? null : null;

  function toggleDate(localDate: string) {
    setHiddenDates((current) => {
      const next = new Set(current);
      if (next.has(localDate)) {
        next.delete(localDate);
      } else {
        next.add(localDate);
      }
      return next;
    });
  }

  return (
    <article className="panel-surface panel-full-span daily-overlay-panel">
      <div className="panel-head">
        <div>
          <h3>일단위 잔여 주차면 변화</h3>
          <p>최근 7일 · {scopeLabel}</p>
        </div>
      </div>

      {dailyLines.length === 0 ? (
        <p className="notice">표시할 날짜별 시계열 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="daily-overlay-controls">
            <div className="daily-date-toggle-group" data-testid="daily-date-toggles">
              {dailyLines.map((line) => {
                const isHidden = hiddenDates.has(line.localDate);
                return (
                  <button
                    key={line.localDate}
                    aria-pressed={!isHidden}
                    className={`daily-date-toggle ${line.holidayName ? "holiday" : ""} ${isHidden ? "is-off" : ""}`}
                    type="button"
                    onClick={() => toggleDate(line.localDate)}
                  >
                    <strong>{line.label}</strong>
                    {line.holidayName ? <small>{line.holidayName}</small> : null}
                  </button>
                );
              })}
            </div>

            <div className="flight-toggle-group" data-testid="flight-direction-toggles">
              <label className="toggle-check">
                <input
                  checked={showDepartures}
                  type="checkbox"
                  onChange={(event) => setShowDepartures(event.target.checked)}
                />
                <span>출발편</span>
              </label>
              <label className="toggle-check">
                <input
                  checked={showArrivals}
                  type="checkbox"
                  onChange={(event) => setShowArrivals(event.target.checked)}
                />
                <span>도착편</span>
              </label>
            </div>
          </div>

          <div className="daily-overlay-chart-shell" data-testid="daily-flight-overlay-chart">
            <div className="daily-overlay-chart-stage">
              {activeFlight ? (
                <div
                  className="flight-highlight-label daily-flight-highlight"
                  data-testid="daily-flight-highlight-label"
                  style={{ left: `${activeFlight.x}px` }}
                >
                  <strong>
                    {formatAxisTimeLabel(activeFlight.marker_at)} {activeFlight.flight_number}
                  </strong>
                  <span>
                    {formatFlightDirection(activeFlight.direction)} {activeFlight.origin_airport} {"->"}{" "}
                    {activeFlight.destination_airport}
                  </span>
                </div>
              ) : null}

              <svg
                aria-label={`최근 7일 ${scopeLabel} 일단위 잔여 주차면 변화`}
                className="daily-overlay-chart"
                role="img"
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              >
                {Array.from({ length: GRID_LINES }, (_, index) => {
                  const y =
                    CHART_PADDING_TOP +
                    ((CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) * index) /
                      Math.max(GRID_LINES - 1, 1);
                  return (
                    <line
                      key={`daily-grid-${index}`}
                      className="history-grid-line"
                      x1={CHART_PADDING_X}
                      x2={CHART_WIDTH - CHART_PADDING_X}
                      y1={y}
                      y2={y}
                    />
                  );
                })}

                {HOURS.map((hour) => {
                  const x = minuteToX(hour * 60);
                  return (
                    <g key={`daily-hour-${hour}`}>
                      <line
                        className="history-divider"
                        x1={x}
                        x2={x}
                        y1={CHART_PADDING_TOP}
                        y2={CHART_HEIGHT - CHART_PADDING_BOTTOM}
                      />
                      <text className="daily-axis-label" textAnchor="middle" x={x} y={CHART_HEIGHT - 8}>
                        {String(hour).padStart(2, "0")}:00
                      </text>
                    </g>
                  );
                })}

                {positionedLines.map((line, index) => (
                  <g key={`daily-line-${line.localDate}`} className={line.holidayName ? "daily-line-holiday" : ""}>
                    <path
                      className={`daily-line daily-line-${index % 7}`}
                      d={buildStepPath(line.points)}
                      fill="none"
                      data-testid="daily-overlay-line"
                    />
                    {line.holidayName && line.points.length > 0 ? (
                      <rect
                        className="daily-holiday-marker"
                        height="9"
                        width="9"
                        x={line.points[line.points.length - 1].x - 4.5}
                        y={line.points[line.points.length - 1].y - 4.5}
                      />
                    ) : null}
                  </g>
                ))}

                {flightMarkers.map((marker) => (
                  <g
                    key={marker.key}
                    className={`daily-flight-marker daily-flight-marker-${marker.direction} ${
                      marker.key === activeFlightKey ? "active" : ""
                    }`}
                    data-testid="daily-flight-marker"
                    onClick={() => setSelectedFlightKey((current) => (current === marker.key ? null : marker.key))}
                    onMouseEnter={() => setHoveredFlightKey(marker.key)}
                    onMouseLeave={() => setHoveredFlightKey(null)}
                  >
                    <title>{marker.label}</title>
                    <line
                      className="flight-marker-line"
                      x1={marker.x}
                      x2={marker.x}
                      y1={CHART_PADDING_TOP}
                      y2={CHART_HEIGHT - CHART_PADDING_BOTTOM}
                    />
                    <circle className="flight-marker-dot" cx={marker.x} cy={marker.y} r="4.5" />
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div className="daily-overlay-legend">
            <span>
              비행편: 출발 {formatNumber(departureCount)}편 / 도착 {formatNumber(arrivalCount)}편
            </span>
            {flightStatus?.error_message ? <span className="flight-marker-error">{flightStatus.error_message}</span> : null}
          </div>
        </>
      )}
    </article>
  );
}
