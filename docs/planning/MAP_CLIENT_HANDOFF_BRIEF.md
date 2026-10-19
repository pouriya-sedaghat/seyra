# Seyra Map Services: client handoff, Swagger and owner validation

Version: **0.2 — REQUIREMENTS/ARCHITECTURE REVIEW DRAFT**
Date: 2026-10-19
Baseline: `d63f1d9310c4a3c51abee3dde832eb36e51b267f`, `feat/map-services-v1`, PR #1 draft.

This is an extension of the current Map Services phase, not intake for Authentication, Relations, SOS or mobile implementation. The owner's workflow is requirements → study/design → Claude Code reads a brief and gives feedback → stabilize the brief → issue a separate English implementation prompt. The present task is the brief review, not implementation or deployment.

## 1. New confirmed requirements [C]

- **C-H1:** The owner will initially test the web client from their Windows computer.
- **C-H2:** Two different developers are building web and mobile clients in parallel. Both need the same map API/asset contracts. Prepare separate web/mobile quickstarts and shared test-client/Swagger access; do not contact or send messages to either developer.
- **C-H3:** Provide Swagger so the technical lead can discover supported features. The proposed delivery is an interactive local Swagger UI, described below.
- **C-H4:** Target concurrent users remain unknown. Measure/characterize capacity; do not invent a production user count, SLA or pass threshold.
- **C-H5:** The owner delegates selection of real Persian search examples to us. Select and record reproducible engineering fixtures; do not pretend this is a general completeness/relevance guarantee.
- **C-H6:** The VM's hypervisor network adapter is bridged onto the corporate private LAN and reachable by company devices. This is not Docker host networking and does not authorize exposing provider ports.
- **C-H7:** The owner has approved one corporate IPv4 subnet, provided in private session instructions as `APPROVED_CLIENT_CIDR`. Keep it in operator-local configuration and use placeholders in public templates. This allowlist choice is resolved; do not ask again or broaden it to other private ranges.
- All existing constraints remain: Node/TypeScript, PostgreSQL/PostGIS, all four map capabilities mandatory, online preparation allowed, zero external operational dependency, private providers, HTTPS, exact image/package identities, English Claude prompts and feature-branch work.

## 2. Inspected baseline [V]

At the exact baseline above:

- `apps/api/package.json` pins Fastify 5.12.7 and `@fastify/swagger` 9.9.2; no Swagger UI dependency is registered in `apps/api/src/app.ts`.
- `apps/api/src/openapi.ts` generates `docs/openapi/map-services-v1.json` from the registered route schemas. That file contains ten JSON API/health operations. It is an exported artifact; there is no dedicated served OpenAPI JSON/UI route in the inspected app.
- The schema has `servers: [{ url: '/' }]`, which is a useful same-origin base. Several operations lack summaries, and capabilities has no documented response shape. Review completeness without changing existing API behavior accidentally.
- Nginx forwards `/api/` to the API, serves dataset-scoped `/maps/` assets itself, applies the common TLS/access boundary and a restrictive CSP. Unknown non-API frontend paths can fall back to the SPA. Documentation paths/assets must be deliberately routed and tested rather than relying on that fallback.
- `docs/MOBILE_INTEGRATION.md` already documents endpoints, units, static routing semantics, TLS, asset discovery and fixture samples; actual mobile SDK execution remains untested. A client handoff guide should reuse it and explicitly cover web development too.
- Existing validation harnesses support nested Docker daemons. Inspect the actual serving path before assuming its proxy loopback is the VM's own loopback; do not publish an untested forwarding recipe.
- Shared-resource contention is a documented validation concern. Stable container IDs/uptime do not prove stable service quality. Operator-specific topology/resources stay in local preflight output.

## 3. Proposed deliverables [P]

### 3.1 Swagger and contract

- Serve Swagger UI at **`/api/docs/`**, with a canonical runtime JSON specification at **`/api/docs/json`**, unless the review identifies a concrete routing issue. Those are proposed new paths, not existing URLs to give the owner today.
- Prefer the official `@fastify/swagger-ui` plugin compatible with the pinned Fastify/swagger major versions. Pin and verify the exact release and transitive assets during implementation; no unverified version number is prescribed here.
- Generate the checked-in/exported specification and runtime specification from one contract source. Keep JSON request/response validation behavior stable. Add useful summaries, unique operation IDs, query/body/response/error descriptions and bounded examples; document missing capability-response schema.
- Cover forward search, autocomplete, reverse, all supported routing/profile/objective/order combinations, proximity metrics/directions, bounded POI queries, capabilities and health. Keep unsupported combinations and uncertainty visible; no exact-road/time guarantee or live traffic.
- Document TileJSON, styles, vector tiles, fonts and sprites with their dataset-scoped paths, coordinate order, response types, empty tiles and version mismatch behavior. These are proxy-served assets: do not invent API handlers or change provider exposure just to add documentation. Decide whether to include their OpenAPI paths or link a clear asset-contract section, with checks against the real proxy.
- Enable user-triggered **Try it out** for the supported read/query operations (including POST route/proximity) against the current ingress origin. No automatic heavy queries on page load. No provider/admin/CLI import actions in Swagger.
- Ship all JS/CSS/fonts/spec assets locally in the offline bundle/images. Disable online validation explicitly, remote spec/config selection and query-string configuration overrides. Do not include active Petstore/CDN/telemetry calls or OAuth discovery. Relative same-origin server paths must work through the tested LAN/tunnel URL.
- Keep CSP deliberate and tested; avoid globally weakening it for the docs. Verify redirects, trailing slash, local initializer/static assets and HTTPS host/port handling. A docs page should remain useful during a provider outage while Try it out shows real typed errors.

