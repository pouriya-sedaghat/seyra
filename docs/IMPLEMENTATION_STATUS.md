# Seyra Map Services — implementation status (phase 1)

Date: 2026-10-14. Branch: `feat/map-services-v1`, based on documentation commit `a3460fcb2fed0340796f216fc9081d7e1b132fe3` (document version 1.0). Test evidence: `docs/TEST_RESULTS.md`.

**Overall:** the engineering scope is implemented and verified with real providers on a **synthetic fixture** in a **cloud preparation container**. It is **not production-validated**: there has been no Iran dataset, customer hardware, mobile execution or load test. Do not treat this as production readiness.

## Scope delivered

| Area | State | Where |
| --- | --- | --- |
| Contracts (schemas, limits, errors, support table, normalization `fa-search-norm-1`, POI catalog) | Done | `packages/contracts` |
| Gateway API (Fastify 5): capabilities, search, autocomplete, reverse, route, proximity, POIs, health/readiness, diagnostics, OpenAPI | Done | `apps/api`, `docs/openapi/map-services-v1.json` |
| Routing: 3 profiles × 2 objectives; ordered ≤ 25 points; ≤ 2 alternatives for two-point ordered routes; optimized ≤ 10 points via Held–Karp over directed pair costs; typed rejections | Done | `apps/api/src/services/routing.ts`, `held-karp.ts` |
| Proximity: explicit metric and direction, supplied candidates only (≤ 50), unreachable kept and listed last | Done | `apps/api/src/services/proximity.ts` |
| Readiness gate: all four providers must report the active release identity; maintenance flag; fail closed | Done | `apps/api/src/services/health.ts` |
| Rendering import: osm2pgsql flex catalog, frozen per-release render DB, Tegola SQL | Done | `infra/catalog` |
| Routing build (Valhalla tiles), geocoder build (Nominatim → export → Seyra preprocessing → Photon), Overpass base | Done | `apps/ops/src/importer.ts`, `infra/images/*` |
| Map assets: Vazirmatn SDF glyphs (all ranges), woff2 font-faces, sprites, light/dark × fa/en styles validated against the MapLibre style spec | Done | `packages/map-assets` |
| Release CLI: init, tls, verify-images, import (staging validation), activate (maintenance cutover + recovery), rollback, prune, start/stop, status, verify-release, backup, bundle export/verify/load | Done | `apps/ops`, `bin/seyra-maps` |
| Offline bundle: image archives, install tree, manifest, `SHA256SUMS`, load-time image-ID verification | Done | `apps/ops/src/bundle.ts` |
| TLS ingress (Nginx): loopback default; LAN mode with CIDR allowlist (fail closed); Host allowlist; CSP and security headers; dataset-scoped map paths; bounded tile cache | Done | `infra/images/proxy` |
| Web test client: real local map, light/dark, fa/en, search/autocomplete/reverse, routing (alternatives, ordered/optimized), proximity, POI presets, health/limits/errors, connection loss, diagnostics | Done | `apps/web` |
| Mobile integration contract and recorded fixtures | Done; SDK not executed | `docs/MOBILE_INTEGRATION.md`, `docs/mobile-fixtures` |
| Runbook, licence inventory | Done | `docs/RUNBOOK.md`, `docs/LICENSES.md` |

Out of scope and not implemented, as instructed:
- Authentication, Relation, private tracking, SOS, mobile application.
- Temporal routing, live traffic, multipoint alternatives.
- Arbitrary Overpass QL, offline device map packs, public deployment.

## Locked dependencies (summary; authoritative: `infra/dependencies.lock.json`)

