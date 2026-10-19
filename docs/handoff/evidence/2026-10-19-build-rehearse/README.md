# Build and disposable rehearsal on the shared VM (run `2026-10-19-build-rehearse`)

Owner-authorized run on the replacement VM (4 vCPU, 7.2 GiB RAM), starting from the reviewed head `3431e7e`. Scope:
- a temporary graceful stop of the preserved serving installation;
- the API, proxy and OPS image builds;
- the next bundle;
- every suite on the new images;
- a disposable relay/TLS/rollback rehearsal on a synthetic fixture;
- the mandatory resume of the original service.

Boundary kept throughout:
- The new build was **not** deployed to the serving host.
- No LAN endpoint was published, and no device trust or real issuer was created.
- No access setting, certificate or store of the serving host was changed.
- `main` is unchanged, PR #1 stays a draft, and nothing was pushed.

Values that are operator-local (LAN address, approved subnet, host and lab identities, the serving dataset binding, certificate metadata) are kept in the private maintenance record, not here.

## 1. Commits of this run

| Commit | Content |
| --- | --- |
| `fdbe1c5` | fix(ops): the CSR from `tls csr` is readable by the non-root operator (pending dir 0711, CSR 0444, key stays 0400) |
| `861c532` | fix(edge): rollback removes the relay trust **before** the edge stops; `edge.sh stop` interlock |
| `064eafb` | test(offline): namespace egress judges lab sink routes and probes real sinks |
| `043993c` | test: resource supervisor, Swagger UI browser check, handoff rehearsal harness (images built from this commit) |
| `430f139` | chore(lock): relock the rebuilt API, proxy and OPS images |
| `862dc8d` | fix(wrapper): a new `--out` directory is 0755 whatever the operator's umask |
| `a98a96a` | test(browser): provider-down mode records the browser's own 503 log line separately |
| `3be75b2` | fix(wrapper): `--from` accepts root-only backups inside `SEYRA_HOME` (found by rehearsal attempt 1) |
| `734c199` | test(rehearsal): plan-order rollback with an interlock check; style JSON parsed |
| `92c0726` | docs(runbook): operator access to the CSR and to `tls restore` backups (final bundle r8 built from here) |

Image inputs (`apps`, `packages`, `infra/images`, `infra/compose`, `infra/catalog`, `package-lock.json`) are identical between `043993c` and `92c0726`. The later commits change only the host wrapper, tests and documentation.

## 2. Findings in this run, each with a before/after regression

| # | Finding | Fix | Regression (before → after) |
| --- | --- | --- | --- |
| B1 | `tls csr` created `pending/` as 0700 root, so the non-root operator could not read the CSR to hand it to the issuer | 0711 directory, 0444 CSR and `names.json`; key 0400 | `apps/ops/src/tls.test.ts` CSR flow: mode 448 ≠ 457 → 23/23. Real host: RT1 (operator `cp` of the CSR) |
| B2 | Documented rollback stopped the edge **before** removing the inner relay trust. Docker releases a stopped container's address at once and hands it to the next container (reproduced on Docker 29: a stopped container's `.2` was given to a new container immediately), so a trusted relay address was free for reuse | RUNBOOK §6.2 and DEPLOYMENT_PLAN §4: `init --no-relay` + `access apply` + `proxy restart` first; `edge.sh stop` refuses while the relay upstream still answers (`--force` for emergencies) | `tests/security/test-edge-stop.mjs`: old script 3 of 4 FAIL → 4/4. Real topology: RB0 (refused, edge kept its address), RB1–RB3 |
| B3 | Lab hosts route by default to an absent sink, which the namespace egress test counted as routable | Sink routes count as isolated only on internal networks with no answering sink; real host probes to controlled sinks plus a control destination | `tests/offline/test-namespace-egress.mjs`: 2 FAIL → 21/21. Real topology: RE1 |
| B4 | Bundle root created under the operator's umask (0775 with umask 0002; r3 and r6 roots too), contrary to RUNBOOK's 0755 | New `--out` directories are created 0755 | wrapper case 9: old 775 → 755 (`test-wrapper-inputs.mjs` 60/60, later 64/64) |
| B5 | **Found by rehearsal attempt 1:** `tls restore --from <home>/secrets/tls/previous-<time>`, the documented certificate rollback, failed for the non-root operator ("is not a directory") because the wrapper entered the 0700 root-owned backup as the operator | A `--from` path inside `SEYRA_HOME` is resolved lexically and checked by the CLI as root; outside paths are still checked and mounted read-only | wrapper case 10: old 2 of 4 FAIL → 4/4; real topology RB4 (attempt 1 RB1 FAIL → attempt 2 PASS) |

