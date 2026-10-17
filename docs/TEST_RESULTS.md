# Seyra Map Services — test results (phase 1)

**Current record: 2026-10-17**, for the corrections to the PR #1 review of `d8d08af` (findings R1–R4), on branch `feat/map-services-v1` (base `a3460fcb2fed0340796f216fc9081d7e1b132fe3`). Commit under test: `c5c6f3f`, i.e. code `c2b1883` plus the relocked images. The 2026-10-14 results for `d8d08af` are historical. Every suite below was re-run on the corrected commit and the image identities listed here, unless a row says otherwise.

**Environment:** a cloud preparation container.
- Ubuntu 24.04.5 LTS, kernel 6.18.44, x86_64, 4 vCPU, 15 GiB RAM.
- Docker Engine 29.8.2, Compose v5.6.0, Node 24.21.0.

This is **not** the customer reference hardware.

**Dataset:** only the synthetic fixture `fixtures/osm/synthetic-v1.osm` was used (fictional objects near 0°E 0°N; PBF SHA-256 `e90c33a2…`, built by `fixtures/osm/build-fixture-pbf.sh`). **No Iran data was available or used.** Every number here is a fixture number, not a capacity, latency or quality claim for Iran.

Status words: PASS / FAIL / NOT RUN / BLOCKED. Evidence files are under `docs/evidence/`.

**Image identities used for these runs** (`infra/dependencies.lock.json`, local content-addressed IDs; no registry digest is claimed for custom images):

| Role | Reference | Image ID | Changed by the corrections |
| --- | --- | --- | --- |
| API | `seyra/api:1.0.0-seyra1` | `sha256:55844f00176edab3d979a1dcb2f5991bbe798cd0644da1fe3c131dfa0e528861` | yes (R4); built from `327aca4` |
| PROXY | `seyra/proxy:1.0.0-seyra1` | `sha256:4cc83237dfb6cec361e79ba6cd55813439c5fd191c09461c1bf4f9d52c042fc8` | yes (R1); built from `327aca4` |
| OPS | `seyra/ops:1.0.0-seyra1` | `sha256:18ea8ed0724a62ae2a6bea45f76a028644eb83091eafee8a934d88404a37704f` | yes (R1–R3, restore, ingress check); built from `c2b1883` |
| DB | `postgis/postgis:17-3.5` | `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` | no |
| TEGOLA | `seyra/tegola:0.21.2-seyra1` | `sha256:28934a38499e5a1f58f54634f5a4fc340af623fee3cb9df2333902214c5f0370` | no |
| VALHALLA | `seyra/valhalla:3.9.1-seyra1` | `sha256:58448d47eaef78b09877d651ef3c4ae24344707f6896659b71f32a44fa105204` | no |
| PHOTON | `seyra/photon:1.3.0-seyra1` | `sha256:2f6c0e27a9410f2107bb84f40bd89ebe04f2d1a59e17b97968c2d99b85639f2c` | no |
| OVERPASS | `seyra/overpass:0.7.62.4-seyra1` | `sha256:e0c93b85d690a7337fbb02440da1a2959c467c225c300b04656c2f90620363a3` | no |
| OSMTOOLS | `seyra/osmtools:2.3.1-1.19.1-seyra1` | `sha256:48e8fdfe6685e25008956ed238bb7d13b76046aa0ddf8e2a610ce56b16ca3e2f` | no |
| GEOCODER_BUILD | `seyra/geocoder-build:5.3.2-1.3.0-seyra1` | `sha256:7c3a11c1e76b4768610eaab7df23a7620deb01df349bcaa7776f7c302892db86` | no |

The data-component images did not change, so the existing releases and dataset IDs remain valid.

## PR #1 review corrections (review of `d8d08af`, R1–R4)

The review's reproduction harness asserts the pre-fix defects, so it cannot pass against the corrected code. As the review instructs, each case was turned into a desired-behaviour test in the project. Each finding was first reproduced on `d8d08af` with Node 24.21.0.