### 3.2 Corporate LAN access for Windows, web and mobile development

LAN access and the approved client subnet are confirmed. Derive the actual VM endpoint and safe serving path read-only; do not activate it during the review-only turn.

- Inspect the VM/Docker namespaces and derive a LAN endpoint using the observed VM address or an existing internal name, with matching certificate SANs and public CA trust. Do not assume internal DNS exists. Preserve private providers/DBs and fail-closed checks.
- Keep the original PBF and the preserved Iran validation host intact. Adding Swagger or access may require different images/maintenance; describe the exact cutover/resource plan before touching the preserved host. Do not restart/recreate it or run another full stack beside it merely to create a demo URL.
- One HTTPS ingress serves the test client, API, Swagger and assets for both developers. Enforce the exact approved subnet and deny other sources. No direct provider/DB ports, broader subnet grant, public publication or disabled TLS checks.
- Verify the client address visible through the real Docker/forwarding path. Trust forwarded-client headers only from explicit trusted hops; test spoofed headers. Do not widen the approved subnet to Docker bridge ranges to make tests pass.
- Give Windows browser/CA trust and CLI setup steps verified against the selected endpoint. Share the **public CA certificate only**, never private keys, passwords or broad administrative access. Avoid requiring the technical lead to be a Docker administrator just to call map APIs.
- **Initial web design [P]:** a documented development proxy while the exact browser origin is unknown. Cover `/api/` and `/maps/`, verified upstream TLS, absolute URLs in styles/TileJSON, and glyph/font/sprite/tile requests. Proxying the API alone may leave assets cross-origin. Do not guess a port, disable browser security or use insecure upstream certificate bypasses.
- If direct browser cross-origin use is needed later, grant only supplied exact scheme/host/port origins, with correct preflight/errors/exposed headers/cache variation. A subnet is not a browser origin; CORS is not authentication. No wildcard/reflection, `null` origin grant or new cookies/credentials. Hosted Swagger/test-client same-origin use needs no permissive CORS policy.
- **Mobile design [P]:** the same LAN API/style base and contracts, with platform-appropriate CA trust, timeouts/cancellation/backoff and dataset handling. Distinguish native HTTP from WebView/hybrid browser contexts. Do not assume a platform/framework, build a mobile app, or claim SDK/Persian-rendering tests were executed. Missing SDK details do not block backend/docs work.
- Actual private endpoint/client configuration should stay in operator configuration, not be hardcoded into public source/examples. Provide sanitized templates in Git.

### 3.3 Client handoff pack

Prepare `docs/CLIENT_INTEGRATION.md` (or a clearly named equivalent) and a small handoff index containing:

- one common API/asset contract and separate web/mobile quickstarts for the two developers, without divergent backends or an unrequested account/role system;
- actual provisioned API/web/Swagger/spec links once verified, and private access prerequisites;
- a quickstart: trust CA → readiness → capabilities → load a light/dark fa/en style → search → route/proximity/POI;
- copyable PowerShell `curl.exe` and TypeScript fetch examples with named lon/lat, metres/seconds, timeouts/cancellation and backoff;
- schema/TypeScript contract version, dataset changes/409 handling, provider overload/outage handling and limits;
- examples from the synthetic fixture clearly distinguished from the current Iran snapshot; no success claimed for unexecuted examples;
- MapLibre style/font/attribution guidance and the current untested mobile SDK boundary;
- public API/asset inventory and explicit exclusions. Future Auth/Relations/SOS require separate intake.

No messages or credentials are sent to either developer by this task. The owner receives the prepared handoff.

### 3.4 Selected Persian search seeds

`MAP_CLIENT_HANDOFF_SEARCH_SEEDS.json` records five proposed regression cases and reference feature locations from the existing successful Iran browser report:

| Query | Expected place | Baseline feature |
| --- | --- | --- |
| برج آزادی | Tehran, Azadi Tower | `osm:r7814369` |
| میدان نقش جهان | Isfahan, Naqsh-e Jahan | `osm:r15540548` |
| شیراز | Shiraz city, Fars | `osm:r8167754` |
| بازرگان | Bazargan, West Azerbaijan | `osm:n244176127` |
| ابیانه | Abyaneh village, Isfahan | `osm:n27369333` |

Bind these fixtures to the active Iran dataset and owner-input checksum in local validation output. Do not publish those operational identifiers in this planning template.

