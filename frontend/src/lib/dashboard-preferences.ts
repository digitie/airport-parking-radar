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

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function normalizeSelection(parsed: Partial<StoredDashboardSelection>): StoredDashboardSelection | null {
  const airportCode = typeof parsed.airportCode === "string" ? parsed.airportCode.trim() : "";
  const parkingLotId = parsed.parkingLotId;
  if (!airportCode) {
    return null;
  }

  return {
    airportCode,
    parkingLotId:
      typeof parkingLotId === "number" && Number.isSafeInteger(parkingLotId) && parkingLotId > 0 ? parkingLotId : null,
  };
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
    return normalizeSelection(parsed);
  } catch {
    return null;
  }
}

function writeSelectionCookie(selection: StoredDashboardSelection): void {
  if (typeof document === "undefined") {
    return;
  }
  try {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${DASHBOARD_SELECTION_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(selection))}; Max-Age=${DASHBOARD_SELECTION_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookie writes can be blocked by browser privacy settings.
  }
}

export function readStoredDashboardSelection(
  storage: StorageLike | null | undefined = getDefaultStorage()
): StoredDashboardSelection | null {
  if (canUseStorage(storage)) {
    try {
      const raw = storage.getItem(DASHBOARD_SELECTION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredDashboardSelection>;
        const selection = normalizeSelection(parsed);
        if (selection) {
          return selection;
        }
      }
    } catch {
      // Fall through to the cookie fallback.
    }
  }

  return readSelectionCookie();
}

export function writeStoredDashboardSelection(
  selection: StoredDashboardSelection,
  storage: StorageLike | null | undefined = getDefaultStorage()
): void {
  if (canUseStorage(storage)) {
    try {
      storage.setItem(DASHBOARD_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // Always continue to the cookie fallback when localStorage is unavailable.
    }
  }

  writeSelectionCookie(selection);
}

export { DASHBOARD_SELECTION_COOKIE_KEY, DASHBOARD_SELECTION_STORAGE_KEY };
