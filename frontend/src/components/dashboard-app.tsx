"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DashboardScreen } from "@/components/dashboard-screen";
import { BackupPanel } from "@/components/backup-panel";
import { FeeCalculator } from "@/components/fee-calculator";
import { buildApiClient } from "@/lib/api";
import {
  readStoredDashboardSelection,
  writeStoredDashboardSelection,
} from "@/lib/dashboard-preferences";
import { formatDateTime } from "@/lib/format";
import type {
  Airport,
  CollectorStatusResponse,
  DashboardAnalyticsResponse,
  DashboardBootstrapResponse,
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
  flightStatusTimeoutMs?: number;
};

const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 15_000;

function buildSelectionKey(airportCode: string, parkingLotId: number | null): string {
  return `${airportCode}:${parkingLotId ?? "all"}`;
}

function buildBackendUpdateMarker(status: CollectorStatusResponse): string {
  return `${status.latest_snapshot_observed_at ?? ""}|${status.latest_snapshot_collected_at ?? ""}`;
}

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
    error_message: caughtError instanceof Error ? caughtError.message : "공휴일/토/일요일 패턴을 불러오지 못했습니다.",
    items: [],
  };
}

function buildDashboardAnalyticsError(caughtError: unknown): DashboardAnalyticsResponse {
  throw caughtError instanceof Error ? caughtError : new Error("분석 데이터를 불러오지 못했습니다.");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, buildFallback: () => T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(buildFallback()), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeout,
  ]);
}

function useViewportMode() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

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
    return `마지막 업데이트 후 ${cooldownMinutes}분이 지나지 않았습니다. ${formatDateTime(status.manual_collect_available_at)} 이후 다시 시도해 주세요.`;
  }
  return `마지막 업데이트 후 ${cooldownMinutes}분이 지나지 않았습니다. 잠시 후 다시 시도해 주세요.`;
}

