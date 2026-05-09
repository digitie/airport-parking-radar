import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DashboardApp } from "@/components/dashboard-app";
import { DASHBOARD_SELECTION_STORAGE_KEY } from "@/lib/dashboard-preferences";
import type {
  Airport,
  CollectorStatusResponse,
  FlightStatusResponse,
  HolidayPatternResponse,
  HolidaySummaryResponse,
  ParkingCurrentResponse,
  ParkingTimeSeriesResponse,
  ThresholdInsightsResponse,
} from "@/lib/types";

const airports: Airport[] = [
  {
    code: "GMP",
    name_ko: "Gimpo",
    name_en: "Gimpo",
    source: "kac",
    parking_lots: [{ id: 1, name: "Domestic P1", terminal: null, category: null, is_active: true }],
  },
  {
    code: "PUS",
    name_ko: "Gimhae",
    name_en: "Gimhae",
    source: "kac",
    parking_lots: [{ id: 5, name: "Passenger P1", terminal: null, category: null, is_active: true }],
  },
];

const currentPayload: ParkingCurrentResponse = {
  generated_at: "2026-04-26T00:00:00.000Z",
  items: [
    {
      airport_code: "GMP",
      airport_name: "Gimpo",
      parking_lot_id: 1,
      parking_lot_name: "Domestic P1",
      terminal: null,
      category: null,
      observed_at: "2026-04-26T00:00:00.000Z",
      collected_at: "2026-04-26T00:10:00.000Z",
      occupied_spaces: 100,
      total_spaces: 200,
      available_spaces: 100,
      congestion_label: null,
      congestion_ratio: 50,
      status_level: "stable",
    },
  ],
};

const refreshedCurrentPayload: ParkingCurrentResponse = {
  ...currentPayload,
  generated_at: "2026-04-26T00:01:00.000Z",
  items: [
    {
      ...currentPayload.items[0],
      observed_at: "2026-04-26T00:01:00.000Z",
      collected_at: "2026-04-26T00:11:00.000Z",
      occupied_spaces: 136,
      available_spaces: 64,
    },
  ],
};

const timeSeriesPayload: ParkingTimeSeriesResponse = {
  generated_at: "2026-04-26T00:00:00.000Z",
  airport_code: "GMP",
  parking_lot_id: null,
  days: 7,
  interval_minutes: 30,
  items: [
    {
      bucket_at: "2026-04-26T00:00:00.000Z",
      available_spaces: 100,
      occupied_spaces: 100,
      total_spaces: 200,
      lot_observations: 1,
    },
  ],
};

const holidaySummaryPayload: HolidaySummaryResponse = {
  generated_at: "2026-05-09T00:00:00.000Z",
  start_date: "2026-04-27",
  end_date: "2026-05-17",
  source: "sample_holiday_info",
  status: "sample",
  error_message: null,
  sentence: "5/5 (화) 어린이날 입니다.",
  items: [{ local_date: "2026-05-05", name: "어린이날", weekday: 1, weekday_name: "화" }],
};

const holidayPatternPayload: HolidayPatternResponse = {
  generated_at: "2026-05-09T00:00:00.000Z",
  airport_code: "GMP",
  parking_lot_id: null,
  source: "sample_holiday_info",
  status: "sample",
  error_message: null,
  items: [],
};

const thresholdInsightsPayload: ThresholdInsightsResponse = {
  generated_at: "2026-04-26T00:00:00.000Z",
  airport_code: "GMP",
  parking_lot_id: null,
  days: 21,
  interval_minutes: 10,
  weekday_items: [],
  history_items: [],
};

const flightStatusPayload: FlightStatusResponse = {
  generated_at: "2026-04-26T00:00:00.000Z",
  airport_code: "GMP",
  local_date: "2026-04-26",
  source: "sample_flight_status",
  status: "sample",
  error_message: null,
  items: [],
};

function buildCollectorStatus(overrides: Partial<CollectorStatusResponse> = {}): CollectorStatusResponse {
  return {
    scheduler_enabled: true,
    collect_interval_seconds: 300,
    manual_collect_min_interval_seconds: 300,
    client_mode: "live",
    enabled_sources: ["kac_parking"],
    data_go_kr_service_key_configured: true,
    supported_airport_codes: ["GMP", "PUS"],
    latest_snapshot_observed_at: "2026-04-26T00:00:00.000Z",
    latest_snapshot_collected_at: "2026-04-26T00:10:00.000Z",
    manual_collect_available_at: "2026-04-26T00:15:00.000Z",
    manual_collect_blocked: false,
    last_run: null,
    recent_runs: [],
    ...overrides,
  };
}

