const DASHBOARD_SELECTION_STORAGE_KEY = "parking-radar:dashboard-selection:v1";
const DASHBOARD_SELECTION_COOKIE_KEY = "parking-radar-selection";
const DASHBOARD_SELECTION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type StoredDashboardSelection = {
  airportCode: string;
  parkingLotId: number | null;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function canUseStorage(storage: StorageLike | null | undefined): storage is StorageLike {
  return storage !== null && storage !== undefined;
}

function readSelectionCookie(): StoredDashboardSelection | null {
  if (typeof document === "undefined") {
    return null;
  }

  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${DASHBOARD_SELECTION_COOKIE_KEY}=`));
  if (!cookie) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(cookie.slice(DASHBOARD_SELECTION_COOKIE_KEY.length + 1))) as Partial<StoredDashboardSelection>;
    if (typeof parsed.airportCode !== "string") {
      return null;
    }
    return {
      airportCode: parsed.airportCode,
      parkingLotId: typeof parsed.parkingLotId === "number" ? parsed.parkingLotId : null,
    };
  } catch {
    return null;
  }
}

function writeSelectionCookie(selection: StoredDashboardSelection): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${DASHBOARD_SELECTION_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(selection))}; Max-Age=${DASHBOARD_SELECTION_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export function readStoredDashboardSelection(
  storage: StorageLike | null | undefined = typeof window !== "undefined" ? window.localStorage : null
): StoredDashboardSelection | null {
  if (canUseStorage(storage)) {
    const raw = storage.getItem(DASHBOARD_SELECTION_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredDashboardSelection>;
        if (typeof parsed.airportCode === "string") {
          return {
            airportCode: parsed.airportCode,
            parkingLotId: typeof parsed.parkingLotId === "number" ? parsed.parkingLotId : null,
          };
        }
      } catch {
        // Fall through to the cookie fallback.
      }
    }
  }

  return readSelectionCookie();
}

export function writeStoredDashboardSelection(
  selection: StoredDashboardSelection,
  storage: StorageLike | null | undefined = typeof window !== "undefined" ? window.localStorage : null
): void {
  if (!canUseStorage(storage)) {
    return;
  }

  storage.setItem(DASHBOARD_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  writeSelectionCookie(selection);
}

export { DASHBOARD_SELECTION_COOKIE_KEY, DASHBOARD_SELECTION_STORAGE_KEY };
