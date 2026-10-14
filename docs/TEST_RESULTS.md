# Seyra Map Services — test results (phase 1)

Recorded 2026-10-14 on branch `feat/map-services-v1` (base `a3460fcb2fed0340796f216fc9081d7e1b132fe3`).

**Environment:** a cloud preparation container.
- Ubuntu 24.04.5 LTS, kernel 6.18.44, x86_64, 4 vCPU, 15 GiB RAM.
- Docker Engine 29.8.2, Compose v5.6.0, Node 24.21.0.

This is **not** the customer reference hardware. Image identities are in `infra/dependencies.lock.json`.

**Dataset:** only the synthetic fixture `fixtures/osm/synthetic-v1.osm` was used (fictional objects near 0°E 0°N; PBF SHA-256 `e90c33a2…`, built by `fixtures/osm/build-fixture-pbf.sh`). **No Iran data was available or used.** Every number here is a fixture number, not a capacity, latency or quality claim for Iran.

Status words: PASS / FAIL / NOT RUN / BLOCKED. Evidence files are under `docs/evidence/`.

## Summary by acceptance item

| ID | Result | Evidence | Notes |
| --- | --- | --- | --- |
| AC01 | PASS | unit runs below; `npm run typecheck`, `npm run build` | 69 unit/contract tests (contracts 12, map-assets 6, api 37, ops 14). Serving code has no fixture/mock substitution; mocks exist only in unit tests. |
| AC02 | PASS | `infra/compose/runtime.yml`, lock, lifecycle and offline logs | All four providers start unconditionally; no profiles or toggles; `pull_policy: never`, no `build:` sections. `verify-images`, `import`, `activate` and `start` fail early on a missing or mismatched image. |
| AC03 | PASS (simulated offline host) | `docs/evidence/offline/` | Install, import, start/restart, update and rollback on a fresh, network-isolated Docker daemon with zero outbound packets (O0–O5). Target-hardware repetition pending. |
| AC04 | PASS | `security/external-urls.txt`, browser `report.json`, `tiles.it.test.ts` | Static inventory of every URL in the built web client, the release styles/TileJSON, proxy and provider configs, compose files and entrypoints: 0 unclassified. The only external strings are XML namespaces, library error/doc links and MapLibre's `maplibre.invalid` parsing base. Runtime request audit: 0 external requests. Provider remote fetches are disabled at build: Valhalla without HTTP fetch or elevation/timezone downloads, Tegola without viewer or cloud caches, Overpass without clone/replication/areas, Photon/Nominatim offline import. |
| AC05 | PASS | lifecycle L3–L5, `check-ingress-roles.sh`, unit tests | Same `dataset_id` in manifest, Tegola map name, Valhalla tileset timestamp, Photon marker and Overpass label. Mismatch or missing provider means not ready (L3). Requests with another `dataset_id` get 409, and tiles for another dataset get 404 `DATASET_MISMATCH`. |
| AC06 | PASS | `lifecycle/summary.txt` L1, L2 | Corrupt and truncated inputs are refused at `source-validate`. A killed import is recovered. The active release's artifact fingerprint is unchanged in every case. Build jobs mount only the new release directory. |
| AC07 | PASS | lifecycle L3–L6 | Provider-start failure (Photon) leads to automatic restore of the previous release; cutover and rollback complete. Measured not-ready windows are below. Not zero-downtime, not atomic. |
| AC08 | PASS | `integration/tiles-catalog.json`, `tiles.it.test.ts` | Independent MVT decode (`@mapbox/vector-tile` 3.0.0) checks every family's geometry type, OSM identity, tag mappings, exclusions, generic-icon value, label fallback and zoom rules. Features are deduplicated across tiles, not summed. |
| AC09 | PASS (visual review by the implementer) | `browser/*.jpg`, `report.json` | Chromium checks of light/dark × fa/en: Yeh/Kaf, lam-alef, Persian digits, ZWNJ and the Persian comma render with local fonts; no RTL plugin; 0 external requests; 0 console errors. |
| AC10 | PASS | `integration/routing.json` | All 24 supported cells (3 profiles × 2 objectives × 4 shapes). 13 typed rejections. Fixture checks for motorcycle=no, one-way, footway, motor_vehicle=no and the island. |
| AC11 | PASS | `routing.it.test.ts` | `route_optimality: not_guaranteed`, `duration_semantics: static_estimate`; modeled versus final cost reported. |
| AC12 | PASS | `routing.json` → `held_karp_vs_brute_force` | Held–Karp order and cost equal an independent brute-force enumeration (720 orders) for all 6 profile/objective pairs, including ties and duplicate coordinates; disconnected stop gives NO_ROUTE. |
| AC13 | PASS | `integration/proximity.json` | Straight-line within 5 cm of an independent Vincenty geodesic; direction flips the ranking on the one-way; unreachable listed last with null values; 50-candidate cap; explicit metric, direction and profile required. |
| AC14 | PASS (measured) | `integration/geocoder-quality.json` | Quality table below. ZWNJ street ranks 3rd (observation). Original display text preserved: Arabic letters and Persian-digit house numbers. |
| AC15 | PASS | `integration/pois.json` | Presets and allowlist only; raw QL, regex, URLs, injection-shaped values, oversized bbox/limit and unknown presets are rejected. Explicit truncation. 120 concurrent requests give 200 or typed `OVERLOADED`, never a hang. |
| AC16 | PASS | `security/checks.txt` | Only 127.0.0.1:8443 is published; providers, DB and API are unreachable from another network; Host allowlist (421); TLS 1.2+; security headers; LAN fail-closed and allowlist (403). Note AC16.3b: host-local processes can reach container bridge addresses. |
| AC17 | PASS | `security/checks.txt` | API role is read-only on control data with no map-DB access; tile reader is read-only; the import role is locked out after freeze; secrets are 0400 per consumer UID and absent from container config; logs contain no queries, coordinates or secrets. Map names are rendered as text in the web client. |
| AC18 | PASS | `offline/tamper.txt`, `offline/O1-*` | Checksums, unlisted-file detection and load-time image-ID verification (catches a consistent manifest+SUMS rewrite). Images are referenced by local tags whose IDs are verified against the lock; registry digests are not invented. |
| AC19 | PASS | git history | Owner input is read-only (checksum + copy); no public deployment or merge; no Auth/Relation/SOS code. |
| AC20 | PASS (contract); mobile execution NOT RUN | `docs/MOBILE_INTEGRATION.md`, `docs/mobile-fixtures/`, `docs/openapi/` | No native SDK executed. |