| Finding | Correction | Unit/contract regression | Real-stack regression (final images) |
| --- | --- | --- | --- |
| **R1** (P1): loopback mode accepted `0.0.0.0` with no allowlist | `apps/ops/src/net.ts` adds strict IPv4/CIDR parsing (no leading zeros or out-of-range octets; canonical networks; prefix 8–32). The access rules: loopback mode needs a 127/8 bind and no CIDRs; LAN mode needs a non-loopback bind plus CIDRs, and `deny all` always follows the allowlist. They are enforced by `init` before persisting, by `runtimeEnv()`, by `assertRuntimeEnvSafe()` before every `compose up`, and independently by the proxy entrypoint, which receives `SEYRA_BIND_ADDR`. | `access.test.ts` (29 tests): rejected/accepted tables, CIDR parsing, a hand-edited `runtime.env`, and `init` leaving `settings.json` byte-identical. | `check-ingress-roles.sh` AC16.9–AC16.15, with the real proxy image and real CLI: LAN mode without CIDRs is refused; loopback + `0.0.0.0` is refused; `0.0.0.0/0`, `300.1.1.0/24` and the non-canonical `10.20.0.5/24` are refused; allowlisted clients get 200 and others 403; `init --bind 0.0.0.0` is refused and nothing is persisted; `start` refuses a hand-edited unsafe `runtime.env`. |
| **R2** (P1): an exception during activation skipped recovery | The whole transition after maintenance is under `try/catch`. The prior `runtime.env` and `release.json` are saved under `state/transition/` and journalled in `state/transition.json` (`started` → `switched` → `committed`). Any failure (command, filesystem or not-ready) restores the prior configuration and waits for the previous release's identities. If recovery also fails, both errors are reported, maintenance stays on, the journal is kept, mutators refuse, and the new `seyra-maps recover` finishes or reverts the transition. No atomicity is claimed. | `lifecycle.test.ts` R2 cases (10): success; compose-up failure; filesystem failure; not ready; recovery failure followed by `recover`; process killed mid-transition; killed after commit; rollback re-entrancy; proxy left without its published port is recreated; an ingress that cannot be published fails closed, then `recover`. | Lifecycle L3 (Photon cannot open its index), **L7** (real `docker compose up` failure: a second process holds 127.0.0.1:8443 right after the old proxy stops) and **L8** (the port stays taken, so recovery fails too: maintenance and journal kept; `activate`, `prune` and `start` refused; `recover` restores A once the port is free). |
| **R3** (P1): prune could drop a release being imported or activated | `state/lifecycle.lock` is one global, re-entrant (AsyncLocalStorage) lock taken by every mutating command, including `init`, `start` and `stop`. `state/import.lock` is the import lease, which names its target. `prune` never touches the lease target or a `building` release while the lease's owner lives. An owner counts as gone only when its process (same host) or ops container (`docker inspect`) is positively absent; any other result leaves the lock untouched. Stale-import recovery is kept and bounded to Seyra job containers and `building` releases. | `lifecycle.test.ts` R3 cases (6), with real second OS processes as lock owners: import + prune; stale lease recovered; foreign live lock refused; competing activations (exactly one succeeds); stale lock + journal admits only `recover`; first lock on a fresh `SEYRA_HOME`. | Lifecycle **L9** (prune during a real import: "being built by the running import"; the import completes and `verify-release` passes), **L10** (prune during a real activation is refused), **L11** (`activate` during a real rollback is refused; the rollback completes), **L12** (post-transition prune), and L2 (killed import recovered). |
| **R4** (P2): the provider gate admitted requests before verification or while the provider was unavailable | `HealthService.gate()` is async. It admits only a fresh `ok` verification of **that** provider: its age must be at most `maxVerifiedAgeMs` (default max(2 × cache, 1 s)). A missing, stale or failed entry is re-probed for that provider alone, waiting at most `gateWaitMs`; otherwise it is rejected with `PROVIDER_UNAVAILABLE` or `PROVIDER_REVISION_MISMATCH`. Other providers' outages do not delay or block it, and readiness stays `not_ready`. | `gate.test.ts` (9): startup before the first probe with a hanging provider (refused in under 1 s), on-demand verification, unavailable, mismatch, stale, recovery, unrelated outage. HTTP level: `/route` and `/proximity` return 503 with the adapter not called; search returns 503 `PROVIDER_REVISION_MISMATCH`; routing returns 200 during an Overpass outage while POIs return 503, then 200. | Integration suite (137) on the rebuilt API image: all capabilities answer normally through the gate. |