| Component | Version | Identity |
| --- | --- | --- |
| Node / TypeScript / Fastify / pg | 24.21.0 / 6.0.3 / 5.12.7 / 8.23.1 | npm integrity in `package-lock.json` |
| MapLibre GL JS / React / Vite | 6.14.0 / 19.3.0 / 8.3.4 | native RTL; no RTL plugin |
| Valhalla (+prime_server) | 3.9.1 (bafb699…) / 0.12.0 | built from source; `seyra/valhalla:3.9.1-seyra1` |
| Tegola | v0.21.2 (a803ac9…) | built from source, no viewer or cloud caches |
| Photon | 1.3.0 release jar (SHA-256 a89707c0…) | OpenJDK 21.0.12 (Temurin) |
| Nominatim | 5.3.2 wheel (build time only) | PostgreSQL 16.15 inside the build image |
| Overpass API | 0.7.62.4 (6a33115…) | built from source |
| osm2pgsql / osmium-tool | 2.3.1 / 1.19.1 | built from source |
| PostgreSQL / PostGIS | 17.5 / 3.5 | `postgis/postgis:17-3.5` (Debian 11 base: support-lifetime risk) |
| Nginx | 1.28.3 (alpine) | proxy image |
| Fonts | Vazirmatn 33.0.3 (OFL-1.1) | assets digest in the lock |

Image IDs are the local content-addressed IDs (containerd image store). No registry digest is claimed for custom images.

## Deviations, decisions and observations (all recorded, none silent)

1. **Valhalla built from source.** ghcr.io blob downloads were blocked by egress policy in preparation. HTTP fetching, elevation/timezone downloads and the extract/config scripts are removed from the image.
2. **Docker Hub through `mirror.gcr.io`** (Docker Hub returned 429). Base images are pinned by digest.
3. **Photon search normalization.** Photon 1.3.0 has no index normalization filters. Seyra writes normalized name variants into the index (original names kept in `extra`) and uses query-time synonyms. The API applies the same normalization to queries. Measured fixture quality is in TEST_RESULTS; the ZWNJ case ranks 3rd.
4. **Photon embedded OpenSearch disk watermarks** (found by lifecycle testing). The default percentage thresholds made the index read-only on a large, mostly-used disk with ~13 GB free, and Photon then failed to start. Each index is now built with absolute thresholds (low 2 GB / high 1 GB / flood 512 MB free); `verify-release` refuses indexes without them.
5. **Overpass dispatcher per-client controls disabled** (`--rate-limit=0`, duplicate queries allowed). The gateway is the single client, so per-address limiting throttled all users together and rejected identical queries. Global time/space limits, per-query `[timeout]`/`[maxsize]` and the gateway's bounded queue remain.
6. **dataset_id** derives from source, pipeline (1.0.1), data-shaping image IDs and the asset digest. API/proxy/ops image updates do not force re-imports, and `activate` refuses a release built with different data-component images.
7. **Cutover is a maintenance window**, not zero-downtime: ≈35 s not ready on the fixture.
8. **Host-local reachability.** Processes on the Docker host can reach container bridge addresses (Docker behaviour). Other networks cannot. Host shell access is part of the trust boundary.
9. **Web client defect found and fixed by the browser audit.** The MapLibre module worker (`.mjs`) was served as `application/octet-stream` with `nosniff`, so the map did not render. It is now served as `text/javascript`.
10. **Tegola** answers out-of-bounds tiles with 404 and a mislabelled encoding. The proxy returns 204 (empty tile), requests identity encoding upstream and compresses towards clients.

## Remaining validation (owner / target environment)

- Owner-supplied Iran snapshot: import time, RAM, disk (the importer's 40× free-space default is a guard, not a measurement), tile/routing/geocoder latency under load, Overpass limits on real data, real-address search fixtures and quality targets.
- Target host: OS/CPU, internal CA and DNS names, time sync, LAN deployment with real CIDRs, backup and restore drill.
- Mobile: SDK integration, MapLibre Native rendering of the fa/en styles (shaping/bidi with glyph PBFs), CA trust and pinning on devices.
- Distribution licence review (AGPL/GPL/ODbL obligations), see `docs/LICENSES.md`.
- PostGIS base image support window (Debian 11).
- Dark-theme label contrast on the primary road colour (visual polish).