## Unit and contract tests (AC01)

```
npm run typecheck   → OK (all workspaces, TypeScript 6.0.3 strict)
npm run build       → OK
packages/contracts  Tests 12 passed     packages/map-assets Tests 6 passed (style-spec validation of all 4 styles)
apps/api            Tests 37 passed     apps/ops            Tests 14 passed
```

## Real-provider integration suite

`tests/integration` (vitest 5.0.4) runs against the running stack through `https://127.0.0.1:8443`, trusting the generated CA. Final run: **5 files, 137 tests passed**:

| File | Tests |
| --- | --- |
| `routing.it.test.ts` | 51 |
| `tiles.it.test.ts` | 13 |
| `pois.it.test.ts` | 26 |
| `proximity.it.test.ts` | 13 |
| `geocoder.it.test.ts` | 34 |

Reproduce:

```bash
cd tests/integration && npm ci
NODE_EXTRA_CA_CERTS=$SEYRA_HOME/secrets/tls/ca.crt npx vitest run
```

Routing (fixture, metres):

| Check | Car | Motorcycle | Pedestrian |
| --- | --- | --- | --- |
| motorcycle=no motorway, west→east | 4,453 (on motorway) | 6,680 (avoids motorway) | — |
| one-way column, with / against | 2,228 / 4,454 | — | 2,228 / 2,228 |
| footway shortcut | 3,897 | — | 2,819 (uses footway) |
| motor_vehicle=no lane | 1,671 | 1,671 | 557 |
| time vs distance objective | time: 5,567 m / 267 s; distance: 4,452 m / 534 s | | |

Held–Karp versus brute force: equal optimum and lexicographic tie choice for every pair.
- Ties: 2–4 optimal orders per case.
- Modeled versus final multi-stop cost differs by at most 3 ms or 1 m (provider rounding of the combined route).

Geocoder quality (fixture; not a measure of real Iranian search):

| Operation | Cases | hit@1 | hit@5 |
| --- | --- | --- | --- |
| search fa | 8 | 7 | 8 |
| search en | 3 | 3 | 3 |
| autocomplete fa | 6 | 5 | 6 |
| autocomplete en | 3 | 3 | 3 |
| reverse | 3 | 3 | 3 |

Below rank 1: «خیابان شمالی آزمایشی» (ZWNJ in the data, space in the query) ranks 3rd, behind POIs on that street. Photon 1.3.0 has no index normalization filters; Seyra adds normalized name variants and synonyms instead.

## Lifecycle (AC06/AC07) — `tests/lifecycle/lifecycle.sh`

| Case | Result | Detail |
| --- | --- | --- |
| L1 truncated PBF / random bytes | PASS / PASS | Refused at `source-validate`; active release byte-identical and ready. |
| L2 import killed during geocoder-build | PASS | The next import recovers the lock, stops 1 orphaned job, replaces the failed build and validates it; active stays ready. |
| L3 Photon cannot open its index during A→B | PASS | Detected (readiness timeout 90 s for the test); previous release restored, all four providers ready; **161 s not ready**. |
| L4 activation A→B | PASS | **34.5 s not ready** (≈25 s connection refused + maintenance 503). |
| L5 rollback B→A | PASS | **35.5 s not ready**; providers report A's four identities. |
| L6 prune | PASS | Exactly active + previous remain. |

## Security (AC16/AC17) — `tests/security/check-ingress-roles.sh`

