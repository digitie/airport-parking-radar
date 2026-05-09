const SEOUL_TIME_ZONE = "Asia/Seoul";
const ISO_WITH_TIME_ZONE = /(Z|[+-]\d{2}:\d{2})$/i;

function normalizeApiDate(value: string): string {
  const trimmed = value.trim();
  if (ISO_WITH_TIME_ZONE.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}Z`;
}

export function parseApiDate(value: string): Date {
  return new Date(normalizeApiDate(value));
}

export function formatDateTime(value: string): string {
  const { month, day, hour, minute } = getSeoulDateParts(value);
  return `${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDateTimeWithZone(value: string): string {
  return `${formatDateTime(value)} KST`;
}

export function getSeoulDateParts(value: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: SEOUL_TIME_ZONE,
  });
  const parts = formatter.formatToParts(parseApiDate(value));
  const partMap = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(partMap.get("year") ?? "0"),
    month: Number(partMap.get("month") ?? "0"),
    day: Number(partMap.get("day") ?? "0"),
    hour: Number(partMap.get("hour") ?? "0"),
    minute: Number(partMap.get("minute") ?? "0"),
  };
}

export function formatSeoulDateKey(value: string): string {
  const { year, month, day } = getSeoulDateParts(value);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatDayLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    timeZone: SEOUL_TIME_ZONE,
  }).format(parseApiDate(value));
}

export function formatAxisDateLabel(value: string): string {
  const { month, day } = getSeoulDateParts(value);
  return `${month}.${day}`;
}

export function formatAxisTimeLabel(value: string): string {
  const { hour, minute } = getSeoulDateParts(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatMinutesOfDay(value: number | null): string {
  if (value === null) {
    return "-";
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatCurrency(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}
