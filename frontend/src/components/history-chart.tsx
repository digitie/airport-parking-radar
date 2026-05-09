"use client";

import { useEffect, useRef, useState } from "react";

import {
  formatAxisDateLabel,
  formatAxisTimeLabel,
  formatDateTimeWithZone,
  formatNumber,
  formatSeoulDateKey,
  getSeoulDateParts,
  parseApiDate,
} from "@/lib/format";
import type {
  FlightStatusItem,
  FlightStatusResponse,
  HolidayItemSummary,
  ParkingTimeSeriesResponse,
  TimeSeriesPoint,
} from "@/lib/types";

const CHART_MIN_WIDTH = 1280;
const CHART_HEIGHT = 280;
const CHART_PADDING_X = 18;
const CHART_PADDING_Y = 20;
const GRID_LINES = 4;
const TOOLTIP_EDGE_PADDING = 88;

type HistoryChartProps = {
  flightStatus: FlightStatusResponse | null;
  holidays: HolidayItemSummary[];
  series: ParkingTimeSeriesResponse | null;
  scopeLabel: string;
};

type ChartPoint = TimeSeriesPoint & {
  x: number;
  y: number;
};

type AxisMarker = {
  bucket_at: string;
  x: number;
  dateLabel: string | null;
  timeLabel: string;
};

type FlightChartMarker = FlightStatusItem & {
  x: number;
  key: string;
  label: string;
  markerY: number;
};

type HolidayChartBand = HolidayItemSummary & {
  x: number;
  width: number;
  labelX: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildLabelIndexes(points: TimeSeriesPoint[]): number[] {
  if (points.length === 0) {
    return [];
  }

  const indexes = points.reduce<number[]>((collected, point, index) => {
    const { hour, minute } = getSeoulDateParts(point.bucket_at);
    if (minute === 0 && hour % 6 === 0) {
      collected.push(index);
    }
    return collected;
  }, []);

  if (indexes.length === 0) {
    return [0];
  }

  return indexes;
}

function buildChartPoints(points: TimeSeriesPoint[], chartWidth: number): ChartPoint[] {
  const innerWidth = chartWidth - CHART_PADDING_X * 2;
  const innerHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;
  const observedValues = points
    .filter((point) => point.lot_observations > 0)
    .map((point) => point.available_spaces);
  const maxValue = Math.max(...observedValues, 1);

  return points.map((point, index) => ({
    ...point,
    x: CHART_PADDING_X + (index * innerWidth) / Math.max(points.length - 1, 1),
    y: CHART_PADDING_Y + (1 - point.available_spaces / maxValue) * innerHeight,
  }));
}

function buildAxisMarkers(points: ChartPoint[], labelIndexes: number[]): AxisMarker[] {
  return labelIndexes.map((pointIndex, index) => {
    const point = points[pointIndex];
    const { hour } = getSeoulDateParts(point.bucket_at);
    return {
      bucket_at: point.bucket_at,
      x: point.x,
      dateLabel: hour === 0 || index === 0 ? formatAxisDateLabel(point.bucket_at) : null,
      timeLabel: formatAxisTimeLabel(point.bucket_at),
    };
  });
}

function buildStepLinePath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const path = [`M ${points[0].x} ${points[0].y}`];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    path.push(`H ${point.x}`);
    path.push(`V ${point.y}`);
  }

  return path.join(" ");
}

function buildStepAreaPath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const bottom = CHART_HEIGHT - CHART_PADDING_Y;
  const path = [`M ${points[0].x} ${bottom}`, `L ${points[0].x} ${points[0].y}`];

  for (const point of points.slice(1)) {
    path.push(`H ${point.x}`);
    path.push(`V ${point.y}`);
  }

  path.push(`L ${points[points.length - 1].x} ${bottom}`);
  path.push("Z");
  return path.join(" ");
}

