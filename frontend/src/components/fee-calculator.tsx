"use client";

import { useEffect, useState } from "react";

import { formatCurrency } from "@/lib/format";
import type { Airport, FeeCalculationRequest, FeeCalculationResponse } from "@/lib/types";

type FeeCalculatorProps = {
  airports: Airport[];
  initialAirportCode: string;
  onCalculate: (payload: FeeCalculationRequest) => Promise<FeeCalculationResponse>;
};

function buildDefaultRange() {
  const entry = new Date();
  entry.setHours(9, 0, 0, 0);
  const exitAt = new Date(entry);
  exitAt.setHours(entry.getHours() + 6);
  return {
    entry: entry.toISOString().slice(0, 16),
    exitAt: exitAt.toISOString().slice(0, 16)
  };
}

export function FeeCalculator({ airports, initialAirportCode, onCalculate }: FeeCalculatorProps) {
  const defaults = buildDefaultRange();
  const [airportCode, setAirportCode] = useState(initialAirportCode);
  const [vehicleSize, setVehicleSize] = useState<"small" | "large">("small");
  const [entryAt, setEntryAt] = useState(defaults.entry);
  const [exitAt, setExitAt] = useState(defaults.exitAt);
  const [parkingLotId, setParkingLotId] = useState<number | null>(null);
  const [result, setResult] = useState<FeeCalculationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedAirport = airports.find((airport) => airport.code === airportCode);
  const selectableLots = selectedAirport?.parking_lots.filter((lot) => lot.is_active) ?? [];

  useEffect(() => {
    setAirportCode(initialAirportCode);
  }, [initialAirportCode]);

  useEffect(() => {
    setParkingLotId(selectableLots[0]?.id ?? null);
  }, [airportCode, airports, selectableLots]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!entryAt || !exitAt) {
      setError("입차와 출차 시각을 모두 입력해 주세요.");
      return;
    }

    if (new Date(exitAt) <= new Date(entryAt)) {
      setError("출차 시각은 입차 시각보다 늦어야 합니다.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const quote = await onCalculate({
        airport_code: airportCode,
        parking_lot_id: parkingLotId,
        vehicle_size: vehicleSize,
        entry_at: new Date(entryAt).toISOString(),
        exit_at: new Date(exitAt).toISOString()
      });
      setResult(quote);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "요금 계산에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel-surface fee-panel">
      <div className="panel-head">
        <h3>주차요금 계산기</h3>
        <p>공항별 공개 요금 기준</p>
      </div>

      <form className="fee-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>공항</span>
          <select className="input" value={airportCode} onChange={(event) => setAirportCode(event.target.value)}>
            {airports.map((airport) => (
              <option key={airport.code} value={airport.code}>
                {airport.name_ko}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>주차장</span>
          <select
            className="input"
            value={parkingLotId ?? ""}
            onChange={(event) => setParkingLotId(event.target.value ? Number(event.target.value) : null)}
          >
            {selectableLots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lot.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>차량 크기</span>
          <select
            className="input"
            value={vehicleSize}
            onChange={(event) => setVehicleSize(event.target.value as "small" | "large")}
          >
            <option value="small">소형</option>
            <option value="large">대형</option>
          </select>
        </label>

        <label className="field">
          <span>입차 시각</span>
          <input className="input" type="datetime-local" value={entryAt} onChange={(event) => setEntryAt(event.target.value)} />
        </label>

        <label className="field">
          <span>출차 시각</span>
          <input className="input" type="datetime-local" value={exitAt} onChange={(event) => setExitAt(event.target.value)} />
        </label>

        <button className="button" disabled={pending} type="submit">
          {pending ? "계산 중..." : "요금 계산"}
        </button>
      </form>

      {error ? <p className="notice error">{error}</p> : null}

      {result ? (
        <div className="quote-box">
          <div className="quote-total">
            <span>예상 요금</span>
            <strong>{result.supported ? formatCurrency(result.total_fee) : result.message ?? "미지원"}</strong>
          </div>
          {result.breakdown.length > 0 ? (
            <ul className="quote-breakdown">
              {result.breakdown.map((line) => (
                <li key={`${line.date}-${line.day_type}`}>
                  <span>
                    {line.date} · {line.day_type === "holiday" ? "휴일" : "평일"} · {line.duration_minutes}분
                  </span>
                  <strong>{formatCurrency(line.applied_fee)}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
