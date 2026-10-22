# Seyra Map Services — client integration guide (web and mobile)

Status: **contract and examples prepared; LAN endpoint not yet provisioned.** One backend and one asset contract serve both client teams. The values in angle brackets (`<SEYRA_HOST>`, `<PORT>`, the CA file) come from the owner privately once the endpoint is live; this file never contains them.

What is verified, and where:
- **API contract and docs:** the OpenAPI document, Swagger UI behaviour and typed errors are checked by unit/HTTP tests.
- **Ingress and access boundary:** checked with the exact locked proxy image's nginx (`tests/security/test-proxy-boundary.mjs`).
- **Examples:** marked *fixture* when recorded on the synthetic release, *Iran (illustrative)* when they name public landmarks that were not executed for this guide.
- **Not executed yet:**
  - access from Windows or other LAN devices;
  - any mobile SDK, framework or WebView;
  - Persian text rendering outside the hosted web client;
  - load or capacity.

See also: [`MOBILE_INTEGRATION.md`](MOBILE_INTEGRATION.md) (mobile contract detail and recorded fixtures), [`openapi/map-services-v1.json`](openapi/map-services-v1.json), the handoff index [`handoff/README.md`](handoff/README.md).

## 1. Access

- **Base URL:** `https://<SEYRA_HOST>:<PORT>`. All paths below are relative to it. The same origin serves the API, map assets, Swagger and the hosted test client.
- **Network:** only devices in the owner-approved corporate subnet are admitted; other sources get 403, and an unknown `Host` gets 421. This is network access control only: there are no accounts or tokens in phase 1, and Authentication is a separate future module. Do not build a client-side substitute.
- **TLS:** HTTPS only, TLS 1.2+. Trust the issuing CA's **public** certificate supplied by the owner, and never disable certificate or hostname verification. Use the host name or address exactly as printed in the certificate. Trust installation on a device is the owner's decision at handoff; there is a removal procedure, see §8 and §9.
- **No external dependency at run time:** every asset (styles, glyphs, sprites, Swagger UI) comes from the same origin, so clients never need Internet access.

## 2. Inventory

| What | Path | Notes |
| --- | --- | --- |
| Hosted test client | `/` | Reference web client (MapLibre GL JS 6.14.0); same origin |
| Swagger UI | `/api/docs/` | Offline assets; requests run only after **Try it out** then **Execute** |
| OpenAPI 3.0.3 | `/api/docs/json` (also `/api/docs/yaml`) | Identical to `docs/openapi/map-services-v1.json` |
| Liveness | `GET /health/live` (`getLiveness`) | Process only |
| Readiness | `GET /health/ready` (`getReadiness`) | 200 only when all four capabilities serve the active release; otherwise 503 with the same body |
| Health detail | `GET /api/v1/map/health` (`getMapHealth`) | Same document, always 200 |
| Capabilities | `GET /api/v1/map/capabilities` (`getCapabilities`) | Active `dataset_id`, asset paths, routing cells, limits; answers while providers are down |
| Search / autocomplete | `GET /api/v1/map/search`, `/autocomplete` (`searchPlaces`, `autocompletePlaces`) | `q` 1–256 code points, `lang` fa/en, `limit` 1–20, optional `bias_lon`/`bias_lat`, `bbox` |
| Reverse | `GET /api/v1/map/reverse` (`reversePlaces`) | `lon`, `lat`, `radius_m` 1–5000 |
| Route | `POST /api/v1/map/route` (`computeRoute`) | car / pedestrian / motorcycle; time / distance; ordered / optimized |
| Proximity | `POST /api/v1/map/proximity` (`rankProximity`) | Ranks the supplied candidates only (≤ 50) |
| POIs | `GET /api/v1/map/pois` (`queryPois`) | Preset or allowlisted key/value; bbox ≤ 100 km²; ≤ 200 results |
| TileJSON | `/maps/{dataset_id}/tiles.json` | Paths come from `capabilities.map`; never hard-code a dataset id |
| Vector tiles | `/maps/{dataset_id}/tiles/{z}/{x}/{y}.pbf` | z 0–16 (overzoom above); **204** = empty tile outside coverage |
| Styles | `/maps/{dataset_id}/styles/{light\|dark}-{fa\|en}.json` | MapLibre style v8 with absolute URLs for the requesting origin |
| Glyphs, fonts, sprites | `/maps/{dataset_id}/fonts/…`, `/sprites/…` | Referenced by the style; Vazirmatn (OFL, `/licenses/vazirmatn-ofl.txt`) |

**Not available, by design:**
- the providers, the databases and their ports;
- import, activation and admin operations, the CLI, and the hidden diagnostics route (blocked at the ingress);
- CORS grants: cross-origin browser access is not configured;
- Authentication, Relations and SOS, which need their own intake.

## 3. Conventions