**Defects found while verifying the corrections, and fixed:**
- **Unpublished ingress reported as ready** (`c2b1883`). In the first real L8 run, `recover` reported "ready" while `https://127.0.0.1:8443` refused connections.
  - Cause: Docker 29.8.2 starts a container whose host-port bind failed earlier as "running" without the port. `compose up` then leaves it alone, and readiness checked inside the API container still passes. This was reproduced in isolation with `docker start` and with compose.
  - Fix: every stack start (activation, recovery, `recover`, `start`) checks `docker compose port proxy 8443` against the configured bind address and port. If the port is not published, the proxy is recreated once, and the start fails if it is still unpublished.
  - Two unit regressions fail without the fix. L8 now passes through the real ingress.
- **`init` failed on a brand-new `SEYRA_HOME`** (`1f2d3e2`). The R3 lifecycle lock needed `state/` before `init` creates it. Found while writing the restore drill; covered by a unit test and by the drill's fresh-host `init`.

## Summary by acceptance item

| ID | Result | Evidence | Notes |
| --- | --- | --- | --- |
| AC01 | PASS | unit runs below; `npm run typecheck`, `npm run build` | 127 unit/contract tests (contracts 12, map-assets 6, api 46, ops 63), including the R1–R4 regressions. Serving code has no fixture/mock substitution; mocks exist only in unit tests. |
| AC02 | PASS | `infra/compose/runtime.yml`, lock, lifecycle and offline logs | All four providers start unconditionally; no profiles or toggles; `pull_policy: never`, no `build:` sections. `verify-images`, `import`, `activate` and `start` fail early on a missing or mismatched image. |
| AC03 | PASS (simulated offline host) | `docs/evidence/offline/`, `docs/evidence/restore/` | Install, import, start/restart, update and rollback on a fresh, network-isolated Docker daemon with zero outbound packets (O0–O5, new bundle). Fresh-host backup restore drill R1–R7, also with zero outbound packets. Target-hardware repetition pending. |
| AC04 | PASS | `security/external-urls.txt`, browser `report.json`, `tiles.it.test.ts` | Static inventory of every URL in the built web client, the release styles/TileJSON, proxy and provider configs, compose files and entrypoints: 0 unclassified. The only external strings are XML namespaces, library error/doc links and MapLibre's `maplibre.invalid` parsing base. Runtime request audit: 0 external requests. Provider remote fetches are disabled at build: Valhalla without HTTP fetch or elevation/timezone downloads, Tegola without viewer or cloud caches, Overpass without clone/replication/areas, Photon/Nominatim offline import. |
| AC05 | PASS | lifecycle L3–L5, `check-ingress-roles.sh`, unit tests | Same `dataset_id` in manifest, Tegola map name, Valhalla tileset timestamp, Photon marker and Overpass label. Mismatch or missing provider means not ready (L3). Requests with another `dataset_id` get 409, and tiles for another dataset get 404 `DATASET_MISMATCH`. |
| AC06 | PASS | `lifecycle/summary.txt` L1, L2, L9, L12 | Corrupt and truncated inputs are refused at `source-validate`. A killed import is recovered. A live import is protected from a concurrent prune (R3). The active release's artifact fingerprint is unchanged in every case. Build jobs mount only the new release directory. |
| AC07 | PASS | lifecycle L3–L8, L10, L11 | Provider-start failure (L3), a real `compose up` failure (L7) and a failed recovery finished by `recover` (L8) all end on the previous release, verified through the real ingress (R2). Concurrent mutators are refused (R3). Measured not-ready windows are below. Not zero-downtime, not atomic. |
| AC08 | PASS | `integration/tiles-catalog.json`, `tiles.it.test.ts` | Independent MVT decode (`@mapbox/vector-tile` 3.0.0) checks every family's geometry type, OSM identity, tag mappings, exclusions, generic-icon value, label fallback and zoom rules. Features are deduplicated across tiles, not summed. |
| AC09 | PASS (visual review by the implementer) | `browser/*.jpg`, `report.json` | Chromium checks of light/dark × fa/en: Yeh/Kaf, lam-alef, Persian digits, ZWNJ and the Persian comma render with local fonts; no RTL plugin; 0 external requests; 0 console errors. |
| AC10 | PASS | `integration/routing.json` | All 24 supported cells (3 profiles × 2 objectives × 4 shapes). 13 typed rejections. Fixture checks for motorcycle=no, one-way, footway, motor_vehicle=no and the island. |
| AC11 | PASS | `routing.it.test.ts` | `route_optimality: not_guaranteed`, `duration_semantics: static_estimate`; modeled versus final cost reported. |
| AC12 | PASS | `routing.json` → `held_karp_vs_brute_force` | Held–Karp order and cost equal an independent brute-force enumeration (720 orders) for all 6 profile/objective pairs, including ties and duplicate coordinates; disconnected stop gives NO_ROUTE. |
| AC13 | PASS | `integration/proximity.json` | Straight-line within 5 cm of an independent Vincenty geodesic; direction flips the ranking on the one-way; unreachable listed last with null values; 50-candidate cap; explicit metric, direction and profile required. |
| AC14 | PASS (measured) | `integration/geocoder-quality.json` | Quality table below. ZWNJ street ranks 3rd (observation). Original display text preserved: Arabic letters and Persian-digit house numbers. |
| AC15 | PASS | `integration/pois.json` | Presets and allowlist only; raw QL, regex, URLs, injection-shaped values, oversized bbox/limit and unknown presets are rejected. Explicit truncation. 120 concurrent requests give 200 or typed `OVERLOADED`, never a hang. |
| AC16 | PASS | `security/checks.txt` | Only 127.0.0.1:8443 is published; providers, DB and API are unreachable from another network; Host allowlist (421); TLS 1.2+; security headers. Strict access validation (R1): loopback mode needs a 127/8 bind; LAN mode needs canonical CIDRs, `deny all`, and fails closed; unsafe settings or `runtime.env` are refused before anything starts (AC16.9–AC16.15). Note AC16.3b: host-local processes can reach container bridge addresses. |
| AC17 | PASS | `security/checks.txt` | API role is read-only on control data with no map-DB access; tile reader is read-only; the import role is locked out after freeze; secrets are 0400 per consumer UID and absent from container config; logs contain no queries, coordinates or secrets. Map names are rendered as text in the web client. |
| AC18 | PASS | `offline/tamper.txt`, `offline/O1-*` | Re-run on the new bundle. Checksums, unlisted-file detection and load-time image-ID verification (catches a consistent manifest+SUMS rewrite). Images are referenced by local tags whose IDs are verified against the lock; registry digests are not invented. |
| AC19 | PASS | git history | Owner input is read-only (checksum + copy); no public deployment or merge; no Auth/Relation/SOS code. |
| AC20 | PASS (contract); mobile execution NOT RUN | `docs/MOBILE_INTEGRATION.md`, `docs/mobile-fixtures/`, `docs/openapi/` | No native SDK executed. |

