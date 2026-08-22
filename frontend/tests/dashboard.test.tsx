import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardScreen } from "@/components/dashboard-screen";
import type {
  Airport,
  CollectorStatusResponse,
  FlightStatusResponse,
  HolidayPatternResponse,
  HolidaySummaryResponse,
  ParkingStatus,
  ParkingTimeSeriesResponse,
  ThresholdEvent,
  ThresholdInsightsResponse,
  WeekdayHourlyPattern,
} from "@/lib/types";

const airports: Airport[] = [
  {
    code: "GMP",
    name_ko: "김포국제공항",
    name_en: "Gimpo",
    source: "kac",
    parking_lots: [
      { id: 1, name: "국내선 제1주차장", terminal: "국내선", category: "short", is_active: true },
      { id: 2, name: "국제선 지하주차장", terminal: "국제선", category: "short", is_active: true },
    ],
  },
];

const currentItems: ParkingStatus[] = [
  {
    airport_code: "GMP",
    airport_name: "김포국제공항",
    parking_lot_id: 1,
    parking_lot_name: "국내선 제1주차장",
    terminal: "국내선",
    category: "short",
    observed_at: "2026-04-25T00:20:00.000Z",
    collected_at: "2026-04-25T00:30:00.000Z",
    occupied_spaces: 502,
    total_spaces: 510,
    available_spaces: 8,
    congestion_label: "만차임박",
    congestion_ratio: 98.4,
    status_level: "critical",
  },
];

const thresholdEvents: ThresholdEvent[] = [
  {
    parking_lot_id: 1,
    parking_lot_name: "국내선 제1주차장",
    airport_code: "GMP",
    airport_name: "김포국제공항",
    threshold: 10,
    direction: "down",
    crossed_at: "2026-04-25T00:10:00.000Z",
    previous_available_spaces: 14,
    current_available_spaces: 8,
  },
];

const thresholdInsights: ThresholdInsightsResponse = {
  generated_at: "2026-04-25T00:30:00.000Z",
  airport_code: "GMP",
  parking_lot_id: 1,
  days: 21,
  interval_minutes: 10,
  weekday_items: Array.from({ length: 7 }, (_, weekday) => ({
    threshold: 50,
    weekday,
    weekday_name: ["월", "화", "수", "목", "금", "토", "일"][weekday],
    typical_minutes_of_day: 8 * 60 + weekday * 10,
    sample_count: 2,
  })).concat(
    Array.from({ length: 7 }, (_, weekday) => ({
      threshold: 10,
      weekday,
      weekday_name: ["월", "화", "수", "목", "금", "토", "일"][weekday],
      typical_minutes_of_day: 11 * 60 + weekday * 10,
      sample_count: 1,
    }))
  ),
  history_items: [
    {
      threshold: 50,
      local_date: "2026-04-25",
      weekday: 4,
      weekday_name: "금",
      crossed_at: "2026-04-25T00:10:00.000Z",
      minutes_of_day: 550,
      available_spaces: 8,
    },
  ],
};

const weekdayHourlyPatterns: WeekdayHourlyPattern[] = [
  {
    weekday: 0,
    weekday_name: "월",
    average_available_spaces: 24,
    min_available_spaces: 8,
    max_available_spaces: 80,
    observations: 24,
    hourly_buckets: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      average_available_spaces: hour === 9 ? 18 : 24 + hour,
      min_available_spaces: hour === 9 ? 8 : 12 + hour,
      max_available_spaces: hour === 9 ? 36 : 40 + hour,
      observations: 2,
    })),
  },
  {
    weekday: 1,
    weekday_name: "화",
    average_available_spaces: 42,
    min_available_spaces: 15,
    max_available_spaces: 100,
    observations: 24,
    hourly_buckets: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      average_available_spaces: 30 + hour,
      min_available_spaces: 18 + hour,
      max_available_spaces: 42 + hour,
      observations: 2,
    })),
  },
];

const holidaySummary: HolidaySummaryResponse = {
  generated_at: "2026-05-09T00:00:00.000Z",
  start_date: "2026-04-27",
  end_date: "2026-05-17",
  source: "sample_holiday_info",
  status: "sample",
  error_message: null,
  sentence: "5/5 (화) 어린이날 입니다.",
  items: [{ local_date: "2026-04-25", name: "테스트 공휴일", weekday: 5, weekday_name: "토" }],
};

const holidayPatterns: HolidayPatternResponse = {
  generated_at: "2026-05-09T00:00:00.000Z",
  airport_code: "GMP",
  parking_lot_id: 1,
  source: "sample_holiday_info",
  status: "sample",
  error_message: null,
  items: [
    {
      local_date: "2026-04-25",
      name: "테스트 공휴일",
      day_type: "holiday",
      weekday: 5,
      weekday_name: "토",
      average_available_spaces: 35,
      min_available_spaces: 8,
      max_available_spaces: 70,
      observations: 24,
      hourly_buckets: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        average_available_spaces: hour === 9 ? 12 : 35 + hour,
        min_available_spaces: hour === 9 ? 8 : 20,
        max_available_spaces: hour === 9 ? 30 : 70,
        observations: 1,
      })),
    },
  ],
};