function buildHolidayBands(holidays: HolidayItemSummary[], points: ChartPoint[], chartWidth: number): HolidayChartBand[] {
  if (holidays.length === 0 || points.length === 0) {
    return [];
  }

  const pointsByDate = new Map<string, ChartPoint[]>();
  for (const point of points) {
    const localDate = formatSeoulDateKey(point.bucket_at);
    pointsByDate.set(localDate, [...(pointsByDate.get(localDate) ?? []), point]);
  }

  const stepWidth =
    points.length > 1 ? (chartWidth - CHART_PADDING_X * 2) / Math.max(points.length - 1, 1) : chartWidth - CHART_PADDING_X * 2;

  return holidays.flatMap((holiday) => {
    const matchedPoints = pointsByDate.get(holiday.local_date) ?? [];
    if (matchedPoints.length === 0) {
      return [];
    }
    const firstPoint = matchedPoints[0];
    const lastPoint = matchedPoints[matchedPoints.length - 1];
    const x = clamp(firstPoint.x - stepWidth / 2, CHART_PADDING_X, chartWidth - CHART_PADDING_X);
    const maxX = clamp(lastPoint.x + stepWidth / 2, CHART_PADDING_X, chartWidth - CHART_PADDING_X);
    return [
      {
        ...holiday,
        x,
        width: Math.max(maxX - x, 1),
        labelX: x + Math.max(maxX - x, 1) / 2,
      },
    ];
  });
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

function formatFlightMarkerLabel(flight: FlightStatusItem): string {
  const statusLabel = flight.status ? ` (${flight.status})` : "";
  const airlineLabel = flight.airline ? `${flight.airline} ` : "";
  return `${formatDateTimeWithZone(flight.marker_at)} ${formatFlightDirection(flight.direction)} ${airlineLabel}${flight.flight_number} ${flight.origin_airport} -> ${flight.destination_airport}${statusLabel}`;
}

function interpolateMarkerX(markerAt: string, points: ChartPoint[]): number | null {
  if (points.length === 0) {
    return null;
  }

  const markerTime = parseApiDate(markerAt).getTime();
  const firstTime = parseApiDate(points[0].bucket_at).getTime();
  const lastTime = parseApiDate(points[points.length - 1].bucket_at).getTime();

  if (markerTime < firstTime || markerTime > lastTime) {
    return null;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const nextPoint = points[index];
    const previousTime = parseApiDate(previousPoint.bucket_at).getTime();
    const nextTime = parseApiDate(nextPoint.bucket_at).getTime();

    if (markerTime <= nextTime) {
      const ratio = nextTime === previousTime ? 0 : (markerTime - previousTime) / (nextTime - previousTime);
      return previousPoint.x + (nextPoint.x - previousPoint.x) * ratio;
    }
  }

  return points[points.length - 1].x;
}

function buildFlightMarkers(flightStatus: FlightStatusResponse | null, points: ChartPoint[]): FlightChartMarker[] {
  if (!flightStatus || flightStatus.items.length === 0 || points.length === 0) {
    return [];
  }

  return flightStatus.items.reduce<FlightChartMarker[]>((markers, flight) => {
    const x = interpolateMarkerX(flight.marker_at, points);
    if (x === null) {
      return markers;
    }

    markers.push({
      ...flight,
      x,
      key: `${flight.direction}-${flight.marker_at}-${flight.origin_airport}-${flight.destination_airport}-${flight.flight_number}`,
      label: formatFlightMarkerLabel(flight),
      markerY: CHART_PADDING_Y + 12 + (markers.length % 3) * 9,
    });
    return markers;
  }, []);
}

function findLowestPoint(points: TimeSeriesPoint[]): TimeSeriesPoint {
  return points.reduce((lowest, point) => (point.available_spaces < lowest.available_spaces ? point : lowest), points[0]);
}

function findHighestPoint(points: TimeSeriesPoint[]): TimeSeriesPoint {
  return points.reduce(
    (highest, point) => (point.available_spaces > highest.available_spaces ? point : highest),
    points[0]
  );
}

export function HistoryChart({ flightStatus, holidays, series, scopeLabel }: HistoryChartProps) {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [hoveredFlightKey, setHoveredFlightKey] = useState<string | null>(null);
  const [selectedFlightKey, setSelectedFlightKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActivePointIndex(null);
    setHoveredFlightKey(null);
    setSelectedFlightKey(null);

    if (!series || series.items.length === 0) {
      return;
    }

    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    scrollElement.scrollLeft = scrollElement.scrollWidth;
  }, [series]);

  if (!series || series.items.length === 0) {
    return (
      <article className="panel-surface history-panel">
        <div className="panel-head">
          <div>
            <h3>최근 7일 잔여 주차면</h3>
            <p className="history-scope">기준: {scopeLabel}</p>
          </div>
        </div>
        <p className="notice">표시할 과거 시계열 데이터가 없습니다.</p>
      </article>
    );
  }

  const points = series.items;
  const observedPoints = points.filter((point) => point.lot_observations > 0);
  if (observedPoints.length === 0) {
    return (
      <article className="panel-surface history-panel">
        <div className="panel-head">
          <div>
            <h3>최근 {series.days}일 잔여 주차면</h3>
            <p className="history-scope">기준: {scopeLabel}</p>
          </div>
        </div>
        <p className="notice">표시할 주차 관측 데이터가 없습니다.</p>
      </article>
    );
  }

  const labelIndexes = buildLabelIndexes(points);
  const chartWidth = Math.max(CHART_MIN_WIDTH, labelIndexes.length * 64);
  const chartPoints = buildChartPoints(points, chartWidth);
  const observedChartPoints = chartPoints.filter((point) => point.lot_observations > 0);
  const axisMarkers = buildAxisMarkers(chartPoints, labelIndexes);
  const holidayBands = buildHolidayBands(holidays, chartPoints, chartWidth);
  const flightMarkers = buildFlightMarkers(flightStatus, chartPoints);
  const activeFlightKey = hoveredFlightKey ?? selectedFlightKey;
  const activeFlightMarker = activeFlightKey ? flightMarkers.find((marker) => marker.key === activeFlightKey) ?? null : null;
  const flightDepartureCount = flightMarkers.filter((flight) => flight.direction === "departure").length;
  const flightArrivalCount = flightMarkers.filter((flight) => flight.direction === "arrival").length;
  const visibleFlightSample = flightMarkers.slice(0, 12);
  const latestPoint = observedPoints[observedPoints.length - 1];
  const lowestPoint = findLowestPoint(observedPoints);
  const highestPoint = findHighestPoint(observedPoints);
  const chartPointByBucket = new Map(chartPoints.map((point) => [point.bucket_at, point] as const));
  const latestChartPoint = chartPointByBucket.get(latestPoint.bucket_at);
  const lowestChartPoint = chartPointByBucket.get(lowestPoint.bucket_at);
  const defaultActivePointIndex = Math.max(
    chartPoints.findIndex((point) => point.bucket_at === latestPoint.bucket_at),
    0
  );
  const resolvedActivePointIndex =
    activePointIndex !== null && activePointIndex < chartPoints.length ? activePointIndex : defaultActivePointIndex;
  const activePoint = chartPoints[resolvedActivePointIndex] ?? null;
  const tooltipLeft = activePoint ? clamp(activePoint.x, TOOLTIP_EDGE_PADDING, chartWidth - TOOLTIP_EDGE_PADDING) : 0;
  const tooltipTop = activePoint ? clamp(activePoint.y - 12, 60, CHART_HEIGHT - 8) : 0;

  function updateActivePoint(clientX: number, width: number) {
    const svgX = clamp((clientX / width) * chartWidth, CHART_PADDING_X, chartWidth - CHART_PADDING_X);
    const pointIndex = Math.round(
      ((svgX - CHART_PADDING_X) / Math.max(chartWidth - CHART_PADDING_X * 2, 1)) * Math.max(points.length - 1, 0)
    );
    setActivePointIndex(clamp(pointIndex, 0, Math.max(points.length - 1, 0)));
  }

  function getTouchClientX(touches: { length: number; [index: number]: { clientX: number } }): number | null {
    if (touches.length === 0) {
      return null;
    }
    return touches[0].clientX;
  }

  return (
    <article className="panel-surface history-panel">
      <div className="panel-head">
        <div>
          <h3>최근 {series.days}일 잔여 주차면</h3>
          <p className="history-scope">기준: {scopeLabel}</p>
        </div>
        <p className="section-hint">마지막 관측 {formatDateTimeWithZone(latestPoint.bucket_at)}</p>
      </div>

      <div className="history-summary">
        <div className="summary-chip">
          <span>지금 주차 여유</span>
          <strong>{formatNumber(latestPoint.available_spaces)}대</strong>
        </div>
        <div className="summary-chip">
          <span>최근 7일 최저</span>
          <strong>{formatNumber(lowestPoint.available_spaces)}대</strong>
          <small>{formatDateTimeWithZone(lowestPoint.bucket_at)}</small>
        </div>
        <div className="summary-chip">
          <span>최근 7일 최고</span>
          <strong>{formatNumber(highestPoint.available_spaces)}대</strong>
          <small>{formatDateTimeWithZone(highestPoint.bucket_at)}</small>
        </div>
        <div className="summary-chip">
          <span>보는 기준</span>
          <strong>{scopeLabel}</strong>
          <small>{series.interval_minutes}분 간격</small>
        </div>
      </div>

      <div className="history-chart-shell" data-testid="history-chart">
        <div className="history-chart-scroll" ref={scrollRef}>
          <div className="history-chart-stage" style={{ width: `${chartWidth}px` }}>
            {activePoint ? (
              <div
                className="history-tooltip"
                data-testid="history-tooltip"
                style={{ left: `${tooltipLeft}px`, top: `${tooltipTop}px` }}
              >
                <strong>
                  {activePoint.lot_observations > 0 ? `${formatNumber(activePoint.available_spaces)}대` : "주차 정보 없음"}
                </strong>
                <span>{formatDateTimeWithZone(activePoint.bucket_at)}</span>
              </div>
            ) : null}

            {activeFlightMarker ? (
              <div
                className="flight-highlight-label"
                data-testid="flight-highlight-label"
                style={{ left: `${clamp(activeFlightMarker.x, 110, chartWidth - 110)}px` }}
              >
                <strong>
                  {formatAxisTimeLabel(activeFlightMarker.marker_at)} {activeFlightMarker.flight_number}
                </strong>
                <span>
                  {formatFlightDirection(activeFlightMarker.direction)} {activeFlightMarker.origin_airport} {"->"}{" "}
                  {activeFlightMarker.destination_airport}
                </span>
              </div>
            ) : null}

            <svg
              aria-label={`최근 ${series.days}일 ${series.interval_minutes}분 간격 ${scopeLabel} 시계열`}
              className="history-chart"
              role="img"
              viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            >
              <defs>
                <linearGradient id="history-area-gradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(12, 139, 125, 0.24)" />
                  <stop offset="100%" stopColor="rgba(12, 139, 125, 0.02)" />
                </linearGradient>
              </defs>

              {Array.from({ length: GRID_LINES }, (_, index) => {
                const y =
                  CHART_PADDING_Y + ((CHART_HEIGHT - CHART_PADDING_Y * 2) * index) / Math.max(GRID_LINES - 1, 1);
                return (
                  <line
                    key={`grid-${index}`}
                    className="history-grid-line"
                    x1={CHART_PADDING_X}
                    x2={chartWidth - CHART_PADDING_X}
                    y1={y}
                    y2={y}
                  />
                );
              })}

              {axisMarkers.map((marker) => (
                <line
                  key={`divider-${marker.bucket_at}`}
                  className="history-divider"
                  x1={marker.x}
                  x2={marker.x}
                  y1={CHART_PADDING_Y}
                  y2={CHART_HEIGHT - CHART_PADDING_Y}
                />
              ))}

              {holidayBands.map((band) => (
                <g key={`holiday-band-${band.local_date}-${band.name}`}>
                  <rect
                    className="holiday-band"
                    data-testid="holiday-band"
                    height={CHART_HEIGHT - CHART_PADDING_Y * 2}
                    width={band.width}
                    x={band.x}
                    y={CHART_PADDING_Y}
                  />
                  <text className="holiday-band-label" textAnchor="middle" x={band.labelX} y={CHART_PADDING_Y - 6}>
                    {band.name}
                  </text>
                </g>
              ))}

              <path className="history-area" d={buildStepAreaPath(observedChartPoints)} />
              <path className="history-line" d={buildStepLinePath(observedChartPoints)} fill="none" />

              {flightMarkers.map((marker) => (
                <g
                  key={marker.key}
                  className={`flight-marker flight-marker-${marker.direction} ${
                    marker.key === activeFlightKey ? "active" : ""
                  } ${marker.key === selectedFlightKey ? "selected" : ""}`}
                  data-testid="flight-marker"
                >
                  <title>{marker.label}</title>
                  <line
                    className="flight-marker-line"
                    x1={marker.x}
                    x2={marker.x}
                    y1={CHART_PADDING_Y}
                    y2={CHART_HEIGHT - CHART_PADDING_Y}
                  />
                  <circle className="flight-marker-dot" cx={marker.x} cy={marker.markerY} r="4" />
                </g>
              ))}

              {activePoint ? (
                <>
                  <line
                    className="history-active-line"
                    x1={activePoint.x}
                    x2={activePoint.x}
                    y1={CHART_PADDING_Y}
                    y2={CHART_HEIGHT - CHART_PADDING_Y}
                  />
                  {activePoint.lot_observations > 0 ? (
                    <circle className="history-point active" cx={activePoint.x} cy={activePoint.y} r="6" />
                  ) : null}
                </>
              ) : null}
              {lowestChartPoint ? (
                <circle className="history-point lowest" cx={lowestChartPoint.x} cy={lowestChartPoint.y} r="5" />
              ) : null}
              {latestChartPoint ? (
                <circle className="history-point latest" cx={latestChartPoint.x} cy={latestChartPoint.y} r="5" />
              ) : null}
            </svg>

            {flightMarkers.map((marker) => (
              <button
                key={`hit-${marker.key}`}
                aria-label={marker.label}
                className={`flight-hit-target ${marker.key === activeFlightKey ? "active" : ""}`}
                style={{ left: `${marker.x}px` }}
                title={marker.label}
                type="button"
                onBlur={() => setHoveredFlightKey(null)}
                onClick={() => setSelectedFlightKey((current) => (current === marker.key ? null : marker.key))}
                onFocus={() => setHoveredFlightKey(marker.key)}
                onMouseEnter={() => setHoveredFlightKey(marker.key)}
                onMouseLeave={() => setHoveredFlightKey(null)}
              />
            ))}

            <div
              className="history-chart-surface"
              data-testid="history-chart-surface"
              onMouseLeave={() => {
                setActivePointIndex(null);
              }}
              onMouseMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                updateActivePoint(event.clientX - bounds.left, bounds.width);
              }}
              onTouchMove={(event) => {
                const clientX = getTouchClientX(event.touches);
                if (clientX === null) {
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                updateActivePoint(clientX - bounds.left, bounds.width);
              }}
              onTouchStart={(event) => {
                const clientX = getTouchClientX(event.touches);
                if (clientX === null) {
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                updateActivePoint(clientX - bounds.left, bounds.width);
              }}
            />

            <div className="history-axis-shell" data-testid="history-axis-shell">
              {axisMarkers.map((marker) => (
                <span
                  key={`axis-${marker.bucket_at}`}
                  className="history-axis-label"
                  data-testid="history-axis-label"
                  style={{ left: `${marker.x}px` }}
                >
                  {marker.dateLabel ? <strong>{marker.dateLabel}</strong> : <strong className="history-axis-date-spacer" />}
                  <small>{marker.timeLabel}</small>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {flightStatus ? (
        <div className="flight-marker-summary" data-testid="flight-marker-summary">
          <strong>비행편 마커</strong>
          {flightMarkers.length > 0 ? (
            <span>
              출발 {formatNumber(flightDepartureCount)}편 / 도착 {formatNumber(flightArrivalCount)}편
            </span>
          ) : (
            <span>현재 시계열 범위 안에 표시할 비행편이 없습니다.</span>
          )}
          {flightStatus.error_message ? <span className="flight-marker-error">{flightStatus.error_message}</span> : null}
        </div>
      ) : null}

      {visibleFlightSample.length > 0 ? (
        <div className="flight-marker-list" data-testid="flight-marker-list">
          {visibleFlightSample.map((flight) => (
            <button
              key={flight.key}
              className={`flight-chip ${flight.direction} ${flight.key === activeFlightKey ? "active" : ""}`}
              type="button"
              onClick={() => setSelectedFlightKey((current) => (current === flight.key ? null : flight.key))}
              onMouseEnter={() => setHoveredFlightKey(flight.key)}
              onMouseLeave={() => setHoveredFlightKey(null)}
            >
              <strong>
                {formatAxisTimeLabel(flight.marker_at)} {flight.flight_number}
              </strong>
              <small>
                {formatFlightDirection(flight.direction)} {flight.origin_airport} {"->"} {flight.destination_airport}
              </small>
            </button>
          ))}
          {flightMarkers.length > visibleFlightSample.length ? (
            <span className="flight-chip more">외 {formatNumber(flightMarkers.length - visibleFlightSample.length)}편</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