## Unit and contract tests (AC01)

On `c5c6f3f`:

```
npm run typecheck   → OK (all workspaces, TypeScript 6.0.3 strict)
npm run build       → OK
packages/contracts  Tests 12 passed     packages/map-assets Tests 6 passed (style-spec validation of all 4 styles)
apps/api            Tests 46 passed     apps/ops            Tests 63 passed
```

That is 127 tests in total, up from 69 at `d8d08af`. The new regressions:
- `apps/api/src/gate.test.ts` (R4, 9 tests)
- `apps/ops/src/access.test.ts` (R1, 29 tests)
- `apps/ops/src/lifecycle.test.ts` (R2/R3, 16 tests: the real activate/recover/rollback/prune/lock code on a real temporary `SEYRA_HOME`, with only the Docker/SQL boundary simulated and real second OS processes as lock owners)
- `apps/ops/src/restore.test.ts` (fresh-host restore, 4 tests)

The R2/R3 and R4 files were also repeated 3 and 5 times with no flaky result.

## Real-provider integration suite

`tests/integration` (vitest 5.0.4) runs against the running stack through `https://127.0.0.1:8443`, trusting the generated CA. Run on `c5c6f3f` with the images above: **5 files, 137 tests passed**:

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

Run on `c5c6f3f` with the images above, real providers and real concurrent CLI processes: **12/12 PASS**. Releases: A = `ds-20261001-681455d56afb`, B = `ds-20261006-681455d56afb`, C = `ds-20261007-681455d56afb`. Evidence: `docs/evidence/lifecycle/`.

