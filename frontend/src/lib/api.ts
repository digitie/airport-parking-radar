import type {
  Airport,
  CollectionSummary,
  CollectorStatusResponse,
  FeeCalculationRequest,
  FeeCalculationResponse,
  FlightStatusResponse,
  HourlyBucket,
  ParkingCurrentResponse,
  ParkingTimeSeriesResponse,
  ThresholdEvent,
  ThresholdInsightsResponse,
  WeekdayBucket,
  WeekdayHourlyPattern,
} from "@/lib/types";

const DEFAULT_API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? "8000";

function resolveDefaultApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname || "localhost";
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }

  return `http://localhost:${DEFAULT_API_PORT}`;
}

function buildAnalyticsUrl(
  baseUrl: string,
  path: string,
  airportCode: string,
  options: {
    parkingLotId?: number | null;
    days?: number;
    intervalMinutes?: number;
  } = {}
): string {
  const params = new URLSearchParams({ airport_code: airportCode });
  if (options.parkingLotId != null) {
    params.set("parking_lot_id", String(options.parkingLotId));
  }
  if (options.days != null) {
    params.set("days", String(options.days));
  }
  if (options.intervalMinutes != null) {
    params.set("interval_minutes", String(options.intervalMinutes));
  }
  return `${baseUrl}${path}?${params.toString()}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) {
      return payload.detail;
    }
  } catch {
    // Ignore JSON parse failures and fall back to a generic message.
  }
  return `API request failed: ${response.status}`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export function buildApiClient(apiBaseUrl?: string) {
  const baseUrl = (apiBaseUrl ?? resolveDefaultApiBaseUrl()).replace(/\/$/, "");

  return {
    getAirports(): Promise<Airport[]> {
      return getJson<Airport[]>(`${baseUrl}/airports`);
    },
    getCurrent(airportCode: string): Promise<ParkingCurrentResponse> {
      return getJson<ParkingCurrentResponse>(`${baseUrl}/parking/current?airport_code=${airportCode}`);
    },
    getCollectorStatus(): Promise<CollectorStatusResponse> {
      return getJson<CollectorStatusResponse>(`${baseUrl}/admin/collector-status`);
    },
    getFlightStatus(airportCode: string): Promise<FlightStatusResponse> {
      const params = new URLSearchParams({ airport_code: airportCode });
      return getJson<FlightStatusResponse>(`${baseUrl}/flights/status?${params.toString()}`);
    },
    runCollector(): Promise<CollectionSummary> {
      return getJson<CollectionSummary>(`${baseUrl}/admin/collect`, { method: "POST" });
    },
    getByHour(airportCode: string, parkingLotId: number | null = null): Promise<HourlyBucket[]> {
      return getJson<HourlyBucket[]>(buildAnalyticsUrl(baseUrl, "/parking/analytics/by-hour", airportCode, { parkingLotId }));
    },
    getByWeekday(airportCode: string, parkingLotId: number | null = null): Promise<WeekdayBucket[]> {
      return getJson<WeekdayBucket[]>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/by-weekday", airportCode, { parkingLotId })
      );
    },
    getByWeekdayHour(airportCode: string, parkingLotId: number | null = null): Promise<WeekdayHourlyPattern[]> {
      return getJson<WeekdayHourlyPattern[]>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/by-weekday-hour", airportCode, { parkingLotId })
      );
    },
    getTimeSeries(
      airportCode: string,
      options: { parkingLotId?: number | null; days?: number; intervalMinutes?: number } = {}
    ): Promise<ParkingTimeSeriesResponse> {
      const { parkingLotId = null, days = 7, intervalMinutes = 30 } = options;
      return getJson<ParkingTimeSeriesResponse>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/timeseries", airportCode, {
          parkingLotId,
          days,
          intervalMinutes,
        })
      );
    },
    getThresholdEvents(airportCode: string, parkingLotId: number | null = null): Promise<ThresholdEvent[]> {
      return getJson<ThresholdEvent[]>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/threshold-events", airportCode, { parkingLotId })
      );
    },
    getThresholdInsights(
      airportCode: string,
      options: { parkingLotId?: number | null; days?: number; intervalMinutes?: number } = {}
    ): Promise<ThresholdInsightsResponse> {
      const { parkingLotId = null, days = 21, intervalMinutes = 10 } = options;
      return getJson<ThresholdInsightsResponse>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/threshold-insights", airportCode, {
          parkingLotId,
          days,
          intervalMinutes,
        })
      );
    },
    async calculateFee(payload: FeeCalculationRequest): Promise<FeeCalculationResponse> {
      return getJson<FeeCalculationResponse>(`${baseUrl}/fees/calculate`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
  };
}
