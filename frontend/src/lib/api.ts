import type {
  Airport,
  CollectionSummary,
  CollectorStatusResponse,
  FeeCalculationRequest,
  FeeCalculationResponse,
  FlightStatusResponse,
  HolidayPatternResponse,
  HolidaySummaryResponse,
  HourlyBucket,
  ParkingCurrentResponse,
  ParkingTimeSeriesResponse,
  ThresholdEvent,
  ThresholdInsightsResponse,
  WeekdayBucket,
  WeekdayHourlyPattern,
} from "@/lib/types";

const DEFAULT_API_BASE_PATH = "/api/backend";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function resolveDefaultApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return configured;
  }

  return DEFAULT_API_BASE_PATH;
}

function buildAnalyticsUrl(
  baseUrl: string,
  path: string,
  airportCode: string,
  options: {
    parkingLotId?: number | null;
    days?: number;
    intervalMinutes?: number;
    futureHours?: number;
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
  if (options.futureHours != null) {
    params.set("future_hours", String(options.futureHours));
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
    throw new ApiError(await readErrorMessage(response), response.status);
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
    getHolidaySummary(): Promise<HolidaySummaryResponse> {
      return getJson<HolidaySummaryResponse>(`${baseUrl}/holidays/summary`);
    },
    runCollector(adminToken?: string): Promise<CollectionSummary> {
      return getJson<CollectionSummary>(`${baseUrl}/admin/collect`, {
        method: "POST",
        headers: adminToken ? { "X-Admin-Token": adminToken } : undefined,
      });
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
      options: { parkingLotId?: number | null; days?: number; intervalMinutes?: number; futureHours?: number } = {}
    ): Promise<ParkingTimeSeriesResponse> {
      const { parkingLotId = null, days = 7, intervalMinutes = 30, futureHours = 0 } = options;
      return getJson<ParkingTimeSeriesResponse>(
        buildAnalyticsUrl(baseUrl, "/parking/analytics/timeseries", airportCode, {
          parkingLotId,
          days,
          intervalMinutes,
          futureHours,
        })
      );
    },
    getHolidayPatterns(
      airportCode: string,
      options: { parkingLotId?: number | null; limit?: number } = {}
    ): Promise<HolidayPatternResponse> {
      const params = new URLSearchParams({ airport_code: airportCode });
      if (options.parkingLotId != null) {
        params.set("parking_lot_id", String(options.parkingLotId));
      }
      if (options.limit != null) {
        params.set("limit", String(options.limit));
      }
      return getJson<HolidayPatternResponse>(`${baseUrl}/parking/analytics/holiday-patterns?${params.toString()}`);
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