```bash
SEYRA_HOME=… FIXTURE=…/synthetic-v1.osm.pbf SNAPSHOT_TS=2026-10-06T00:00:00Z SNAPSHOT_TS_L9=2026-10-07T00:00:00Z \
  NODE_BIN=…/node tests/lifecycle/lifecycle.sh    # run from a copy; it must not be edited while running
```

| Case | Result | Detail |
| --- | --- | --- |
| L1 truncated PBF / random bytes | PASS / PASS | Refused at `source-validate`; active release byte-identical and ready. |
| L2 import killed during geocoder-build | PASS | The next import recovers the lease, stops 1 orphaned job, replaces the failed build and validates it; A stays ready. |
| L3 Photon cannot open its index during A→B | PASS | Detected (readiness timeout 90 s for the test); previous release restored, all four providers ready; **124.5 s not ready**. |
| L4 activation A→B | PASS | **35.0 s not ready** (connection refused while the proxy restarts, then maintenance 503). |
| L5 rollback B→A | PASS | **35.5 s not ready**; providers report A's four identities. |
| L6 prune | PASS | Exactly active + previous remain. |
| L7 real `compose up` failure (R2) | PASS | `tests/lifecycle/port-squatter.mjs` binds 127.0.0.1:8443 the moment the old proxy stops, so Docker fails to publish the new proxy (`address already in use`). It releases the port once the failure is journalled. A restored; `runtime.env`, `release.json` and pointers byte-identical; no journal, no maintenance; ready. |
| L8 recovery failure (R2) | PASS | The port stays taken, so restoring A fails too. Both errors are reported, and maintenance plus the journal stay; `status` shows `UNFINISHED activate`; `activate`, `prune` and `start` refuse. After the squatter exits, `recover` restored A. Docker had left the proxy running with its port reported as `:0`; `recover` detected and recreated it (`[ingress] … recreating it`), and A answers through the real ingress. |
| L9 prune during a live import (R3) | PASS | Prune skipped C ("being built by the running import"); the import completed; `verify-release C` passes (render DB intact). |
| L10 prune during an activation (R3) | PASS | Refused with "another lifecycle operation is running: activate B"; the activation completed; nothing removed. |
| L11 activate during a rollback (R3) | PASS | Refused with "…running: rollback"; the rollback completed (active A, previous B). |
| L12 prune after the transitions | PASS | C removed; A and B kept. |

The first full run on the corrected code passed 11 of 12. L8 failed because of the unpublished-ingress defect described above. It was fixed in `c2b1883`, and the run above is on the fixed images.

## Security (AC16/AC17) — `tests/security/check-ingress-roles.sh`

On `c5c6f3f`: **28 checks PASS, 0 FAIL**, plus one recorded NOTE (AC16.3b, host-local bridge reachability). See `docs/evidence/security/checks.txt`.