const timeSeries: ParkingTimeSeriesResponse = {
  generated_at: "2026-04-25T00:30:00.000Z",
  airport_code: "GMP",
  parking_lot_id: 1,
  days: 7,
  interval_minutes: 30,
  items: [
    {
      bucket_at: "2026-04-24T00:00:00.000Z",
      available_spaces: 120,
      occupied_spaces: 600,
      total_spaces: 720,
      lot_observations: 2,
    },
    {
      bucket_at: "2026-04-24T12:00:00.000Z",
      available_spaces: 90,
      occupied_spaces: 630,
      total_spaces: 720,
      lot_observations: 2,
    },
    {
      bucket_at: "2026-04-25T00:30:00.000Z",
      available_spaces: 8,
      occupied_spaces: 502,
      total_spaces: 510,
      lot_observations: 1,
    },
  ],
};

const flightStatus: FlightStatusResponse = {
  generated_at: "2026-04-25T00:30:00.000Z",
  airport_code: "GMP",
  local_date: "2026-04-25",
  source: "sample_flight_status",
  status: "sample",
  error_message: null,
  items: [
    {
      airport_code: "GMP",
      direction: "departure",
      flight_number: "KE1101",
      airline: "대한항공",
      scheduled_at: "2026-04-24T12:30:00.000Z",
      estimated_at: "2026-04-24T12:40:00.000Z",
      marker_at: "2026-04-24T12:40:00.000Z",
      origin_airport: "김포",
      destination_airport: "제주",
      status: "출발",
      line_type: "국내",
    },
  ],
};

const collectorStatus: CollectorStatusResponse = {
  scheduler_enabled: true,
  collect_interval_seconds: 300,
  manual_collect_min_interval_seconds: 300,
  client_mode: "live",
  enabled_sources: ["kac_parking"],
  data_go_kr_service_key_configured: true,
  supported_airport_codes: ["GMP", "PUS", "CJU"],
  latest_snapshot_observed_at: "2026-04-25T00:20:00.000Z",
  latest_snapshot_collected_at: "2026-04-25T00:30:00.000Z",
  manual_collect_available_at: "2026-04-25T00:35:00.000Z",
  manual_collect_blocked: false,
  upstream_rate_limited: false,
  upstream_rate_limited_until: null,
  last_run: null,
  recent_runs: [],
};