- **Coordinates:** WGS84. JSON points are named: `{ "lon": 51.338, "lat": 35.6997 }`. GeoJSON geometry uses `[lon, lat]`. Never send `[lat, lon]`.
- **Units:** distances in metres (`distance_m`), durations in seconds (`duration_s`), areas in km². Durations are static estimates: no live traffic and no departure time.
- **Routes:** optimized visit order is exact only for the modeled pair-cost table; it is not a global road optimum. Unsupported combinations (`/capabilities` → `routing.unsupported`) return 422 `UNSUPPORTED_COMBINATION`.
- **Names:** labels and search results are original OSM text. Render them as plain text, never HTML. `lang` selects the fallback order (`/capabilities` → `label_fallback`).
- **Versions:** `contracts_version`, `limits_version`, `catalog_version` and `search_normalization_version` are in `/capabilities`. The OpenAPI `info.version` is the contracts version.

## 4. Readiness, availability and dataset changes

- **Readiness is not availability.** `/health/ready` is a point-in-time check of all four capabilities. A ready check can be followed by a failing operation, and the docs and capabilities load while a provider is down. Always handle the typed error of each call.
- **Dataset releases change.** Operation results, `/capabilities` and the health/readiness documents carry `dataset_id`, and so do most API error envelopes. Liveness and ingress-generated errors do not.
  - Sending `dataset_id` requires that exact active release; a different active release returns **409 `DATASET_MISMATCH`**. Map asset paths of an inactive release return **404 `DATASET_MISMATCH`**.
  - On either one, reload `/capabilities`, then the style (MapLibre `setStyle`), then retry the request once.

## 5. Errors, timeouts, cancellation and retries

API errors share one envelope: `{ "error": { "code", "message", "request_id", "provider"?, "details"?, "dataset_id"? } }`. Ingress-generated JSON errors (map asset 404s, tile 503, 413) use the same envelope; their `request_id` is the ingress request id, recorded in the proxy access log, and they have no `dataset_id`. 403 (outside the allowlist) and 421 (unknown Host) are not JSON.

| Status | Codes | Client action |
| --- | --- | --- |
| 400 | `INVALID_REQUEST`, `QUERY_TOO_LONG`, `LIMIT_EXCEEDED`, `BBOX_TOO_LARGE`, `UNKNOWN_PRESET` | Fix the request; do not retry |
| 409 | `DATASET_MISMATCH` | Reload capabilities and style, then retry once |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 64 KiB, or a provider answer above its bound; do not retry unchanged |
| 422 | `UNSUPPORTED_COMBINATION`, `NO_ROUTE`, `POINT_NOT_ROUTABLE` | Show the reason; no stop is ever dropped silently |
| 502 | `PROVIDER_ERROR` | Retry later, with bounded backoff |
| 503 | `PROVIDER_UNAVAILABLE`, `PROVIDER_REVISION_MISMATCH`, `MAINTENANCE`, `OVERLOADED` | Bounded backoff; honour `Retry-After` (5 s) |
| 504 | `PROVIDER_TIMEOUT`, `DEADLINE_EXCEEDED` | Do not loop; let the user retry |

- **Client timeouts:** set them slightly above the server deadlines: search, autocomplete and reverse 12 s (server 10 s); POIs 18 s (15 s); route 35 s (30 s); optimized route and proximity 125 s (120 s).
- **Cancellation:** cancel superseded requests, e.g. every autocomplete keystroke, with an `AbortController`. The server stops admitted work when the client disconnects.
- **Retries:** at most 3 attempts with exponential backoff and jitter (about 1 s, 2 s, 4 s), and only for 502, 503 and 504.

## 6. Map rendering

- Load one of the four style URLs from `/capabilities` (`map.styles.light_fa`, …). The style references the TileJSON, glyphs (Vazirmatn) and sprites on the same origin, so a client needs no extra configuration.
- Keep the attribution visible: "© OpenStreetMap contributors (ODbL)", carried by the style and the TileJSON.
- Persian labels:
  - **Hosted web client:** renders them without an RTL text plugin (screenshots in the Iran browser audit).
  - **Other renderers, MapLibre Native and SDK versions:** untested.
  - **Never load a remote RTL plugin or font:** the operational path must stay offline.

## 7. Web developer quickstart

1. **Explore.** Open `https://<SEYRA_HOST>:<PORT>/` (hosted client) and `/api/docs/` (Swagger) from a machine in the approved subnet, with the CA trusted.
2. **Develop locally without CORS.** Run the development proxy from [`examples/web-dev-proxy/`](../examples/web-dev-proxy/README.md) on your machine. It forwards only `/api/` and `/maps/` to the configured Seyra origin and verifies TLS against the Seyra CA. It also rewrites the exact Seyra origin in styles and TileJSON to your page origin, so tiles, glyphs and sprites load through it as well. Point your dev server's proxy for `/api` and `/maps` at it. It listens on loopback only, by design.
3. **Alternative without body rewriting.** Leave the style untouched and rewrite exactly the Seyra origin in MapLibre's `transformRequest`:

   ```ts
   const SEYRA_ORIGIN = 'https://<SEYRA_HOST>:<PORT>'; // from configuration, exact
   const map = new maplibregl.Map({
     container: 'map',
     style: `/maps/${datasetId}/styles/light-fa.json`, // served through your dev proxy
     transformRequest: (url) =>
       url.startsWith(`${SEYRA_ORIGIN}/maps/`) ? { url: window.location.origin + url.slice(SEYRA_ORIGIN.length) } : undefined,
   });
   ```

   Compare against `${SEYRA_ORIGIN}/maps/` including the trailing path, so a look-alike host never matches.
