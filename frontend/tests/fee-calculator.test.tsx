import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FeeCalculator } from "@/components/fee-calculator";
import type { Airport, FeeCalculationResponse } from "@/lib/types";

const airports: Airport[] = [
  {
    code: "GMP",
    name_ko: "김포국제공항",
    name_en: "Gimpo",
    source: "kac",
    parking_lots: [{ id: 1, source_lot_id: "gmp-1", legacy_source_lot_id: null, name: "국내선 제1주차장", terminal: "국내선", category: "short", is_active: true }]
  },
  {
    code: "ICN",
    name_ko: "인천국제공항",
    name_en: "Incheon",
    source: "incheon",
    parking_lots: [{ id: 2, source_lot_id: "icn-1", legacy_source_lot_id: null, name: "T1 단기주차장", terminal: "T1", category: "short", is_active: true }]
  }
];

describe("FeeCalculator", () => {
  test("shows validation message when exit is earlier than entry", async () => {
    const user = userEvent.setup();

    render(
      <FeeCalculator
        airports={airports}
        initialAirportCode="GMP"
        onCalculate={async () =>
          ({
            supported: true,
            airport_code: "GMP",
            vehicle_size: "small",
            total_fee: 4000,
            currency: "KRW",
            message: null,
            breakdown: []
          }) as FeeCalculationResponse
        }
      />
    );

    await user.clear(screen.getByLabelText("입차 시각"));
    await user.type(screen.getByLabelText("입차 시각"), "2026-04-25T18:00");
    await user.clear(screen.getByLabelText("출차 시각"));
    await user.type(screen.getByLabelText("출차 시각"), "2026-04-25T12:00");
    await user.click(screen.getByRole("button", { name: "요금 계산" }));

    expect(screen.getByText("출차 시각은 입차 시각보다 늦어야 합니다.")).toBeInTheDocument();
  });

  test("shows unsupported message for incheon", async () => {
    const user = userEvent.setup();

    render(
      <FeeCalculator
        airports={airports}
        initialAirportCode="ICN"
        onCalculate={async () =>
          ({
            supported: false,
            airport_code: "ICN",
            vehicle_size: "small",
            total_fee: null,
            currency: "KRW",
            message: "인천공항은 현재 요금 계산을 지원하지 않습니다.",
            breakdown: []
          }) as FeeCalculationResponse
        }
      />
    );

    await user.click(screen.getByRole("button", { name: "요금 계산" }));
    expect(screen.getByText("인천공항은 현재 요금 계산을 지원하지 않습니다.")).toBeInTheDocument();
  });
});