describe("DashboardScreen", () => {
  test("renders desktop table, collector controls, and detailed weekday panels in desktop mode", () => {
    render(
      <DashboardScreen
        airports={airports}
        parkingLots={airports[0].parking_lots}
        selectedAirportCode="GMP"
        selectedParkingLotId={1}
        selectedParkingLotName="국내선 제1주차장"
        scopeItems={currentItems}
        currentItems={currentItems}
        thresholdEvents={thresholdEvents}
        thresholdInsights={thresholdInsights}
        weekdayHourlyPatterns={weekdayHourlyPatterns}
        holidaySummary={holidaySummary}
        holidayPatterns={holidayPatterns}
        timeSeries={timeSeries}
        flightStatus={flightStatus}
        collectorStatus={collectorStatus}
        isMobile={false}
        loading={false}
        collecting={false}
        error={null}
        actionMessage={null}
        actionMessageIsError={false}
        onAirportChange={() => undefined}
        onAnalyticsVisible={() => undefined}
        onParkingLotChange={() => undefined}
        onRefresh={() => undefined}
        onManualCollect={() => undefined}
      />
    );

    expect(screen.getByTestId("desktop-lot-table")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-lot-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("history-chart")).toBeInTheDocument();
    expect(screen.getByTestId("daily-flight-overlay-chart")).toBeInTheDocument();
    expect(screen.getByTestId("weekday-hour-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("weekday-pattern-grid")).toBeInTheDocument();
    expect(screen.getByTestId("holiday-pattern-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("holiday-pattern-grid")).toBeInTheDocument();
    expect(screen.getByTestId("threshold-weekday-grid")).toBeInTheDocument();
    expect(screen.getByTestId("threshold-history-scroll")).toBeInTheDocument();
    expect(screen.getByTestId("weekday-hour-cell-0-9")).toHaveTextContent("18");
    expect(screen.getByRole("button", { name: "즉시 수집 실행" })).toBeInTheDocument();
    expect(screen.getByText("데이터 기준 시각: 04.25 09:20")).toBeInTheDocument();
    expect(screen.getByText("수집기 마지막 동기화: 04.25 09:30")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "상태" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "잔여/전체" })).toBeInTheDocument();
    expect(screen.getAllByText("최고 혼잡").length).toBeGreaterThan(0);
    expect(screen.queryByText("평균으로 가장 빠듯")).not.toBeInTheDocument();
    expect(screen.queryByText("색상 범례")).not.toBeInTheDocument();
    expect(screen.getByText("5/5 (화) 어린이날 입니다.")).toBeInTheDocument();
    expect(screen.queryByText("출발 전에 보는 공항 주차 레이더")).not.toBeInTheDocument();
    expect(screen.queryByText("최근 수집 시각: 04.25 09:30")).not.toBeInTheDocument();
  });

  test("renders mobile cards in mobile mode", () => {
    render(
      <DashboardScreen
        airports={airports}
        parkingLots={airports[0].parking_lots}
        selectedAirportCode="GMP"
        selectedParkingLotId={1}
        selectedParkingLotName="국내선 제1주차장"
        scopeItems={currentItems}
        currentItems={currentItems}
        thresholdEvents={thresholdEvents}
        thresholdInsights={thresholdInsights}
        weekdayHourlyPatterns={weekdayHourlyPatterns}
        holidaySummary={holidaySummary}
        holidayPatterns={holidayPatterns}
        timeSeries={timeSeries}
        flightStatus={flightStatus}
        collectorStatus={collectorStatus}
        isMobile
        loading={false}
        collecting={false}
        error={null}
        actionMessage={null}
        actionMessageIsError={false}
        onAirportChange={() => undefined}
        onAnalyticsVisible={() => undefined}
        onParkingLotChange={() => undefined}
        onRefresh={() => undefined}
        onManualCollect={() => undefined}
      />
    );

    expect(screen.getByTestId("mobile-lot-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-lot-table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "즉시 수집 실행" })).toBeInTheDocument();
    expect(screen.getAllByText("국내선 제1주차장").length).toBeGreaterThan(0);
    expect(screen.getAllByText("잔여/전체").length).toBeGreaterThan(0);
    expect(screen.getAllByText("일 단위 잔여 주차면 변화").length).toBeGreaterThan(0);
    expect(screen.getByText("요일별 상세 패턴")).toBeInTheDocument();
    expect(screen.getAllByTestId("mobile-disclosure").length).toBeGreaterThanOrEqual(4);
  });

  test("calls lot change handler when selecting a parking lot", async () => {
    const user = userEvent.setup();
    const onParkingLotChange = vi.fn();

    render(
      <DashboardScreen
        airports={airports}
        parkingLots={airports[0].parking_lots}
        selectedAirportCode="GMP"
        selectedParkingLotId={null}
        selectedParkingLotName={null}
        scopeItems={currentItems}
        currentItems={currentItems}
        thresholdEvents={thresholdEvents}
        thresholdInsights={thresholdInsights}
        weekdayHourlyPatterns={weekdayHourlyPatterns}
        holidaySummary={holidaySummary}
        holidayPatterns={holidayPatterns}
        timeSeries={timeSeries}
        flightStatus={flightStatus}
        collectorStatus={collectorStatus}
        isMobile={false}
        loading={false}
        collecting={false}
        error={null}
        actionMessage={null}
        actionMessageIsError={false}
        onAirportChange={() => undefined}
        onAnalyticsVisible={() => undefined}
        onParkingLotChange={onParkingLotChange}
        onRefresh={() => undefined}
        onManualCollect={() => undefined}
      />
    );

    await user.selectOptions(screen.getByLabelText("세부 주차장"), "2");
    expect(onParkingLotChange).toHaveBeenCalledWith(2);
  });

  test("shows collector cooldown message as an error notice", () => {
    render(
      <DashboardScreen
        airports={airports}
        parkingLots={airports[0].parking_lots}
        selectedAirportCode="GMP"
        selectedParkingLotId={1}
        selectedParkingLotName="국내선 제1주차장"
        scopeItems={currentItems}
        currentItems={currentItems}
        thresholdEvents={thresholdEvents}
        thresholdInsights={thresholdInsights}
        weekdayHourlyPatterns={weekdayHourlyPatterns}
        holidaySummary={holidaySummary}
        holidayPatterns={holidayPatterns}
        timeSeries={timeSeries}
        flightStatus={flightStatus}
        collectorStatus={collectorStatus}
        isMobile={false}
        loading={false}
        collecting={false}
        error={null}
        actionMessage="마지막 업데이트 후 5분이 지나지 않았습니다."
        actionMessageIsError
        onAirportChange={() => undefined}
        onAnalyticsVisible={() => undefined}
        onParkingLotChange={() => undefined}
        onRefresh={() => undefined}
        onManualCollect={() => undefined}
      />
    );

    expect(screen.getByText("마지막 업데이트 후 5분이 지나지 않았습니다.")).toHaveClass("notice", "error");
  });
});
