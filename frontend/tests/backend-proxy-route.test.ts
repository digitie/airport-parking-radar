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

  test("returns a stable 502 response when the backend connection fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://test-backend:8000");

    const { GET } = await import("@/app/api/backend/[...path]/route");
    const request = new NextRequest("https://pr.digitie.mywire.org/api/backend/health");
    const response = await GET(request, { params: Promise.resolve({ path: ["health"] }) });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "백엔드에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      code: "backend_unavailable",
    });
  });

  test("aborts a slow backend request and returns 504", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://test-backend:8000");
    vi.stubEnv("BACKEND_PROXY_TIMEOUT_MS", "1000");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
      )
    );

    try {
      const { GET } = await import("@/app/api/backend/[...path]/route");
      const request = new NextRequest("https://pr.digitie.mywire.org/api/backend/health");
      const responsePromise = GET(request, { params: Promise.resolve({ path: ["health"] }) });
      await vi.advanceTimersByTimeAsync(1_000);
      const response = await responsePromise;

      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({
        detail: "백엔드 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
        code: "backend_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