New for R1 (real proxy image; a throw-away proxy on 127.0.0.1:18443; the real CLI):

| Check | Result |
| --- | --- |
| AC16.9 LAN mode without CIDRs | PASS: proxy exits 2, nothing listening |
| AC16.11 loopback mode published on `0.0.0.0` | PASS: refused |
| AC16.12a/b/c `0.0.0.0/0`, `300.1.1.0/24`, non-canonical `10.20.0.5/24` | PASS: refused |
| AC16.10 client outside the allowlist | PASS: 403 |
| AC16.13 client inside the allowlist (`/32` of the frontend gateway) | PASS: 200 |
| AC16.14 `init --bind 0.0.0.0` in loopback mode | PASS: rejected; `settings.json` byte-identical |
| AC16.15 hand-edited `runtime.env` (loopback + `0.0.0.0`) | PASS: `start` refuses before compose; running proxy untouched |

## Browser (AC09/AC04) — `tests/browser/web-client.mjs`

Playwright 1.56.1 with the preinstalled Chromium; `--no-proxy-server`. Certificate errors are ignored in the headless profile; the chain itself is verified in AC16.6.

Re-run on `c5c6f3f`: 62 requests, all to `https://127.0.0.1:8443`. 0 external, 0 RTL-plugin, 0 failed, 0 console errors (PASS). The 2026-10-14 run made 64 requests; the count depends on how many tiles the screenshot viewports load. Persian text uses the local Vazirmatn woff2 `font-faces`; Latin uses SDF PBF range 0-255.

Screenshots:
- `search-light-fa`: Persian search, original Arabic-letter result text, ZWNJ «یک‌طرفه», Persian digit «۳».
- `lam-alef-light-fa`: «پارک لاله آزمایشی» drawn on the map with the lam-alef ligature.
- `light-en`, `dark-fa`, `dark-en`.

Observations:
- Dark theme: road labels on the brown primary road have weak contrast.
- The restaurant label under the search marker is not drawn (symbol collision).

## Offline host (AC03/AC18) — `tests/offline/`

**Bundle (re-exported from `c5c6f3f`):** `bundle export` produced 10 image archives (1.3 GB in total) and 17 install files in 2 min 9 s. SHA256SUMS digest: `ea9c2a1090bcd2f8fb40a0f6bc51657dbcfcd2194a6b233504a1f66ab45dcfd1`. The previous bundle (digest `4241264e…`) is superseded.

Tamper checks (`tests/offline/bundle-tamper.sh`, `docs/evidence/offline/tamper.txt`):

| Case | Result |
| --- | --- |
| T0 untouched bundle verifies | PASS |
| T1 modified install file | PASS: refused (checksum mismatch) |
| T2 corrupted image archive | PASS: refused (checksum mismatch) |
| T3 unlisted extra file | PASS: refused |
| T4 consistent rewrite of the manifest identity **and** SHA256SUMS | PASS: checksum layer accepts it (by construction); `bundle load` refuses because the loaded image's real ID differs. Authenticity therefore also requires comparing the SHA256SUMS digest out of band (RUNBOOK §2). |
| T5 bundle restored byte-identical | PASS (digest unchanged after the run) |

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
| O2 init, TLS, import, activate | PASS: `init` on a brand-new `SEYRA_HOME` (this would have failed before `1f2d3e2`); fixture imported with staging validation and activated; ready through `https://127.0.0.1:8443`. The `dataset_id` (`ds-20261001-681455d56afb`) is identical to the preparation host's: same inputs and images give the same release identity. |
| O3 stop / start | PASS: all four providers ready again |
| O4 update and rollback | PASS: update to `ds-20261002-681455d56afb` and rollback, each verified through the ingress |
| O5 outbound attempts | PASS: **0** packets to non-local destinations across O1–O4. 6 link-local IGMP membership reports (224.0.0.0/4, emitted by the kernel when bridge/veth interfaces come up) are counted separately by a dedicated rule. |

