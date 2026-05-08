import { fireEvent, render, screen, within } from "@testing-library/react";

import { HistoryChart } from "@/components/history-chart";
import { formatDateTimeWithZone } from "@/lib/format";
import type { FlightStatusResponse, ParkingTimeSeriesResponse } from "@/lib/types";

function buildSeries(): ParkingTimeSeriesResponse {
  const start = new Date("2026-04-23T15:00:00.000Z").getTime();

  return {
    generated_at: "2026-04-24T03:00:00.000Z",
    airport_code: "CJU",
    parking_lot_id: 1,
    days: 7,
    interval_minutes: 30,
    items: Array.from({ length: 25 }, (_, index) => ({
      bucket_at: new Date(start + index * 30 * 60 * 1000).toISOString(),
      available_spaces: 100 + index,
      occupied_spaces: 500 - index,
      total_spaces: 600,
      lot_observations: 1,
    })),
  };
}

function buildFlightStatus(): FlightStatusResponse {
  return {
    generated_at: "2026-04-24T03:00:00.000Z",
    airport_code: "CJU",
    local_date: "2026-04-24",
    source: "sample_flight_status",
    status: "sample",
    error_message: null,
    items: [
      {
        airport_code: "CJU",
        direction: "departure",
        flight_number: "KE1101",
        airline: "대한항공",
        scheduled_at: "2026-04-24T00:30:00.000Z",
        estimated_at: "2026-04-24T00:40:00.000Z",
        marker_at: "2026-04-24T00:40:00.000Z",
        origin_airport: "제주",
        destination_airport: "김포",
        status: "출발",
        line_type: "국내",
      },
      {
        airport_code: "CJU",
        direction: "arrival",
        flight_number: "OZ8922",
        airline: "아시아나항공",
        scheduled_at: "2026-04-24T02:10:00.000Z",
        estimated_at: null,
        marker_at: "2026-04-24T02:10:00.000Z",
        origin_airport: "김포",
        destination_airport: "제주",
        status: "도착",
        line_type: "국내",
      },
    ],
  };
}

describe("HistoryChart", () => {
  test("renders 6 hour axis labels", () => {
    const { container } = render(
      <HistoryChart flightStatus={buildFlightStatus()} series={buildSeries()} scopeLabel={"P1 \uC8FC\uCC28\uC7A5"} />
    );

    const axisLabels = screen.getAllByTestId("history-axis-label");
    expect(axisLabels).toHaveLength(3);
    expect(screen.getByTestId("history-axis-shell")).toBeInTheDocument();
    expect(screen.getByText("\uAE30\uC900: P1 \uC8FC\uCC28\uC7A5")).toBeInTheDocument();
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByText("06:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();

    const linePath = container.querySelector(".history-line");
    expect(linePath?.getAttribute("d")).toContain("H");
    expect(linePath?.getAttribute("d")).toContain("V");

    const tooltip = screen.getByTestId("history-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(within(tooltip).getByText("124\uB300")).toBeInTheDocument();
    expect(
      within(tooltip).getByText(formatDateTimeWithZone(buildSeries().items[24].bucket_at))
    ).toBeInTheDocument();
  });

  test("shows tooltip with time and available spaces on hover", () => {
    const series = buildSeries();

    render(<HistoryChart flightStatus={buildFlightStatus()} series={series} scopeLabel={"P1 \uC8FC\uCC28\uC7A5"} />);

    const interactionSurface = screen.getByTestId("history-chart-surface");
    Object.defineProperty(interactionSurface, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1080,
        bottom: 280,
        width: 1080,
        height: 280,
        toJSON: () => ({}),
      }),
    });

    fireEvent.mouseMove(interactionSurface, { clientX: 540 });

    const tooltip = screen.getByTestId("history-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(within(tooltip).getByText("112\uB300")).toBeInTheDocument();
    expect(within(tooltip).getByText(formatDateTimeWithZone(series.items[12].bucket_at))).toBeInTheDocument();
  });

  test("renders flight markers and flight details inside the chart area", () => {
    render(<HistoryChart flightStatus={buildFlightStatus()} series={buildSeries()} scopeLabel={"P1 \uC8FC\uCC28\uC7A5"} />);

    expect(screen.getAllByTestId("flight-marker")).toHaveLength(2);
    expect(screen.getByTestId("flight-marker-summary")).toHaveTextContent("출발 1편 / 도착 1편");
    expect(screen.getByTestId("flight-marker-list")).toHaveTextContent("KE1101");
    expect(screen.getByTestId("flight-marker-list")).toHaveTextContent("제주 -> 김포");
  });
});
