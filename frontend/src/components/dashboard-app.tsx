"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DashboardScreen } from "@/components/dashboard-screen";
import { FeeCalculator } from "@/components/fee-calculator";
import { ApiError, buildApiClient } from "@/lib/api";
import {
  readStoredDashboardSelection,
  writeStoredDashboardSelection,
} from "@/lib/dashboard-preferences";
import { formatDateTimeWithZone } from "@/lib/format";
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

type DashboardAppProps = {
  apiBaseUrl?: string;
  autoRefreshIntervalMs?: number;
};

const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 60_000;
const ADMIN_TOKEN_STORAGE_KEY = "parking-radar-admin-token";

function buildFlightStatusError(airportCode: string, caughtError: unknown): FlightStatusResponse {
  return {
    generated_at: new Date().toISOString(),
    airport_code: airportCode,
    local_date: new Date().toISOString().slice(0, 10),
    source: "client",
    status: "client_error",
    error_message: caughtError instanceof Error ? caughtError.message : "비행편 정보를 불러오지 못했습니다.",
    items: [],
  };
}

function buildHolidaySummaryError(caughtError: unknown): HolidaySummaryResponse {
  return {
    generated_at: new Date().toISOString(),
    start_date: "",
    end_date: "",
    source: "client",
    status: "client_error",
    error_message: caughtError instanceof Error ? caughtError.message : "공휴일 정보를 불러오지 못했습니다.",
    sentence: "공휴일 정보를 불러오지 못했습니다.",
    items: [],
  };
}

function buildHolidayPatternError(airportCode: string, parkingLotId: number | null, caughtError: unknown): HolidayPatternResponse {
  return {
    generated_at: new Date().toISOString(),
    airport_code: airportCode,
    parking_lot_id: parkingLotId,
    source: "client",
    status: "client_error",
    error_message: caughtError instanceof Error ? caughtError.message : "공휴일 패턴을 불러오지 못했습니다.",
    items: [],
  };
}

function useViewportMode() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function syncViewport() {
      setIsMobile(window.innerWidth < 860);
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  return isMobile;
}

function buildCollectorCooldownMessage(status: CollectorStatusResponse): string {
  const cooldownMinutes = Math.max(1, Math.round(status.manual_collect_min_interval_seconds / 60));
  if (status.manual_collect_available_at) {
    return `마지막 업데이트 후 ${cooldownMinutes}분이 지나지 않았습니다. ${formatDateTimeWithZone(status.manual_collect_available_at)} 이후 다시 시도해 주세요.`;
  }
  return `마지막 업데이트 후 ${cooldownMinutes}분이 지나지 않았습니다. 잠시 후 다시 시도해 주세요.`;
}

function readStoredAdminToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeStoredAdminToken(token: string): void {
  try {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures; the entered token can still be used once.
  }
}

