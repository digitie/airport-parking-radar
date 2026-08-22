import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

const BACKEND_INTERNAL_URL = (process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000").replace(/\/$/, "");
const FORWARDED_REQUEST_HEADERS = new Set(["accept", "content-type"]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-length",
  "content-type",
  "expires",
  "pragma",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
]);

function isAllowedBackendRequest(path: string, method: string): boolean {
  if ((path === "health" || path === "airports") && method === "GET") {
    return true;
  }
  if (path.startsWith("parking/") && method === "GET") {
    return true;
  }
  if (path.startsWith("holidays/") && method === "GET") {
    return true;
  }
  if (path === "flights/status" && method === "GET") {
    return true;
  }
  if (path === "fees/calculate" && method === "POST") {
    return true;
  }
  if (path === "admin/collector-status" && method === "GET") {
    return true;
  }
  if ((path === "dashboard/bootstrap" || path === "dashboard/analytics") && method === "GET") {
    return true;
  }
  if (path === "admin/backups" && (method === "GET" || method === "POST")) {
    return true;
  }
  if (path === "admin/backups/restore" && method === "POST") {
    return true;
  }
  if (/^admin\/backups\/[^/]+$/.test(path) && method === "GET") {
    return true;
  }
  if (path === "admin/collect" && method === "POST") {
    return true;
  }
  return false;
}

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  headers.set("x-forwarded-host", request.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", ""));
  return headers;
}

function buildResponseHeaders(upstreamResponse: Response): Headers {
  const headers = new Headers();

  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (FORWARDED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  headers.set("cache-control", "no-store, max-age=0, must-revalidate");
  return headers;
}

async function proxyToBackend(request: NextRequest, context: RouteContext): Promise<Response> {
  const params = await context.params;
  const backendPath = (params.path ?? []).join("/");
  const method = request.method.toUpperCase();

  if (!isAllowedBackendRequest(backendPath, method)) {
    return Response.json({ detail: "Not found" }, { status: 404 });
  }

  const targetUrl = `${BACKEND_INTERNAL_URL}/${backendPath}${request.nextUrl.search}`;
  const upstreamResponse = await fetch(targetUrl, {
    method,
    headers: buildForwardHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
    redirect: "manual",
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildResponseHeaders(upstreamResponse),
  });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, context);
}