export function DashboardApp({
  apiBaseUrl,
  autoRefreshIntervalMs = DASHBOARD_AUTO_REFRESH_INTERVAL_MS,
  flightStatusTimeoutMs = 6_000,
}: DashboardAppProps) {
  const api = useMemo(() => buildApiClient(apiBaseUrl), [apiBaseUrl]);
  const mountedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const analyticsRequestIdRef = useRef(0);
  const analyticsVisibleRef = useRef(false);
  const analyticsLoadedScopeRef = useRef<string | null>(null);
  const analyticsInFlightScopeRef = useRef<string | null>(null);
  const latestBackendUpdateMarkerRef = useRef<string | null>(null);
  const backendRefreshInFlightRef = useRef(false);
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

  const loadAnalyticsData = useCallback(
    async (
      airportCode: string,
      parkingLotId: number | null = null,
      options: { force?: boolean } = {}
    ) => {
      const scopeKey = buildSelectionKey(airportCode, parkingLotId);
      if (!options.force && (analyticsLoadedScopeRef.current === scopeKey || analyticsInFlightScopeRef.current === scopeKey)) {
        return;
      }

      const requestId = analyticsRequestIdRef.current + 1;
      analyticsRequestIdRef.current = requestId;
      analyticsInFlightScopeRef.current = scopeKey;

      try {
        const flightStatusRequest = withTimeout(
          api.getFlightStatus(airportCode).catch((caughtError) => buildFlightStatusError(airportCode, caughtError)),
          flightStatusTimeoutMs,
          () => buildFlightStatusError(airportCode, new Error("비행편 정보 응답이 지연되어 주차 현황을 먼저 표시합니다."))
        );
        const analyticsRequest = api.getDashboardAnalytics(airportCode, parkingLotId).catch(buildDashboardAnalyticsError);
        const [analytics, flights] = await Promise.all([analyticsRequest, flightStatusRequest]);

        if (!mountedRef.current || analyticsRequestIdRef.current !== requestId) {
          return;
        }
        setThresholdEvents(analytics.threshold_events);
        setThresholdInsights(analytics.threshold_insights);
        setWeekdayHourlyPatterns(analytics.weekday_hour_patterns);
        setHolidayPatterns(analytics.holiday_patterns);
        setTimeSeries(analytics.time_series);
        setFlightStatus(flights);
        analyticsLoadedScopeRef.current = scopeKey;
      } catch (caughtError) {
        if (!mountedRef.current || analyticsRequestIdRef.current !== requestId) {
          return;
        }
        setError(caughtError instanceof Error ? caughtError.message : "분석 데이터를 불러오지 못했습니다.");
      } finally {
        if (analyticsInFlightScopeRef.current === scopeKey) {
          analyticsInFlightScopeRef.current = null;
        }
      }
    },
    [api, flightStatusTimeoutMs]
  );

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
        setFlightStatus(null);
        setThresholdEvents([]);
        setThresholdInsights(null);
        setWeekdayHourlyPatterns([]);
        setHolidaySummary(null);
        setHolidayPatterns(null);
        setTimeSeries(null);
        analyticsLoadedScopeRef.current = null;
        analyticsInFlightScopeRef.current = null;
      }
      setError(null);

      try {
        const bootstrap = await api.getDashboardBootstrap(airportCode);
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        setCurrentItems(bootstrap.current.items);
        setCollectorStatus(bootstrap.collector);
        latestBackendUpdateMarkerRef.current = buildBackendUpdateMarker(bootstrap.collector);
        setHolidaySummary(bootstrap.holidays);
        if (showLoading) {
          setLoading(false);
        }
        if (analyticsVisibleRef.current) {
          void loadAnalyticsData(airportCode, parkingLotId, { force: !showLoading });
        }
        return;
      } catch (caughtError) {
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        setActionMessageIsError(true);
        setError(caughtError instanceof Error ? caughtError.message : "대시보드 데이터를 불러오지 못했습니다.");
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [api, loadAnalyticsData]
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const bootstrapPayload: DashboardBootstrapResponse = await api.getDashboardBootstrap();
        const loadedAirports = bootstrapPayload.airports;
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

        if (initialAirportCode && active) {
          setCurrentItems(bootstrapPayload.current.items);
          setCollectorStatus(bootstrapPayload.collector);
          latestBackendUpdateMarkerRef.current = buildBackendUpdateMarker(bootstrapPayload.collector);
          setHolidaySummary(bootstrapPayload.holidays);
          setLoading(false);
          if (analyticsVisibleRef.current) {
            void loadAnalyticsData(initialAirportCode, initialParkingLotId);
          }
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
  }, [api, loadAnalyticsData]);

  useEffect(() => {
    if (!selectedAirportCode) {
      return;
    }

    let active = true;

    async function refreshVisibleDashboard() {
      if (document.visibilityState === "hidden") {
        return;
      }

      try {
        const status = await api.getCollectorStatus();
        if (!active || !mountedRef.current) {
          return;
        }

        const nextMarker = buildBackendUpdateMarker(status);
        const previousMarker = latestBackendUpdateMarkerRef.current;
        setCollectorStatus(status);

        if (previousMarker === null) {
          latestBackendUpdateMarkerRef.current = nextMarker;
          return;
        }

        if (nextMarker === previousMarker || backendRefreshInFlightRef.current) {
          return;
        }

        backendRefreshInFlightRef.current = true;
        await loadAirportData(selectedAirportCode, selectedParkingLotId, { showLoading: false });
      } catch {
        // Keep the last known dashboard visible; the next poll or focus event will retry.
      } finally {
        backendRefreshInFlightRef.current = false;
      }
    }

    const refreshTimer = window.setInterval(refreshVisibleDashboard, autoRefreshIntervalMs);
    window.addEventListener("focus", refreshVisibleDashboard);
    document.addEventListener("visibilitychange", refreshVisibleDashboard);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshVisibleDashboard);
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
    };
  }, [api, autoRefreshIntervalMs, loadAirportData, selectedAirportCode, selectedParkingLotId]);

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
    () =>
      currentItems.filter(
        (item) =>
          item.airport_code === selectedAirportCode &&
          (selectedParkingLotId === null || item.parking_lot_id === selectedParkingLotId)
      ),
    [currentItems, selectedAirportCode, selectedParkingLotId]
  );

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
      const summary = await api.runCollector();
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

  const handleAnalyticsVisible = useCallback(() => {
    analyticsVisibleRef.current = true;
    if (selectedAirportCode) {
      void loadAnalyticsData(selectedAirportCode, selectedParkingLotId);
    }
  }, [loadAnalyticsData, selectedAirportCode, selectedParkingLotId]);

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
        onAnalyticsVisible={handleAnalyticsVisible}
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
          {isMobile === null ? (
            <div className="responsive-desktop">
              <FeeCalculator
                airports={airports}
                initialAirportCode={selectedAirportCode || airports[0].code}
                onCalculate={api.calculateFee}
              />
            </div>
          ) : isMobile ? (
            <details className="mobile-disclosure">
              <summary>
                <span>주차요금 계산</span>
                <small>예상 이용 시간으로 요금 보기</small>
              </summary>
              <div className="mobile-disclosure-body">
                <FeeCalculator
                  airports={airports}
                  initialAirportCode={selectedAirportCode || airports[0].code}
                  onCalculate={api.calculateFee}
                />
              </div>
            </details>
          ) : (
            <FeeCalculator
              airports={airports}
              initialAirportCode={selectedAirportCode || airports[0].code}
              onCalculate={api.calculateFee}
            />
          )}
          <BackupPanel
            listBackups={api.listBackups}
            createBackup={api.createBackup}
            downloadBackup={api.downloadBackup}
            restoreBackup={api.restoreBackup}
          />
        </div>
      ) : null}
    </>
  );
}