22 checks PASS, 0 FAIL, plus one recorded NOTE (AC16.3b, host-local bridge reachability). See `docs/evidence/security/checks.txt`.

## Browser (AC09/AC04) — `tests/browser/web-client.mjs`

Playwright 1.56.1 with the preinstalled Chromium; `--no-proxy-server`. Certificate errors are ignored in the headless profile; the chain itself is verified in AC16.6.

Result: 64 requests, all to `https://127.0.0.1:8443`. 0 external, 0 RTL-plugin, 0 failed, 0 console errors. Persian text uses the local Vazirmatn woff2 `font-faces`; Latin uses SDF PBF range 0-255.

Screenshots:
- `search-light-fa`: Persian search, original Arabic-letter result text, ZWNJ «یک‌طرفه», Persian digit «۳».
- `lam-alef-light-fa`: «پارک لاله آزمایشی» drawn on the map with the lam-alef ligature.
- `light-en`, `dark-fa`, `dark-en`.

Observations:
- Dark theme: road labels on the brown primary road have weak contrast.
- The restaurant label under the search marker is not drawn (symbol collision).

## Offline host (AC03/AC18) — `tests/offline/`

**Bundle:** `bundle export` from the preparation daemon produced 10 image archives (1.3 GB in total) and 17 install files. SHA256SUMS digest: `4241264e4d410d7553a7551406bd0ac28b4dd0e15b75e1cdd2fa2112587d57be`.

Tamper checks (`tests/offline/bundle-tamper.sh`, `docs/evidence/offline/tamper.txt`):

| Case | Result |
| --- | --- |
| T0 untouched bundle verifies | PASS |
| T1 modified install file | PASS: refused (checksum mismatch) |
| T2 corrupted image archive | PASS: refused (checksum mismatch) |
| T3 unlisted extra file | PASS: refused |
| T4 consistent rewrite of the manifest identity **and** SHA256SUMS | PASS: checksum layer accepts it (by construction); `bundle load` refuses because the loaded image's real ID differs. Authenticity therefore also requires comparing the SHA256SUMS digest out of band (RUNBOOK §2). |
| T5 bundle restored byte-identical | PASS |

**Offline host** (`tests/offline/offline-host.sh`, `docs/evidence/offline/`). Setup:
- A fresh Docker 29.8.2 daemon (Docker-in-Docker test tooling, `docker:29.8.2-dind`, sha256:1e08cdb6…) with an empty image store and no registry mirror or proxy.
- It sits on a Docker `--internal` network: no route out, external DNS fails.
- A sink default route plus iptables counters (OUTPUT and DOCKER-USER) count every packet addressed outside loopback and private ranges.
- The operator wrapper ran with `DOCKER_HOST` pointed at it.
- The developer's firewall was not changed.

| Case | Result |
| --- | --- |
| O0 isolation | PASS: 0 images; `example.com` unreachable (DNS SERVFAIL) |
| O1 `bootstrap-load` | PASS: checksums verified; 10 images loaded; every reference resolves to its locked image ID (`verify-images` all OK) |
| O2 init, TLS, import, activate | PASS: fixture imported with staging validation and activated; ready through `https://127.0.0.1:8443`. The `dataset_id` (`ds-20261001-681455d56afb`) is identical to the preparation host's: same inputs and images give the same release identity. |
| O3 stop / start | PASS: all four providers ready again |
| O4 update and rollback | PASS: update to `ds-20261002-681455d56afb` and rollback, each verified through the ingress |
| O5 outbound attempts | PASS: **0** packets to non-local destinations across O1–O4. 7 link-local IGMP membership reports (224.0.0.0/4, emitted by the kernel when bridge/veth interfaces come up) are counted separately; a first run that lumped them into the counter was classified by a dedicated rule before this final run. |

Limits of this simulation:
- It ran in a cloud container, not on separate hardware.
- DNS names resolved by Docker's embedded resolver are not visible to iptables. External resolution fails on the internal network (checked in O0), so name lookups cannot reach the outside, but individual lookup attempts were not logged.

## Not run / blocked

| Item | Status | Reason and prerequisite |
| --- | --- | --- |
| Iran extract import/serve (time, RAM, disk, latency, quality) | NOT RUN | No owner dataset supplied. Runbook §3; repeat this suite plus owner search fixtures. |
| Customer hardware / target OS / internal CA / DNS | NOT RUN | Not available; run RUNBOOK §1–2 on the target host. |
| Mobile SDK (Android/iOS, MapLibre Native) | NOT RUN | No mobile project in scope; contract and fixtures prepared. |
| Restore from backup on a fresh host | NOT RUN | Procedure documented (RUNBOOK §7); `backup` command exercised only in development. |
| Docker Hub direct pulls / ghcr.io | BLOCKED (preparation only) | 429 / egress policy; used the mirror.gcr.io registry mirror and built Valhalla from source. No effect on operation. |
| Load/soak testing | NOT RUN | No capacity targets yet; the phase-1 limits are defaults, not measurements. |
