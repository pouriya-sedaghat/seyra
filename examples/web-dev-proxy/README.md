# Seyra web development proxy (example)

For the web client developer, while the browser origin of the app is not fixed. A dependency-free Node script (Node ≥ 20) that makes the Seyra ingress look same-origin to a page served by a local dev server. Seyra itself grants no CORS, and none is needed.

```
browser ──> your dev server (e.g. http://localhost:<dev-port>)
              ├─ your app files
              └─ /api/*, /maps/*  ──>  seyra-dev-proxy (127.0.0.1:<port>)  ══TLS, verified══>  https://<SEYRA_HOST>:<PORT>
```

## What it does, and refuses

- Forwards **only** `/api/` and `/maps/` (GET/HEAD; POST for `/api/`) to **one** configured Seyra origin, verifying the server certificate against the Seyra CA file. Verification cannot be turned off.
- Rewrites exactly `https://<SEYRA_HOST>:<PORT>/` to your page origin inside TileJSON and the four style documents. Tile, glyph, font and sprite URLs then load through the proxy as well. Look-alike hosts are not touched.
- Listens on **loopback only**. A proxy reachable by other machines would extend Seyra beyond the approved subnet.
- Accepts only the expected `Host` headers (the listen address and your page origin), as DNS-rebinding protection.
- Refuses:
  - absolute-form, protocol-relative and `CONNECT` targets (it is not a general proxy);
  - dot segments;
  - any other path.
- Never forwards cookies, `Authorization`, `Origin`/`Referer`, `X-Forwarded-*`, `Forwarded` or `X-Real-IP`, and never uses a client `Host` to build URLs.
- Propagates cancellation: closing the browser request aborts the upstream request.

Tested by `node tests/client/test-dev-proxy.mjs` against a local HTTPS stand-in for the Seyra ingress. It has **not** been run against the LAN endpoint or with a particular dev server yet.

## Use

1. Get from the owner the Seyra origin and the **public** CA certificate file.
2. Copy `dev-proxy.example.json` to a private location and fill it in. No port is assumed; choose free local ports.
3. `node seyra-dev-proxy.mjs --config <your dev-proxy.json>`
4. Configure your dev server to proxy `/api` and `/maps` to `http://127.0.0.1:<port>` and keep the original Host header. Example for Vite (untested sketch):

   ```ts
   server: { proxy: { '/api': { target: 'http://127.0.0.1:<port>', changeOrigin: false }, '/maps': { target: 'http://127.0.0.1:<port>', changeOrigin: false } } }
   ```

5. In the app, use relative paths: `/api/v1/map/capabilities`, then the style path from `map.styles.*`.

Readiness: `/health/ready` is outside `/api/` and is not forwarded. Use `GET /api/v1/map/health` (always 200, with per-provider status) from the app.