function clearStoredAdminToken(): void {
  try {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function DashboardApp({
  apiBaseUrl,
  autoRefreshIntervalMs = DASHBOARD_AUTO_REFRESH_INTERVAL_MS,
}: DashboardAppProps) {
  const api = useMemo(() => buildApiClient(apiBaseUrl), [apiBaseUrl]);
  const mountedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const isMobile = useViewportMode();
  const [airports, setAirports] = useState<Airport[]>([]);
  const [selectedAirportCode, setSelectedAirportCode] = useState("");
  const [selectedParkingLotId, setSelectedParkingLotId] = useState<number | null>(null);
  const [currentItems, setCurrentItems] = useState<ParkingStatus[]>([]);
  const [thresholdEvents, setThresholdEvents] = useState<ThresholdEvent[]>([]);
  const [thresholdInsights, setThresholdInsights] = useState<ThresholdInsightsResponse | null>(null);
  const [weekdayHourlyPatterns, setWeekdayHourlyPatterns] = useState<WeekdayHourlyPattern[]>([]);
  const [holidaySummary, setHolidaySummary] = useState<HolidaySummaryResponse | null>(null);
  const [holidayPatterns, setHolidayPatterns] = useState<HolidayPatternResponse | null>(null);
  const [timeSeries, setTimeSeries] = useState<ParkingTimeSeriesResponse | null>(null);
  const [flightStatus, setFlightStatus] = useState<FlightStatusResponse | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionMessageIsError, setActionMessageIsError] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAirportData = useCallback(
    async (
      airportCode: string,
      parkingLotId: number | null = null,
      options: { showLoading?: boolean } = {}
    ) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      const showLoading = options.showLoading ?? true;

      if (showLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const flightStatusRequest = api
          .getFlightStatus(airportCode)
          .catch((caughtError) => buildFlightStatusError(airportCode, caughtError));
        const holidaySummaryRequest = api.getHolidaySummary().catch(buildHolidaySummaryError);
        const holidayPatternsRequest = api
          .getHolidayPatterns(airportCode, { parkingLotId })
          .catch((caughtError) => buildHolidayPatternError(airportCode, parkingLotId, caughtError));
        const [current, thresholds, thresholdDetail, weekdayHourly, holidays, holidayPatternDetail, timeseries, flights, status] = await Promise.all([
          api.getCurrent(airportCode),
          api.getThresholdEvents(airportCode, parkingLotId),
          api.getThresholdInsights(airportCode, { parkingLotId }),
          api.getByWeekdayHour(airportCode, parkingLotId),
          holidaySummaryRequest,
          holidayPatternsRequest,
          api.getTimeSeries(airportCode, { parkingLotId }),
          flightStatusRequest,
          api.getCollectorStatus(),
        ]);
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        setCurrentItems(current.items);
        setThresholdEvents(thresholds);
        setThresholdInsights(thresholdDetail);
        setWeekdayHourlyPatterns(weekdayHourly);
        setHolidaySummary(holidays);
        setHolidayPatterns(holidayPatternDetail);
        setTimeSeries(timeseries);
        setFlightStatus(flights);
        setCollectorStatus(status);
      } catch (caughtError) {
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        setActionMessageIsError(true);
        setError(caughtError instanceof Error ? caughtError.message : "대시보드 데이터를 불러오지 못했습니다.");
      } finally {
        if (mountedRef.current && loadRequestIdRef.current === requestId && showLoading) {
          setLoading(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const loadedAirports = await api.getAirports();
        if (!active) {
          return;
        }

        setAirports(loadedAirports);
        const storedSelection = readStoredDashboardSelection();
        const initialAirport =
          loadedAirports.find((airport) => airport.code === storedSelection?.airportCode) ?? loadedAirports[0] ?? null;
        const initialParkingLotId =
          storedSelection?.parkingLotId != null &&
          initialAirport?.parking_lots.some(
            (parkingLot) => parkingLot.is_active && parkingLot.id === storedSelection.parkingLotId
          )
            ? storedSelection.parkingLotId
            : null;
        const initialAirportCode = initialAirport?.code ?? "";

        setSelectedAirportCode(initialAirportCode);
        setSelectedParkingLotId(initialParkingLotId);

        if (initialAirportCode) {
          await loadAirportData(initialAirportCode, initialParkingLotId);
        } else {
          setLoading(false);
        }
      } catch (caughtError) {
        if (!active) {
          return;
        }

        setError(caughtError instanceof Error ? caughtError.message : "공항 목록을 불러오지 못했습니다.");
        setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [api, loadAirportData]);

  useEffect(() => {
    if (!selectedAirportCode) {
      return;
    }

    function refreshVisibleDashboard() {
      if (document.visibilityState === "hidden") {
        return;
      }
      void loadAirportData(selectedAirportCode, selectedParkingLotId, { showLoading: false });
    }

    const refreshTimer = window.setInterval(refreshVisibleDashboard, autoRefreshIntervalMs);
    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);

    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
  }, [autoRefreshIntervalMs, loadAirportData, selectedAirportCode, selectedParkingLotId]);

  useEffect(() => {
    if (!selectedAirportCode) {
      return;
    }

    writeStoredDashboardSelection({
      airportCode: selectedAirportCode,
      parkingLotId: selectedParkingLotId,
    });
  }, [selectedAirportCode, selectedParkingLotId]);

  const selectedAirport = useMemo(
    () => airports.find((airport) => airport.code === selectedAirportCode) ?? null,
    [airports, selectedAirportCode]
  );
  const selectedAirportLots = selectedAirport?.parking_lots.filter((parkingLot) => parkingLot.is_active) ?? [];
  const selectedParkingLot = selectedAirportLots.find((parkingLot) => parkingLot.id === selectedParkingLotId) ?? null;

  const scopeItems = useMemo(
    () => currentItems.filter((item) => selectedParkingLotId === null || item.parking_lot_id === selectedParkingLotId),
    [currentItems, selectedParkingLotId]
  );

  async function runCollectorWithAdminToken() {
    const storedToken = readStoredAdminToken();
    try {
      return await api.runCollector(storedToken ?? undefined);
    } catch (caughtError) {
      if (!(caughtError instanceof ApiError) || caughtError.status !== 401) {
        throw caughtError;
      }

      clearStoredAdminToken();
      const enteredToken = window.prompt("관리 토큰을 입력하세요.");
      const trimmedToken = enteredToken?.trim();
      if (!trimmedToken) {
        throw caughtError;
      }

      writeStoredAdminToken(trimmedToken);
      try {
        return await api.runCollector(trimmedToken);
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401) {
          clearStoredAdminToken();
        }
        throw retryError;
      }
    }
  }

  async function handleManualCollect() {
    setActionMessage(null);
    setActionMessageIsError(false);
    setError(null);

    if (collectorStatus?.manual_collect_blocked) {
      setActionMessage(buildCollectorCooldownMessage(collectorStatus));
      setActionMessageIsError(true);
      return;
    }

    try {
      setCollecting(true);
      const summary = await runCollectorWithAdminToken();
      await loadAirportData(selectedAirportCode, selectedParkingLotId);
      setActionMessageIsError(false);
      setActionMessage(`즉시 수집을 완료했습니다. 신규 스냅샷 ${summary.snapshot_count}건을 저장했습니다.`);
    } catch (caughtError) {
      setActionMessageIsError(true);
      setActionMessage(caughtError instanceof Error ? caughtError.message : "즉시 수집 실행에 실패했습니다.");
    } finally {
      setCollecting(false);
    }
  }

  return (
    <>
      <DashboardScreen
        airports={airports}
        parkingLots={selectedAirportLots}
        selectedAirportCode={selectedAirportCode}
        selectedParkingLotId={selectedParkingLotId}
        selectedParkingLotName={selectedParkingLot?.name ?? null}
        scopeItems={scopeItems}
        currentItems={scopeItems}
        thresholdEvents={thresholdEvents}
        thresholdInsights={thresholdInsights}
        weekdayHourlyPatterns={weekdayHourlyPatterns}
        holidaySummary={holidaySummary}
        holidayPatterns={holidayPatterns}
        timeSeries={timeSeries}
        flightStatus={flightStatus}
        collectorStatus={collectorStatus}
        isMobile={isMobile}
        loading={loading}
        collecting={collecting}
        error={error}
        actionMessage={actionMessage}
        actionMessageIsError={actionMessageIsError}
        onAirportChange={(airportCode) => {
          startTransition(() => {
            setSelectedAirportCode(airportCode);
            setSelectedParkingLotId(null);
            setActionMessage(null);
            setActionMessageIsError(false);
          });
          void loadAirportData(airportCode, null);
        }}
        onParkingLotChange={(parkingLotId) => {
          startTransition(() => {
            setSelectedParkingLotId(parkingLotId);
            setActionMessage(null);
            setActionMessageIsError(false);
          });
          void loadAirportData(selectedAirportCode, parkingLotId);
        }}
        onRefresh={() => {
          setActionMessage(null);
          setActionMessageIsError(false);
          if (selectedAirportCode) {
            void loadAirportData(selectedAirportCode, selectedParkingLotId);
          }
        }}
        onManualCollect={() => {
          if (selectedAirportCode) {
            void handleManualCollect();
          }
        }}
      />
      {airports.length > 0 ? (
        <div className="page-shell footer-band">
          <FeeCalculator
            airports={airports}
            initialAirportCode={selectedAirportCode || airports[0].code}
            onCalculate={api.calculateFee}
          />
        </div>
      ) : null}
    </>
  );
}
