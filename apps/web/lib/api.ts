const DEMO_HEADERS: Record<string, string> = {
  "x-breath-demo": "true",
};

/**
 * Production: points to Render API.
 * Dev: uses same hostname + port 3001 so LAN testing works.
 */
const PRODUCTION_API = "https://breathprint.onrender.com";

export function getApiBase(): string {
  // Check env var first (works in dev with .env.local)
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // In the browser on production, use the hardcoded Render URL
  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    if (hostname === "localhost" || hostname.startsWith("192.168") || hostname.startsWith("10.")) {
      return `${window.location.protocol}//${hostname}:3001`;
    }
    return PRODUCTION_API;
  }
  return PRODUCTION_API;
}

/* ── Preview mock layer ──────────────────────────────────
 * When NEXT_PUBLIC_BYPASS_AUTH=1, every API call returns a canned
 * success response with a 400 ms delay to simulate latency. Lets the
 * whole verification flow render end-to-end without a backend.
 * Flip the flag off in .env.local and the real fetch resumes.
 */
const isBypass = () => process.env.NEXT_PUBLIC_BYPASS_AUTH === "1";

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mockFor(path: string): Response {
  if (path.endsWith("/v1/verify/start")) {
    return mockResponse({ sessionId: "preview-" + Math.random().toString(36).slice(2, 18) });
  }
  if (path.endsWith("/v1/verify/geolocation")) {
    return mockResponse({
      allowed: true,
      ipCountry: "Brazil",
      ipRegion: "SP",
      vpnDetected: false,
    });
  }
  if (path.endsWith("/v1/verify/face")) {
    return mockResponse({ passed: true });
  }
  if (path.endsWith("/v1/verify/breath")) {
    return mockResponse({ passed: true });
  }
  if (path.endsWith("/v1/verify/document")) {
    return mockResponse({
      extractedData: {
        name: "PREVIEW SPECIMEN",
        cpf: "000.000.000-00",
        dateOfBirth: "01/01/1990",
        documentNumber: "00 000 000 0",
      },
      ocrEngine: "tesseract",
      ocrConfidence: 92,
      ocrAutoRotateDegrees: 0,
    });
  }
  if (path.endsWith("/v1/verify/document/confirm")) {
    return mockResponse({ ok: true });
  }
  // Default: empty success
  return mockResponse({ ok: true });
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  if (isBypass()) {
    await delay(400);
    return mockFor(path);
  }

  const headers = new Headers(options.headers);
  Object.entries(DEMO_HEADERS).forEach(([k, v]) => headers.set(k, v));

  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });
}

export async function apiPost(path: string, body?: object) {
  if (isBypass()) {
    await delay(400);
    return mockFor(path);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...DEMO_HEADERS,
  };

  return fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPostForm(path: string, formData: FormData) {
  if (isBypass()) {
    await delay(400);
    return mockFor(path);
  }

  const headers: Record<string, string> = {
    ...DEMO_HEADERS,
  };

  return fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });
}