const apiClient = {
  getAirports: vi.fn(async () => airports),
  getCurrent: vi.fn(async () => currentPayload),
  getThresholdEvents: vi.fn(async () => []),
  getThresholdInsights: vi.fn(async () => thresholdInsightsPayload),
  getByWeekdayHour: vi.fn(async () => []),
  getHolidaySummary: vi.fn(async () => holidaySummaryPayload),
  getHolidayPatterns: vi.fn(async () => holidayPatternPayload),
  getTimeSeries: vi.fn(async () => timeSeriesPayload),
  getFlightStatus: vi.fn(async () => flightStatusPayload),
  getCollectorStatus: vi.fn(async () => buildCollectorStatus()),
  runCollector: vi.fn(async () => ({
    collection_run_id: 1,
    status: "success",
    client_mode: "live",
    raw_response_count: 1,
    snapshot_count: 1,
    fee_rule_count: 0,
    errors: [],
  })),
  calculateFee: vi.fn(),
};

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  buildApiClient: () => apiClient,
}));

vi.mock("@/components/fee-calculator", () => ({
  FeeCalculator: () => <div data-testid="fee-calculator-stub" />,
}));

describe("DashboardApp", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    localStorage.clear();
    vi.clearAllMocks();
    apiClient.getCollectorStatus.mockResolvedValue(buildCollectorStatus());
  });

  test("restores the last selected airport and parking lot from localStorage", async () => {
    localStorage.setItem(
      DASHBOARD_SELECTION_STORAGE_KEY,
      JSON.stringify({ airportCode: "PUS", parkingLotId: 5 })
    );

    render(<DashboardApp apiBaseUrl="http://localhost:8000" />);

    expect(await screen.findByDisplayValue("Gimhae")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("5");
  });

  test("stores the selected airport when the user changes it", async () => {
    const user = userEvent.setup();

    render(<DashboardApp apiBaseUrl="http://localhost:8000" />);

    await user.selectOptions(await screen.findByDisplayValue("Gimpo"), "PUS");

    await waitFor(() => {
      expect(localStorage.getItem(DASHBOARD_SELECTION_STORAGE_KEY)).toContain("\"airportCode\":\"PUS\"");
    });
  });

  test("shows the collector cooldown using the reported interval minutes", async () => {
    const user = userEvent.setup();
    apiClient.getCollectorStatus.mockResolvedValue(
      buildCollectorStatus({
        collect_interval_seconds: 1200,
        manual_collect_min_interval_seconds: 1200,
        manual_collect_available_at: "2026-04-26T00:30:00.000Z",
        manual_collect_blocked: true,
      })
    );

    render(<DashboardApp apiBaseUrl="http://localhost:8000" />);

    await screen.findByTestId("history-chart");
    await user.click(screen.getByTestId("manual-collect-button"));

    expect(
      await screen.findByText("마지막 업데이트 후 20분이 지나지 않았습니다. 04.26 09:30 이후 다시 시도해 주세요.")
    ).toBeInTheDocument();
  });

  test("does not ask for a token while loading read-only dashboard data", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);

    render(<DashboardApp apiBaseUrl="http://localhost:8000" />);

    await screen.findByTestId("history-chart");
    expect(promptSpy).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  test("runs manual collection without asking for a token", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("unused-token");

    render(<DashboardApp apiBaseUrl="http://localhost:8000" />);

    await screen.findByTestId("history-chart");
    await user.click(screen.getByTestId("manual-collect-button"));

    expect(promptSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.runCollector).toHaveBeenCalledWith();
    });

    promptSpy.mockRestore();
  });

  test("shows parking data before delayed flight status finishes", async () => {
    apiClient.getFlightStatus.mockImplementationOnce(() => new Promise<FlightStatusResponse>(() => undefined));

    render(<DashboardApp apiBaseUrl="http://localhost:8000" flightStatusTimeoutMs={20} />);

    await screen.findByTestId("history-chart");
    expect(screen.queryByText("데이터를 불러오는 중입니다.")).not.toBeInTheDocument();
    expect(screen.getAllByText("지금 주차 여유").length).toBeGreaterThan(0);
  });

  test("refreshes dashboard data automatically without a page reload", async () => {
    apiClient.getCurrent.mockResolvedValueOnce(currentPayload).mockResolvedValue(refreshedCurrentPayload);

    render(<DashboardApp apiBaseUrl="http://localhost:8000" autoRefreshIntervalMs={20} />);

    await screen.findByTestId("history-chart");
    expect(apiClient.getCurrent).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(apiClient.getCurrent.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText((_, element) => element?.textContent === "64/200대").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("데이터를 불러오는 중입니다.")).not.toBeInTheDocument();
  });
});