Test-harness corrections (no product effect):
- the Swagger provider-down mode counted Chromium's own "Failed to load resource: 503" log line for the expected 503;
- the rehearsal's `recreated` list was inverted (GNU `join` keyed whole lines; raw id files retained, recomputed with awk);
- a style check compared a compact string against pretty-printed JSON.

## 3. Preserved installation: maintenance pause and resume

Record: [`maintenance/README.txt`](maintenance/README.txt).
- **Preflight** (private record): readiness, dataset, containers, images, lock, hashes, TLS fingerprints, egress counter, PBF SHA-256. A fresh verified control/state backup and a verified secrets/TLS copy were made, and a durable `RESUME-REQUIRED` marker with stop/resume commands was written before the stop.
- **Stop** 14:32:06–14:32:49Z with the installed CLI:
  - PostgreSQL shut down cleanly (shutdown checkpoint, exit 0).
  - Overpass was killed by Docker after the 40 s stop timeout. This leaves no stale state (tmpfs socket dir, read-only database), but it is a shutdown defect to fix in a later data-image change; see §9.
  - The outer host, its daemon, networks and volume kept running.
- **Resume** 15:57:08Z with the unchanged installed CLI and r3 images; ready at 15:57:41Z.
  - All four providers report the expected identities on the recorded dataset; the loopback ingress answers 200; `verify-images` gives 10 OK.
  - Every identity in the baseline is unchanged. The inner containers were restarted with the same ids.
  - The marker was cleared only after this check. The intentional unavailability was about 85.6 min.
- The 18 October readiness 503 observation is a separate, still open record.

## 4. Pinned runtime (Node 24.21.0, OpenSSL 3.5)

- Standalone regressions, 14 suites ([`regressions/`](regressions/)): 332/332 at the start of the run. Final-tree counts are in §10.
- `npm run build` and `npm run typecheck` pass. Unit tests 226/226 (contracts 12, map-assets 6, api 57, ops 151).

## 5. Builds, relock, bundle, client pack

| Item | Result |
| --- | --- |
| Builds (sequential, frozen `git archive` of `043993c`) | API `sha256:710d5e37…` 17 s; proxy `sha256:b953043a…` 14 s; OPS `sha256:8cbabae5…` 34 s; min. available memory during builds ≥ 5,818 MiB ([`build/`](build/)) |
| Build network | **Deviation:** `docker build --network host`. The first API attempt (kept: `build/workloads.txt`, 693 s, rc 1) timed out in `npm ci`: outbound TCP from Docker's NAT bridge to the npm registry (and most destinations) got no SYN-ACK, while ICMP/DNS from the bridge and all host-network connections worked. Base images, Dockerfiles and lockfile are the pinned ones. The cause is outside the VM. |
| Relock | Only API, proxy and OPS ids changed. All seven data-component entries (PostGIS, Tegola, Valhalla, Photon, Overpass, osmtools, geocoder-build) are byte-identical. The proxy Dockerfile and `package-lock.json` hashes now match the current files. |
| Bundle **r8** | `SHA256SUMS` digest **`10797ff117c8cddc3271fe3573e236f82979e1d3f14a59a750f1443661e422bd`**: 10 image archives and 22 install files, 1.30 GB. Exported by the operator to a fresh directory. `bundle verify` OK; inventory = `SHA256SUMS`; no special files; files 0644 (executables 0755), directories 0755, owner = operator; install lock = committed lock. Image archives are byte-identical to r7. |
| Superseded exports (removed; [`bundle/reclaimed.txt`](bundle/reclaimed.txt)) | r7 pre-umask-fix `4200848b…` and r7 `8162ae6a…`. r7 carried defect B5; the suites in §6 ran on r7 and again on r8 where the bundle matters. |
| Client pack | rebuilt from the final commit; see §10 |

## 6. Suites on the new images

The suites ran from frozen `git archive` snapshots. Root-only harnesses (secrets 0400 owned by container UIDs) ran in the repository's test-runner container, as in the r6 run. Failed attempts are kept in the private run directory and summarized in §8.

