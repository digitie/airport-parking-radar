import { NextRequest } from "next/server";

describe("backend proxy route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test("proxies allowed backend requests without storing mobile-stale API responses", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ code: "GMP", name_ko: "Gimpo Airport" }]), {
        headers: {
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://test-backend:8000");

    const { GET } = await import("@/app/api/backend/[...path]/route");
    const request = new NextRequest("https://pr.digitie.mywire.org/api/backend/airports", {
      headers: {
        accept: "application/json",
        host: "pr.digitie.mywire.org",
      },
    });
    const response = await GET(request, { params: Promise.resolve({ path: ["airports"] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0, must-revalidate");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://test-backend:8000/airports",
      expect.objectContaining({
        cache: "no-store",
        method: "GET",
      })
    );
  });
});
