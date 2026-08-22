import {
  DASHBOARD_SELECTION_COOKIE_KEY,
  readStoredDashboardSelection,
  writeStoredDashboardSelection,
} from "@/lib/dashboard-preferences";

describe("dashboard selection persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = `${DASHBOARD_SELECTION_COOKIE_KEY}=; Max-Age=0; Path=/`;
  });

  test("falls back to a cookie when localStorage throws", () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };

    writeStoredDashboardSelection({ airportCode: "PUS", parkingLotId: 5 }, blockedStorage);

    expect(readStoredDashboardSelection(blockedStorage)).toEqual({ airportCode: "PUS", parkingLotId: 5 });
  });

  test("discards malformed or unsafe parking lot ids", () => {
    const storage = {
      getItem: () => JSON.stringify({ airportCode: "GMP", parkingLotId: -1 }),
      setItem: () => undefined,
    };

    expect(readStoredDashboardSelection(storage)).toEqual({ airportCode: "GMP", parkingLotId: null });
  });
});