4. **Production hosting of your web app** is a separate decision. Either it is served from the Seyra origin, or exact browser origins are granted later with correct preflight and cache variation. No wildcard or reflected CORS will be added.

TypeScript fetch helpers (illustrative, not executed against the LAN endpoint):

```ts
type SeyraError = { error: { code: string; message: string; request_id: string; dataset_id?: string } };

async function seyra<T>(path: string, init: RequestInit & { timeoutMs: number }, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(init.timeoutMs);
  const res = await fetch(path, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error((body as SeyraError).error?.code ?? `HTTP ${res.status}`), { status: res.status, body });
  return body as T;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (attempt >= 2 || ![502, 503, 504].includes(status)) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 250));
    }
  }
}

// Named lon/lat; metres and seconds in the response.
const caps = await seyra<{ dataset_id: string; map: { styles: Record<string, string> } }>('/api/v1/map/capabilities', { timeoutMs: 10_000 });
const ctrl = new AbortController(); // abort on the next keystroke
const hits = await seyra(`/api/v1/map/autocomplete?${new URLSearchParams({ q: 'برج آز', lang: 'fa', limit: '5' })}`, { timeoutMs: 12_000 }, ctrl.signal);
const route = await withRetry(() =>
  seyra('/api/v1/map/route', { method: 'POST', timeoutMs: 35_000, body: JSON.stringify({ profile: 'car', objective: 'time', points: [{ id: 'azadi', lon: 51.3380605, lat: 35.6997384 }, { id: 'milad', lon: 51.3753, lat: 35.7448 }], dataset_id: caps.dataset_id }) }),
);
```

## 8. Mobile developer quickstart (generic; platform not yet chosen)

- **Native HTTP clients** (the platform's HTTP stack) are not subject to CORS or browser origins. Use the same base URL and paths, and set timeouts, cancellation and retries as in §5.
- **CA trust:** trust the Seyra issuer explicitly in the app's network-security configuration, or pin the CA public key, rather than relying on a device-wide user CA.
  - On recent Android versions, apps do not trust user-installed CAs by default.
  - On Apple platforms, a user-installed root needs full trust, and server certificates must meet Apple's rules: SAN present, serverAuth, at most 825 days. The server's import tool refuses longer certificates.
  - These platform statements are guidance only; no SDK was built or executed.
- **WebView or hybrid shells are browser contexts.** Same-origin rules and CORS apply. Load content from the Seyra origin, or keep API calls on the native side. `file://` and `null` origins will never be granted.
- **Map rendering:** give the renderer the style URL from `/capabilities`. The style's absolute URLs are generated for the origin that requested it, so request it from the same base URL the app uses. MapLibre Native rendering of these styles, glyph handling and Persian shaping are **untested**.
- **Dataset changes:** handle 409/404 `DATASET_MISMATCH` as in §4, and refresh cached styles when `dataset_id` changes.

## 9. Windows command-line checks (PowerShell, `curl.exe`)

These run from a machine in the approved subnet once the endpoint exists. They have **not been executed** yet; the first owner check (H-01) will confirm them, including how the Windows TLS stack treats the private CA.

```powershell
curl.exe --cacert .\seyra-ca.crt "https://<SEYRA_HOST>:<PORT>/health/ready"
curl.exe --cacert .\seyra-ca.crt "https://<SEYRA_HOST>:<PORT>/api/v1/map/capabilities"
curl.exe --cacert .\seyra-ca.crt -G "https://<SEYRA_HOST>:<PORT>/api/v1/map/search" --data-urlencode "q=برج آزادی" --data-urlencode "lang=fa" --data-urlencode "limit=5"
curl.exe --cacert .\seyra-ca.crt -X POST -H "content-type: application/json" "https://<SEYRA_HOST>:<PORT>/api/v1/map/route" --data-raw '{\"profile\":\"car\",\"objective\":\"time\",\"points\":[{\"id\":\"a\",\"lon\":51.3380605,\"lat\":35.6997384},{\"id\":\"b\",\"lon\":51.3753,\"lat\":35.7448}]}'
```

Never use `-k`/`--insecure`. If system-wide trust is chosen instead of `--cacert`, the owner provides the trust and removal steps.

## 10. Example data

- **Synthetic fixture** (fictional objects near 0°E 0°N): the recorded request/response pairs in [`mobile-fixtures/`](mobile-fixtures/README.md) and the Swagger `fixture_*` examples.
- **Iran snapshot** (illustrative): public landmarks such as Azadi Tower (51.3380605, 35.6997384) and Milad Tower (51.3753, 35.7448).
  - Persian search regression seeds live in [`tests/validation/search-seeds.json`](../tests/validation/search-seeds.json). Their current measurement state is recorded per case; several are explicitly pending.
  - The Iran examples are not a relevance or completeness promise.