Suggested initial engineering assertion: expected feature in top 5, with identity/location checked, plus Persian/Arabic-letter variants and independent successful navigation. Verify before declaring PASS; the baseline observed the Shiraz feature via an English query, so its new Persian query is not already demonstrated by that browser report. Do not use province text alone, force rank 1, silently alter test inputs until they pass, or claim exact-address coverage where source data lacks it.

### 3.5 Capacity characterization

- Start by specifying workload and resources, not an invented supported-user number. Report per-operation percentiles, throughput, errors/timeouts, CPU, available RAM, swap, disk and readiness, with dataset/image/harness identity.
- Proposed staged concurrency **1 → 2 → 5**, with 10 considered only if measured resource headroom permits. Label these concurrent simulated clients/requests precisely; a browser creates many requests per user.
- Separate ordinary map browsing/cold versus warm tiles, search/reverse, two-point routes, optimized routes and POI queries. Heavy optimized/proximity requests are separate scenarios, not an uncontrolled pile-on.
- Each stage has a bounded duration, explicit stop thresholds and cooldown. Stop rather than weakening timeouts/readiness or hiding errors. Prepare the plan/harness first.
- Do not run load tests against the preserved host or alongside it on the same constrained VM. Full measurement needs separate resource capacity or an explicit owner-agreed maintenance/test window with a concrete restoration plan. Until then, record it as pending; Swagger/docs and fixture verification can progress.
- The original unexplained readiness 503 stays open. New workload-induced errors must be retained separately. No SLA or production capacity assertion from a short experiment.

## 4. Resolved choices and remaining deployment details

Resolved: corporate bridged-LAN access, approved subnet in private session input, two client developers, common contracts, Swagger, delegated fixture selection and unknown production concurrency. Do not repeat those intake questions.

1. Discover the current endpoint/namespaces/ports and certificate/trust plan read-only; keep operator values local. Absence of the actual CIDR from Git is deliberate, not missing authorization.
2. Exact web origin and mobile SDK remain unspecified. Use the initial proxy design and generic mobile contract; ask framework/origin details only when they materially affect a concrete integration step. Do not block shared backend/docs for them.
3. Determine activation/resource impact and any maintenance window for the preserved host. This review-only turn authorizes no restart or heavy load. User count/SLA remain unknown.

## 5. Acceptance proposal

- **H-01:** A private Windows client loads web/Swagger/spec and runs representative GET/POST examples over trusted HTTPS, using the provided endpoint. Record manual owner steps separately from headless tests.
- **H-02:** All Swagger assets/spec/Try-it-out requests stay internal; no online validator/CDN/remote config/RTL plugin. Wrong-origin/spec override attempts do not change the intended target. Spec downloads and runtime schema agree.
- **H-03:** Swagger shows meaningful supported operations, bodies, response shapes, errors and asset guidance; invalid/unsupported API requests still fail honestly. Docs loading does not imply providers are ready.
- **H-04:** The exact privately supplied subnet is enforced at the verified HTTPS ingress; other sources are denied and providers/DB/admin remain private. Test client-address/forwarder trust and web-proxy/mobile-style HTTP requests over trusted TLS. Any direct CORS grants use exact browser origins.
- **H-05:** Client examples/selected search fixtures are run against their declared data; scripts check actual navigation and preserve failed runs. Exact-target/normalization expectations are measured, not asserted without results.
- **H-06:** No raw PBF/store changes or heavy load/restarts of the preserved host. Updated images/bundle are verified offline and only affected components are relocked; map-data identities stay unchanged unless an explicit data-path change is reviewed. No full Iran reimport merely for docs.
- **H-07:** Handoff files, remaining mobile/quality/load constraints and the accurate draft PR description are up to date. No merge/main change or new module implementation.

## 6. Study references and remaining verification

Inspected baseline files: `apps/api/src/app.ts`, `apps/api/src/openapi.ts`, `apps/api/package.json`, `docs/openapi/map-services-v1.json`, `infra/images/proxy/nginx.conf.template`, `infra/images/proxy/security-headers.conf`, `docs/MOBILE_INTEGRATION.md` and current phase-1 documents.

Official upstream documentation checked on 2026-10-19 (not a release pin):

- https://github.com/fastify/fastify-swagger-ui — compatibility table lists Swagger UI plugin 5.x with Fastify 5.x and swagger 9.x; describes local static assets, prefix/CSP behavior and disabled-by-default online validator in this plugin.
- https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/ — documents UI configuration precedence, query overrides, validator settings and user-triggered request behavior. Explicitly disable online validation despite library-default differences.
- https://github.com/fastify/fastify-cors — exact origin/preflight configuration reference if a browser cross-origin path is actually required. Library selection and policy placement are still review decisions.
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS — browser origin/preflight behavior; an IP-subnet allowlist does not replace browser origin policy.

Claude must validate behavior against the exact selected releases and the built proxy/UI. Reading upstream main docs is not evidence that the final offline deployment/browser path works.