Limits of this simulation:
- It ran in a cloud container, not on separate hardware.
- DNS names resolved by Docker's embedded resolver are not visible to iptables. External resolution fails on the internal network (checked in O0), so name lookups cannot reach the outside, but individual lookup attempts were not logged.

## Fresh-host restore drill — `tests/offline/restore-drill.sh`

```bash
BUNDLE=…/bundle-2026-10-17 FIXTURE=…/synthetic-v1.osm.pbf LAB=…/offline-lab DIND_IMAGE=docker:29.8.2-dind tests/offline/restore-drill.sh
```

Two offline hosts are used one after the other, each a fresh Docker-in-Docker daemon on the internal network with the same egress counters as above. Host 1 is destroyed (container, Docker volume and `SEYRA_HOME`) before host 2 is created. Host 2 never sees host 1's Docker state or `SEYRA_HOME`, only the backup directory and the separately kept `secrets/` copy. Install and rollback are not counted as restoration. Evidence: `docs/evidence/restore/`.

Result: **R1–R7 PASS**.

| Case | Result |
| --- | --- |
| R1 source host | PASS: active B `ds-20261002-681455d56afb`, previous A `ds-20261001-681455d56afb`, ready through the ingress; 6 control-DB release events; non-default server names. |
| R2 `backup --include-sources` | PASS: control-DB dump, state and manifest archives, and both managed inputs. No secret value or private-key line appears in the backup or inside its archives. |
| R3 fresh host, out-of-order restore | PASS: images loaded from the bundle. `restore` before the secrets are back is refused and starts nothing. |
| R4 secrets → `init` → `restore` | PASS: the dump replaced the freshly initialised control DB (no replay over an existing schema). All 6 release events are identical (ids and timestamps). Grants and migrations re-applied. `seyra_api` logs in over TCP with the restored password (secret/password alignment). Settings restored. |
| R5 rebuild from the printed commands | PASS: `restore` printed one import command per backed-up release (backed-up input, operator snapshot timestamp). Both rebuilt with **the same dataset IDs**. |
| R6 activate | PASS: the restored host serves B (previous A) through `https://127.0.0.1:8443`. The restored event history is kept and extended. Secret files are identical to the secrets backup. |
| R7 outbound attempts | PASS: 0 packets to non-local destinations from either host. |

The first drill run failed R5/R6 because of a harness bug: the command loop's stdin was consumed by `docker run -i`, so only one of the two printed imports ran. The `restore` output itself was correct. After the harness fix (`< /dev/null`), the full drill was re-run from scratch and passed.

Limits:
- It ran on the synthetic fixture, in a cloud container.
- Without `--include-sources`, the owner must supply the original input that matches the recorded sha256; that path was not exercised.
- A restore on the target hardware remains pending.

## Not run / blocked

| Item | Status | Reason and prerequisite |
| --- | --- | --- |
| Iran extract import/serve (time, RAM, disk, latency, quality) | NOT RUN | No owner dataset supplied. Runbook §3; repeat this suite plus owner search fixtures. |
| Customer hardware / target OS / internal CA / DNS | NOT RUN | Not available; run RUNBOOK §1–2 on the target host. |
| Mobile SDK (Android/iOS, MapLibre Native) | NOT RUN | No mobile project in scope; contract and fixtures prepared. |
| Restore from backup on the target host / without `--include-sources` | NOT RUN | The fresh-host drill passed on simulated offline hosts (above). Repeat RUNBOOK §7 on target hardware; also exercise the path where the owner supplies the original input. |
| Docker Hub direct pulls / ghcr.io | BLOCKED (preparation only) | 429 / egress policy; used the mirror.gcr.io registry mirror and built Valhalla from source. No effect on operation. |
| Load/soak testing | NOT RUN | No capacity targets yet; the phase-1 limits are defaults, not measurements. |
| CI (typecheck/unit/build on push) | NOT RUN | Not set up. This is a useful follow-up, not a substitute for the real-provider, lifecycle and offline suites. |
