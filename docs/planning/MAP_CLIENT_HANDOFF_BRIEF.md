# Seyra Map Services: client handoff, Swagger and owner validation

Version: **0.1 — REQUIREMENTS/ARCHITECTURE REVIEW DRAFT**
Date: 2026-10-19
Baseline: `d63f1d9310c4a3c51abee3dde832eb36e51b267f`, `feat/map-services-v1`, PR #1 draft.

This is an extension of the current Map Services phase, not intake for Authentication, Relations, SOS or mobile implementation. The owner's workflow is requirements → study/design → Claude Code reads a brief and gives feedback → stabilize the brief → issue a separate English implementation prompt. The present task is the brief review, not implementation or deployment.

## 1. New confirmed requirements [C]

- **C-H1:** The owner will initially test the web client from their Windows computer.
- **C-H2:** The client technical lead needs access to the map services for client development. Sharing the existing web test client with them is useful. Prepare the handoff; do not contact/send messages or invitations to that person.
- **C-H3:** Provide Swagger so the technical lead can discover supported features. The proposed delivery is an interactive local Swagger UI, described below.
- **C-H4:** Target concurrent users remain unknown. Measure/characterize capacity; do not invent a production user count, SLA or pass threshold.
- **C-H5:** The owner delegates selection of real Persian search examples to us. Select and record reproducible engineering fixtures; do not pretend this is a general completeness/relevance guarantee.
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

### 3.2 Access from Windows and for the technical lead

Two distinct delivery needs must be covered: owner browsing and a usable private API endpoint for the technical lead. Network specifics below are unresolved, so do not activate LAN bindings or invent an allowlist.

- Inspect the actual VM/Docker namespace topology first. Present a verified private access design: a stable internal endpoint (or a tested private forwarding method), hostnames/IPs, certificate SANs, public CA certificate and approved clients. Preserve provider/database isolation and existing fail-closed access checks.
- Keep the original PBF and the preserved Iran validation host intact. Adding Swagger or access may require different images/maintenance; describe the exact cutover/resource plan before touching the preserved host. Do not restart/recreate it or run another full stack beside it merely to create a demo URL.
- One HTTPS ingress should serve the web test client, API, Swagger and map assets. Do not expose Tegola/Valhalla/Photon/Overpass/PostgreSQL directly. No public Internet publication, wildcard LAN access or disabled certificate checks.
- Give Windows browser/CA trust and CLI setup steps verified against the selected endpoint. Share the **public CA certificate only**, never private keys, passwords or broad administrative access. Avoid requiring the technical lead to be a Docker administrator just to call map APIs.
- If the technical lead's web client uses another origin, use a documented exact-origin CORS policy (or a same-origin development proxy) after origins are supplied. Browser API calls and `/maps/` assets must both work. No reflection/wildcard, no `null` origin grant, no credentials/cookies introduced before Auth intake. If CORS is implemented, explicitly handle JSON POST preflight, error responses, necessary exposed headers and Origin/cache variation in one coherent boundary. Native clients do not obtain identity from CORS; network access remains the boundary.
- Actual private endpoint/client configuration should stay in operator configuration, not be hardcoded into public source/examples. Provide sanitized templates in Git.

### 3.3 Client handoff pack

Prepare `docs/CLIENT_INTEGRATION.md` (or a clearly named equivalent) and a small handoff index containing:

- actual provisioned API/web/Swagger/spec links once verified, and private access prerequisites;
- a quickstart: trust CA → readiness → capabilities → load a light/dark fa/en style → search → route/proximity/POI;
- copyable PowerShell `curl.exe` and TypeScript fetch examples with named lon/lat, metres/seconds, timeouts/cancellation and backoff;
- schema/TypeScript contract version, dataset changes/409 handling, provider overload/outage handling and limits;
- examples from the synthetic fixture clearly distinguished from the current Iran snapshot; no success claimed for unexecuted examples;
- MapLibre style/font/attribution guidance and the current untested mobile SDK boundary;
- public API/asset inventory and explicit exclusions. Future Auth/Relations/SOS require separate intake.

No messages or credentials are sent to the technical lead by this task. The owner receives the prepared handoff.

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

## 4. Open deployment inputs [U]

These block activation/configuration of shared access, not the brief review or offline Swagger development:

1. Is the technical lead on the same reachable private LAN as the VM, or do they need an existing private tunnel/VPN arrangement? Owner/lead client IPs or explicitly approved narrow CIDRs are needed. Discover the VM address read-only and keep actual addresses in operator-local configuration; do not infer deployment settings from old transfer logs.
2. Will their web client run at a separate browser origin? Obtain exact scheme/host/port origins, or choose a documented same-origin development proxy. Do not assume a development port or allow all localhost ports.
3. Confirm the final endpoint name/IP/certificate trust and an activation/resource window after the read-only topology preflight. User count and performance targets are still unknown; characterize rather than fabricate them.

## 5. Acceptance proposal

- **H-01:** A private Windows client loads web/Swagger/spec and runs representative GET/POST examples over trusted HTTPS, using the provided endpoint. Record manual owner steps separately from headless tests.
- **H-02:** All Swagger assets/spec/Try-it-out requests stay internal; no online validator/CDN/remote config/RTL plugin. Wrong-origin/spec override attempts do not change the intended target. Spec downloads and runtime schema agree.
- **H-03:** Swagger shows meaningful supported operations, bodies, response shapes, errors and asset guidance; invalid/unsupported API requests still fail honestly. Docs loading does not imply providers are ready.
- **H-04:** Shared access fails closed without the operator's allowlist/certificate settings; only the approved HTTPS ingress is reachable. Providers/DB/admin remain private. Approved and unapproved client/origin cases are tested appropriately.
- **H-05:** Client examples/selected search fixtures are run against their declared data; scripts check actual navigation and preserve failed runs. Exact-target/normalization expectations are measured, not asserted without results.
- **H-06:** No raw PBF/store changes or heavy load/restarts of the preserved host. Updated images/bundle are verified offline and only affected components are relocked; map-data identities stay unchanged unless an explicit data-path change is reviewed. No full Iran reimport merely for docs.
- **H-07:** Handoff files, remaining mobile/quality/load constraints and the accurate draft PR description are up to date. No merge/main change or new module implementation.

## 6. Study references and remaining verification

Inspected baseline files: `apps/api/src/app.ts`, `apps/api/src/openapi.ts`, `apps/api/package.json`, `docs/openapi/map-services-v1.json`, `infra/images/proxy/nginx.conf.template`, `infra/images/proxy/security-headers.conf`, `docs/MOBILE_INTEGRATION.md` and current phase-1 documents.

Official upstream documentation checked on 2026-10-19 (not a release pin):

- https://github.com/fastify/fastify-swagger-ui — compatibility table lists Swagger UI plugin 5.x with Fastify 5.x and swagger 9.x; describes local static assets, prefix/CSP behavior and disabled-by-default online validator in this plugin.
- https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/ — documents UI configuration precedence, query overrides, validator settings and user-triggered request behavior. Explicitly disable online validation despite library-default differences.
- https://github.com/fastify/fastify-cors — exact origin/preflight configuration reference if a browser cross-origin path is actually required. Library selection and policy placement are still review decisions.

Claude must validate behavior against the exact selected releases and the built proxy/UI. Reading upstream main docs is not evidence that the final offline deployment/browser path works.