| Suite | Result |
| --- | --- |
| Fixture integration (real providers) | **137/137** ([`suites/integration-vitest-report.json`](suites/integration-vitest-report.json)) |
| Security AC16/AC17 incl. AC16.16–AC16.18 | **31 PASS, 0 FAIL**, 1 NOTE (AC16.3b, host-local bridge reachability) |
| External-URL scan of the **served assets extracted from the new images** (web client, Swagger UI) plus release metadata and configuration | 88 entries, **0 unclassified**; the proxy's map assets hold only two licence-text links |
| Exact-image ingress/relay boundary (new proxy's nginx + real API) | **104/104** |
| Swagger UI, real Chromium, normal mode | **14/14**: 9 requests, all to the ingress origin; no request before **Execute**; GET and POST executed once each; route 200 and a real 400 validate against the documented schemas; served spec = export; 0 console/CSP errors, 0 failed or aborted requests |
| Swagger UI, provider down (geocoder stopped) | **12/12**: docs and spec still served; Execute on `searchPlaces` returns the typed 503 envelope validating against its schema; the browser's own log line for that 503 is recorded separately and occurs exactly once |
| Lifecycle L1–L14 | **15/15** in 551 s; L4 cutover 29.0 s not ready |
| Tamper T0–T5 (operator, on a copy of r8) | **6/6**; copy restored byte-identical |
| Offline host O0–O5 (r8) | **6/6**; 0 outbound packets |
| Fresh-host restore drill R1–R7 + R4a (r8) | **8/8**; 0 outbound packets |

## 7. Disposable rehearsal (r3 → r8, synthetic fixture)

**Topology** ([`tests/rehearsal/handoff-rehearsal.sh`](../../../../tests/rehearsal/handoff-rehearsal.sh)). Docker drops traffic from a container on one bridge to another bridge's published port (probed before the run), so the real LAN → published port → edge path cannot be reproduced on the VM's own daemon without changing its firewall. The rehearsal therefore ran inside a disposable **rehearsal VM**: a labelled Docker-in-Docker container with its own daemon and firewall. It is attached only to three `--internal`, no-gateway segments (`inhibit_ipv4`: the real VM gets no address or route on them; its routing table was compared unchanged before, during and after). The segments are:
- **clients** `198.18.10.0/24`: the rehearsal VM's "LAN address" `.2`; approved stand-in subnet `198.18.10.128/25`, client `.200`; it excludes every gateway address, so source NAT anywhere would be detected;
- **outside** `198.18.20.0/24`;
- **private** `10.250.0.0/24`, holding a controlled sink.

Inside it, exactly as on the serving VM:
- the nested Seyra host (a disposable host of `iran-offline-host.sh`, installed from **r3, the version the serving host runs**);
- the edge (`infra/edge/edge.sh`), published on the LAN address;
- the relay to the inner PROXY listener.

The preserved host was not reachable from that daemon at all.

**Result, attempt 2 on r8: 28 checks, 0 failures; cleanup left 0 containers, networks or volumes, and the lab directory was removed** ([`rehearsal/summary.txt`](rehearsal/summary.txt)).

| Area | Checks |
| --- | --- |
| Update gate | RH2: a tampered r8 copy (one unlisted symlink) refused before install; install tree and nested images unchanged. RH3: r8 verified, install swapped, images loaded while r3 kept serving. |
| TLS | RT1: CSR read directly by the operator; root → intermediate → leaf import; served file leaf + intermediate, trust anchor = root, `served.json` names/fingerprint. RT2: renewal; the backup holds the full previous chain, root and metadata. RT3: interruption by the installed OPS image's own import; `start` refused while the journal existed; `tls recover` completed. RT4: incomplete new set + wrong-root backup → recover refused, active files and journal unchanged. RT5: intact backup → restored. RT6: proxy serves the imported certificate. |
| Relay grants | RR4: approved client `.200` through the LAN address, the rehearsal VM's Docker DNAT, the edge, the lab network, the nested Docker DNAT and the PROXY listener: 19 checks. They cover TLS name and exact fingerprint, readiness on the dataset, web root, docs + single CSP, spec = export, capabilities, TileJSON/style/sprite/glyph/tile with the client-facing base URL, licence, 421 for unknown Host and for `localhost` on the relay, spoofed forwarding headers ignored, 12 diagnostics variants never served, typed 413 validating against the schema, and direct bypass to the inner listeners getting no response. |
| Relay refusals | RR5: outsider `.20` on the same segment: no response on 8 path classes, also with forwarding headers naming the approved client. The edge logged it **with its real address**, which proves the source path. RR6: nothing published on the rehearsal VM's other segment. RR7: untrusted lab peer forging the approved client: 403 on 8 path classes; missing or malformed PROXY: no response; the ordinary listener is unreachable from the lab network. RR8: the loopback control listener serves without PROXY. |
| Egress (real namespaces) | RE1, 7 checks: host routes go only to the absent sink on internal networks; NEW connections to controlled sinks refused (both reachable from the rehearsal VM itself); the control destination connects; the edge refuses documentation addresses and own-network sinks, its guard counter rose by 15, and its one upstream connects. |
| Rollback | RB0: `edge.sh stop` refused while the relay still answered. RB1: relay trust removed and the relay port unpublished while the edge still held its address. RB2: the relay port answers nobody. RB3: edge stopped and removed. RB4: `tls restore --from` the root-only fixture backup; the proxy serves the restored certificate and CA. RB5: software rollback to r3 (verified install copy + verified image load; old OPS identity). |

**Measured transitions** (control-listener readiness sampled every 0.5 s, so gaps shorter than one sample can be missed; container ids per service; provider identities before/after; [`rehearsal/transitions.txt`](rehearsal/transitions.txt)):

| Transition | Not ready | Recreated | Provider identities |
| --- | --- | --- | --- |
| Update cutover r3 → r8 (`start`) | 2.08 s | api, proxy | equal |
| TLS import → `proxy restart` | 0.51 s | proxy | equal |
| Relay on (`init` relay, `access apply`, `proxy restart`) | 0.51 s | proxy | equal |
| Rollback: relay off | 0 s at 0.5 s sampling | proxy | equal |
| Rollback: `tls restore` + `proxy restart` | 0.51 s | proxy | equal |
| Rollback: software r8 → r3 | 2.53 s | api, proxy | equal |

The data providers (PostGIS, Tegola, Valhalla, Photon, Overpass) were never recreated.

**Attempt 1 on r7** ([`rehearsal/attempt1-r7-summary.txt`](rehearsal/attempt1-r7-summary.txt)): 24 PASS, 4 FAIL.
- RR4 was the style-string harness defect.
- RB1 was defect B5: `tls restore --from` refused for the operator. RB2 and RB3 followed from it, because the proxy was never restarted. In RB3 the new interlock correctly **refused** to stop the edge while the relay still trusted it.
- The bundle was re-exported as r8 after the fix, and the bundle-dependent suites and the whole rehearsal were rerun on r8.

## 8. Resources, outages and retained attempts

- **Supervisor** ([`resources/supervisor.log`](resources/supervisor.log)) sampled every 5 s with abort thresholds: available < 1.5 GiB, swap growth > 512 MiB, free disk < 15 GiB, or the test service not ready three samples in a row while it was expected ready. One heavy workload ran at a time. Over 1,016 samples: **0 aborts**; minimum available 4,491 MiB (during lifecycle); peak swap 299 MiB (+~200 MiB); minimum free disk 36.8 GB.
- **Test outages** ([`outages/synthetic-test-outages.txt`](outages/synthetic-test-outages.txt)) are intentional, on the synthetic fixture stack only: geocoder stopped for the provider-down Swagger runs, and the lifecycle suite's measured windows. They are separate from the maintenance pause (§3) and from the open 18 October readiness 503.
- **Retained failed attempts** (private run directory; durations in [`build/workloads.txt`](build/workloads.txt)):
  - API build over the bridge network;
  - six integration starts against read-only frozen copies (temp dirs, root `node_modules`, fixture path, evidence path, report path);
  - security and URL scan as the plain operator, or without built outputs;
  - Swagger runs: an ajv mount; the provider-down console line; one invocation error that never started the browser;
  - boundary test before the snapshot build;
  - rehearsal attempt 1.

## 9. Observations and open items

- **Overpass shutdown:** Overpass does not exit on SIGTERM within 40 s (exit 137 on every graceful stop). It is harmless to data, but it should be fixed in a later data-image change. Data images were deliberately not rebuilt here.
- **Outbound forwarded TCP:** forwarded (NAT) TCP from Docker bridges was blocked for most internet destinations on 2026-10-19, while host traffic worked. The live LAN path also depends on forwarded replies from the edge, so the cutover verifies an approved device first (DEPLOYMENT_PLAN §3).
- **Client pack modes:** the client pack builder keeps the operator's umask (files 0664). It is a developer handoff without operator material; copy it with the intended modes.
- **Leftover test directories:** small disposable directories (offline/restore labs 7–8, under 40 MB, synthetic) remain under the synthetic area, as after earlier runs. Bundles r1–r6, the build cache and the synthetic stack (stopped) are untouched.
- **Not run:** live LAN cutover, Windows H-01, mobile, load and Iran quality acceptance.

## 10. Final tree

Recorded after the documentation commit: see [`final-tree.txt`](final-tree.txt).
