# Seyra Map Services — test results (phase 1)

## Corrections to review `c73db85` (`2026-10-20-c73db85-corrective`)

Separate run identity; the sections below are earlier records and are unchanged. Record: [`docs/handoff/evidence/2026-10-20-c73db85-corrective/README.md`](handoff/evidence/2026-10-20-c73db85-corrective/README.md).

The reviewer's verifier reproduced R1–R4 on `c73db85`. Desired-behavior regressions before → after:

| Finding | `c73db85` | Fixed |
| --- | --- | --- |
| R1/R4 rehearsal guards | 24 of 25 FAIL | 25/25 |
| R2 edge trust evidence | 19 of 23 FAIL | 23/23 |
| R3 sink evidence | 7 of 29 FAIL | 29/29 |
| Swagger exact-origin and pre-Execute checks | new helper (structural) | 14/14 |

No image changed. Bundle **r9** `SHA256SUMS` `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf` (edge tooling and RUNBOOK only; image archives identical to r8, which is retained).

| Item | Result |
| --- | --- |
| Reviewer verifier on the fix | R1, R2 not reproduced; R3 adapter structurally not applicable (its `ping` line no longer exists); R4 not reproduced (adapted copy that only skips that guard) |
| Real R1 on the VM daemon (no pause) | planted foreign and unlabelled volumes refused before any mount; cleanup preserved them and passed |
| r9 tamper / offline host | 6/6; O0–O5, 0 outbound packets |
| Swagger UI in Chromium (corrected harness) | normal 16/16, provider-down 13/13 |
| Rehearsal r3 → r9 | attempt 1: 29 of 30 (RB0a harness expectation), then a real planted cleanup failure gave FAIL RC1 / exit 1 and the retry passed; **attempt 2: 32/32** incl. RB0/RB0a/RB0b/RB1a refusals, RE2, RC1 |
| Maintenance window | about 22.7 min; serving installation resumed with identical baseline, r3 images, original dataset, ready |
| Not run | live LAN cutover, Windows H-01, mobile, load, Iran quality, restore drill on r9 (no change-related reason) |

## Build and disposable rehearsal `2026-10-19-build-rehearse` (from reviewed head `3431e7e`)

Separate run identity; the sections below are earlier records and are unchanged. Record: [`docs/handoff/evidence/2026-10-19-build-rehearse/README.md`](handoff/evidence/2026-10-19-build-rehearse/README.md).

The run used an owner-authorized window on the shared VM. The preserved serving installation was stopped gracefully, then resumed with its own CLI and every identity unchanged. The new build was not deployed to it, and no LAN endpoint was published.

New images, built from `043993c`:

| Image | Id |
| --- | --- |
| API | `sha256:710d5e37…` |
| proxy | `sha256:b953043a…` |
| OPS | `sha256:8cbabae5…` |

Lock `430f139`; the data components are byte-identical. Bundle **r8** `SHA256SUMS` digest `10797ff117c8cddc3271fe3573e236f82979e1d3f14a59a750f1443661e422bd`.

| Item | Result |
| --- | --- |
| Findings fixed, each with a before/after regression | B1 operator-readable CSR; B2 relay trust removed before the edge stops, plus the `edge.sh stop` interlock (Docker reassigns a stopped container's address at once); B3 namespace egress on lab sink routes; B4 bundle root 0755; B5 `tls restore --from` root-only backups for the operator (found by rehearsal attempt 1) |
| Standalone regressions / unit / build / typecheck | 14 suites all PASS (final tree: see evidence `final-tree.txt`); unit 226 PASS; build and typecheck pass |
| Integration / security / boundary | 137/137; 31 PASS + 1 NOTE (incl. AC16.16–AC16.18); exact-image boundary 104/104 |
| Swagger UI in Chromium | normal 14/14 (no external, console, CSP, failed or aborted requests; no request before Execute; GET+POST; strict schemas); provider-down 12/12 (typed 503) |
| Served-asset URL scan | 88 entries, 0 unclassified |
| Lifecycle / tamper / offline host / restore drill | 15/15; 6/6; O0–O5; R1–R7 + R4a (r8); 0 outbound packets |
| Rehearsal r3 → r8 (synthetic, disposable rehearsal VM, real DNAT → edge → PROXY path) | **28/28** (attempt 1 on r7: 4 FAIL, fixed) |
| Measured not-ready | update `start` 2.1 s (api, proxy recreated); TLS `proxy restart` 0.5 s; relay on 0.5 s; rollback relay off 0 s at 0.5 s sampling, `tls restore` 0.5 s, software 2.5 s; provider identities stable, data containers never recreated |
| Resources | 5 s supervisor, 0 aborts; min. available 4,491 MiB, peak swap 299 MiB, min. free disk 36.8 GB |
| Not run | live LAN cutover, Windows H-01, mobile, load, Iran quality acceptance; the 18 October readiness 503 remains open |

## Client handoff corrections H1–H5 (review of `6602199`)

Record: [`docs/handoff/evidence/2026-10-19-corrective/README.md`](handoff/evidence/2026-10-19-corrective/README.md). All five reviewed defects reproduced on the pinned runtime, and each now has a failing-before/passing-after regression:
- **H1** wrapper inputs: 13 FAIL → 59/59.
- **H2/H4** TLS serialization, staged validation, recovery and full-chain rollback: 12 FAIL → 20/20.
- **H3** egress exit status: 8 FAIL → 13/13.
- **H5** error schema: 7 FAIL → 10/10.
- **Packaging/link inventory:** 2 FAIL → 11/11.

Unit 226 PASS, existing standalone suites 175/175, exact-image boundary 104/104; build and typecheck pass. Image builds, full Docker suites, rehearsal and deployment remain NOT RUN.

## Client handoff preparation (2026-10-19, brief v0.3)

Code, documentation and focused tests; no image, bundle, live setting or endpoint changed. Record: [`docs/handoff/evidence/2026-10-19-prep/README.md`](handoff/evidence/2026-10-19-prep/README.md). Plan: [`docs/handoff/DEPLOYMENT_PLAN.md`](handoff/DEPLOYMENT_PLAN.md).

| Item | Result |
| --- | --- |
| Offline Swagger UI (`/api/docs/`, `/api/docs/json`) and documented OpenAPI | `@fastify/swagger-ui` 5.2.6 pinned and verified. 10 operations with stable ids, summaries, examples and truthful error responses (incl. 413), capabilities schema. Runtime document = export, independent of the dataset; UI local-only, no plugin CSP, no query/remote config, user-triggered requests. Unit/HTTP: PASS |
| Ingress: shared locations, relay listener, diagnostics block, typed 413 | Exact-image nginx boundary test 100/100 |
| OPS: relay settings, `access apply`, `proxy restart`, validated `tls csr/import/status/recover` | 41 new unit tests PASS; legacy `tls init` kept as test-only |
| Web development proxy example | 35/35 against a local HTTPS stand-in |
| Persian seed runner | 18/18 offline evaluation checks; **live Iran measurement pending** |
| Unit total | 219 PASS (was 170) |
| Not run | Image builds/relock/bundle, full-stack suites, browser/Swagger UI check, cutover rehearsal, namespace egress test, Windows/LAN/mobile/load |

## Boundary follow-up `vm2-2026-10-19-boundary` (review of `e7a2175`)

Separate run identity; the sections below are earlier records and are unchanged. Full record: [`docs/validation/iran/vm2-2026-10-19-boundary/README.md`](validation/iran/vm2-2026-10-19-boundary/README.md). Current lock `c75bb0a`: OPS `sha256:135ef05c…`, data components unchanged. Bundle r6 `SHA256SUMS` `f4cb50a07a7bbaaec026ae41b278b7a42db29dc84e9001cba5f21e48c12f827d`.

| Item | Result |
| --- | --- |
| F1: reclaim credit for a failed build | Fixed: only allocated, same-device, unlinked-outside blocks count; the render DB counts 0; free space is re-observed after cleanup. Regression: 3 of 4 cases decided wrongly on `e7a2175`, 0 now. Disposable host C1–C7 PASS (C6 sparse 8 GiB refused, C7 allocated admitted, then re-observed). |
| F2: update-gate entry types | Fixed: only directories and listed regular files with plain names; well-formed `SHA256SUMS`; staged, re-verified install. Regression: 33/74 checks fail on `e7a2175` (accepted symlinks and FIFOs, a blocked gate, an ignored copy failure), 74/74 now. On a disposable host, symlink, listed-symlink and FIFO bundles are refused with no change; valid r5→r6 PASS. |
| F3: browser navigation | Fixed: a visit passes only when the viewport center reaches the selected feature (≤ 250 m), with click errors kept. Regression: 4 wrong cases accepted on `e7a2175`, 0 now. Read-only Iran audit: run 1 FAIL under VM memory pressure from my disposable hosts (504/503); run 2 PASS (572 requests, 0 external/failed/console, 6/6 reached at 0 m). |
| F4: attached-host ownership | Fixed: lab-label check on attach, before every mutating phase, and in drop/volume helpers. Regression: 14/26 checks fail on `e7a2175`, 26/26 now. Real unlabelled and wrong-lab dummies refused with identities unchanged. The valid lab-host restore path PASSes (the rerun includes the I9 baseline fix). |
| Unit / integration / security / lifecycle / tamper / offline / restore (r6) | 170 / 137 / 28 / 15 of 15 / T0–T5 / O0–O5 / R1–R7 + R4a: all PASS; 0 outbound packets |
| Readiness 503 observation | **Still open, not reproduced.** The new 504/503 in run 1 has an attributable memory-pressure signature that the original lacked. |

## Follow-up run `vm2-2026-10-19-followup` (review of `82942c1`)

Separate run identity; the sections below are earlier records and are unchanged. Full record: [`docs/validation/iran/vm2-2026-10-19-followup/README.md`](validation/iran/vm2-2026-10-19-followup/README.md). Current lock `8c27175`: OPS `sha256:7367b56f…`, data components unchanged. Bundle r5 `SHA256SUMS` `d128cce3f691de06c09914c08900bcb9767ff339674cb20ed6f8cc8c18870fde`.

| Item | Result |
| --- | --- |
| V1: update gate before install | Fixed. Regression: 14/19 checks fail on `82942c1`, 19/19 now. On a disposable host, wrong-digest and corrupted-payload updates are refused with no install or image change; valid r3→r4 and r4→r5 updates PASS. |
| V2: browser exit status | Fixed: console errors, declared required visits and script completion count. Regression: 4 bad cases accepted on `82942c1`, 0 now. Read-only Iran audit PASS (504 requests, 0 external, failed or console errors, 6/6 visits). |
| Capacity admission and within-step sampling | Default `minFreeFactor` 120 (measured peak 95.4× + margin); checked before side effects, counting a replaced failed build. Disposable-host scenarios C1–C5 PASS, including a 3 GiB within-step dip that boundary sampling missed. |
| Bundle ownership | Fixed: operator-owned `0644`/`0755` output. The non-root operator verifies, copies, tamper-checks (T0–T5) and `bootstrap-load`s without chown. |
| L14 | Deterministic: prune launched while start holds the lock is refused, and a sequential run now FAILs. r5: PASS. |
| Unit / integration / security / lifecycle / offline / restore (r5) | 160 / 137 / 28 + 1 note / 15 of 15 / O0–O5 / R1–R7 + R4a: all PASS; 0 outbound packets |
| Readiness 503 observation | **Open, not reproduced.** 3 fixture cold starts under tile load and a 120 s read-only warm Iran run: 0 not-ready after first ready. The Iran tiles probe reached 4,288 ms of its 5,000 ms timeout (observation only). |

## Replacement-VM run `vm2-2026-10-18` (owner's VM, real Iran data)

Separate run identity. Everything below this section is the earlier synthetic record, left unchanged except for the Iran row of "Not run / blocked". Its image table is the 2026-10-17 lock; the current lock (`a2d3050`) is listed in the run record. Full record: [`docs/validation/iran/vm2-2026-10-18/README.md`](validation/iran/vm2-2026-10-18/README.md).

- Environment: owner's replacement VM `seyra` (VMware guest, Ubuntu 26.04 LTS, kernel 7.0.0-38, 4 vCPU, 7.2 GiB RAM, 100 GiB ext4 root). Docker 29.9.1 / Compose v5.6.0. Run as a non-root operator.
- Images: all rebuilt from pinned sources on the VM (`f244a25`), then OPS rebuilt twice for the corrections (`d1d1708`, `a2d3050`). Final bundle r3 `SHA256SUMS` `9c4e87daf2c97cbf1b69b12a4bf0b821a3adab62d47ef71c0a96fae97aa969f8`.
- Source: owner's `iran-261017.osm.pbf`, SHA-256 `7060fbb5b6ae23acb20b3a376df8404ebec43c81fbc3b71b78f7cbf9c312198f`, header snapshot `2026-10-17T20:20:51Z` → release `ds-20261017-2d2c87f31d11`.

| Suite | Result on the replacement VM |
| --- | --- |
| Unit/contract | 149 PASS (146 + 3 new regressions) |
| Integration (fixture) | 137/137 PASS on r1, r2, r3 |
| Security (fixture) | 28 PASS, 0 FAIL, 1 NOTE (AC16.3b) on r1, r2, r3 |
| Lifecycle L1–L14 (fixture) | 15/15 PASS on r1, r2, r3 |
| Bundle tamper T0–T5 | 6/6 PASS on r1, r2, r3 |
| Offline host O0–O5 (fixture) | 6/6 PASS on r1, r2, r3; 0 outbound packets |
| Restore drill R1–R7, R4a (fixture) | 8/8 PASS on r1, r2, r3; 0 outbound packets |
| Browser (fixture) | PASS on r1 |
| **Iran import on an isolated offline host** | Attempt 2 FAIL at `geocoder-build` (defect 1); attempt 3 FAIL at `staging-validation` (defect 2); **attempt 4 PASS**: 3,456 s, staging providers-started/tiles/routing/geocoder/Overpass all PASS |
| Iran verify-release, activation, stop/start | PASS |
| Iran exploratory smoke (sequential; not owner-approved fixtures) | search hit@1 23/33, hit@5 32/33; reverse 10/12; routing 14/14 statuses, 12/12 checkable distances in range; proximity 6/6; POIs 32/32; tiles 27/27 |
| Iran browser audit | Run 1 FAIL (2 × `/health/ready` 503, cause undetermined, not reproduced); run 3 PASS (511 requests, 0 external, 0 failed, 6/6 intended areas) |
| Iran backup (no `--include-sources`) and host-1 egress | PASS; 0 outbound packets |
| Iran fresh-host restore from the original PBF (no `--include-sources`) | PASS: R2–R6; `dataset_id` reproduced on a new offline host (3,340 s rebuild); 0 outbound packets |
| Real update test / quality acceptance / load | NOT RUN: second real snapshot, owner fixtures and targets not supplied |

Defects found by the real data, and corrected:
1. Photon 1.3.0 dumps carry `address.other`/`other:<lang>` string arrays (1,191,816 of 1,199,311 Iran places). Preprocessing threw. Fixed in `2df015f` after owner authorization; regression test included.
2. Unknown-name placeholders «؟؟؟؟» became synonym terms without letters (`?`, `????`), and Photon rejected the whole synonym file, so the provider did not start. Fixed in `6a665ae`; regression test included.

Open: `bundle export` writes root-only (`0600`) image archives that a non-root operator cannot verify or load. Also open: the 40× import guard (9.19 GB) is below the ~17 GB transient that the Iran Overpass build needed, and low-zoom vector tiles are heavy (z4 2.1 MB).

**Current record: 2026-10-17, second round**, for the follow-up review of `d967a00` (remaining findings: R3 stale-lock reclamation, R5 backup generations), on branch `feat/map-services-v1` (base `a3460fcb2fed0340796f216fc9081d7e1b132fe3`).
- Commit under test: `31961e1`, i.e. code `419bccc` plus the relocked ops image.
- The first-round record (corrections R1–R4 at `c5c6f3f`) is kept where it was not re-run, and is marked as such. The 2026-10-14 results for `d8d08af` are historical.

**Environment:** a cloud preparation container.
- Ubuntu 24.04.5 LTS, kernel 6.18.44, x86_64, 4 vCPU, 15 GiB RAM.
- Docker Engine 29.8.2, Compose v5.6.0, Node 24.21.0.

This is **not** the customer reference hardware.

**Dataset:** only the synthetic fixture `fixtures/osm/synthetic-v1.osm` was used (fictional objects near 0°E 0°N; PBF SHA-256 `e90c33a2…`, built by `fixtures/osm/build-fixture-pbf.sh`). **No Iran data was available or used.** Every number here is a fixture number, not a capacity, latency or quality claim for Iran.

Status words: PASS / FAIL / NOT RUN / BLOCKED. Evidence files are under `docs/evidence/`.

**Image identities used for these runs** (`infra/dependencies.lock.json`, local content-addressed IDs; no registry digest is claimed for custom images):

| Role | Reference | Image ID | Last changed |
| --- | --- | --- | --- |
| API | `seyra/api:1.0.0-seyra1` | `sha256:55844f00176edab3d979a1dcb2f5991bbe798cd0644da1fe3c131dfa0e528861` | round 1 (R4); built from `327aca4` |
| PROXY | `seyra/proxy:1.0.0-seyra1` | `sha256:4cc83237dfb6cec361e79ba6cd55813439c5fd191c09461c1bf4f9d52c042fc8` | round 1 (R1); built from `327aca4` |
| OPS | `seyra/ops:1.0.0-seyra1` | `sha256:6da5438553a1ae1df54ab42609c283ee1154d2c80f459af64d2048b02e7e5daf` | **round 2** (R3 kernel-flock lock, R5 backup generations); built from `419bccc`. Round 1: `sha256:18ea8ed0…704f` |
| DB | `postgis/postgis:17-3.5` | `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` | unchanged |
| TEGOLA | `seyra/tegola:0.21.2-seyra1` | `sha256:28934a38499e5a1f58f54634f5a4fc340af623fee3cb9df2333902214c5f0370` | unchanged |
| VALHALLA | `seyra/valhalla:3.9.1-seyra1` | `sha256:58448d47eaef78b09877d651ef3c4ae24344707f6896659b71f32a44fa105204` | unchanged |
| PHOTON | `seyra/photon:1.3.0-seyra1` | `sha256:2f6c0e27a9410f2107bb84f40bd89ebe04f2d1a59e17b97968c2d99b85639f2c` | unchanged |
| OVERPASS | `seyra/overpass:0.7.62.4-seyra1` | `sha256:e0c93b85d690a7337fbb02440da1a2959c467c225c300b04656c2f90620363a3` | unchanged |
| OSMTOOLS | `seyra/osmtools:2.3.1-1.19.1-seyra1` | `sha256:48e8fdfe6685e25008956ed238bb7d13b76046aa0ddf8e2a610ce56b16ca3e2f` | unchanged |
| GEOCODER_BUILD | `seyra/geocoder-build:5.3.2-1.3.0-seyra1` | `sha256:7c3a11c1e76b4768610eaab7df23a7620deb01df349bcaa7776f7c302892db86` | unchanged |

The data-component images did not change, so the existing releases and dataset IDs remain valid.

## PR #1 follow-up (review of `d967a00`): R3 stale-lock reclamation, R5 backup generations

Both findings were first reproduced on `d967a00` with the reviewer's harness (`docs/reviews/verify-pr1-d967a00.mjs` on the review branch) under Node 24.21.0: `R3-stale-reclaim: FAIL` and `R5-backup-set: FAIL` (`docs/evidence/pr1-followup/reviewer-harness-prefix-d967a00.json`). Desired-behaviour regressions were then added to the project's test suites. They were run against the unfixed code, where they fail, and against the fix, where they pass. That evidence is in `docs/evidence/pr1-followup/`.

| Finding | Correction | Regression: before the fix (`d967a00`) | Regression: after the fix | Real-process / real-host evidence (rebuilt image) |
| --- | --- | --- | --- | --- |
| **R3** (P1): two commands recovering a crashed owner's lock could interleave so that one unlinked the other's live lock and both entered | `207ef32`. `state/lifecycle.lock` is an exclusive kernel `flock(2)` on the command's own open file description. util-linux `flock` (already in the pinned Ubuntu base) locks the inherited descriptor and exits. The kernel releases the lock when the process or ops container ends, so nothing is ever reclaimed or unlinked. The file only carries the owner record; a leftover record plus an unfinished transition still admits only `recover`. Each acquisition verifies the filesystem enforces `flock`. Re-entrancy, bounded waits and fresh-home `init` are unchanged; `status` reports held vs leftover. | `lock-race.test.ts`: the reviewed interleaving (two real OS processes; one paused just before its unlink while the other recovers) **FAILS**: "processes inside the critical section at once: inside-a, inside-b". 4 property tests pass. (`R3-race-test-prefix.txt`) | **5/5 PASS, 10/10 repeats**: at most one process inside, holder's record intact; live contention fail-fast + bounded wait; SIGKILLed holder releases; crashed owner + transition admits only `recover`. `lifecycle.test.ts` (16) uses real `flock` holders. (`R3-race-test-postfix.txt`) | Lifecycle **L13**: an `activate`'s ops container killed while holding the lock mid-transition; `recover`, `prune` and `activate` started together in separate containers; only `recover` ran, the other two were refused, A served again. **L14**: a `stop`'s container killed holding the lock; `start` took over, `prune` refused as busy. Owner records sampled every 0.1 s (`lifecycle/L13-owners.txt`, `L14-owners.txt`). L9–L11 (live import, activation, rollback contention) still pass. |
| **R5** (P2): restore picked the newest SQL, state and manifest files independently and could mix an interrupted backup's SQL with an older backup's state | `a946dc1`. Each backup is one generation, assembled in `.seyra-backup-…partial`. `backup-manifest.json` (role, size and SHA-256 of every file; pointers; release/source identities) is written last, the data is fsynced, and the generation is published by atomic rename. Restore selects exactly one published generation (the newest, `--generation`, or the directory given) and states its choice. It verifies the whole generation before any database change. The old flat layout is refused. | `restore.test.ts`: **10 of 16 FAIL**, including both reviewed cases for the reviewed reason: after an interrupted second backup, the old restore replayed **generation 2's SQL** with generation 1's state; the reviewed flat layout was accepted. Also SQL corruption/truncation, missing manifests and missing/corrupted included sources were accepted. (`R5-restore-test-prefix.txt`) | **18/18 PASS, 5/5 repeats**. Interrupted (failed and killed) backups are never mixed. The flat layout is refused. 11 damage cases are each refused with their specific reason and **zero Docker/SQL calls**. With several generations, the newest is named and `--generation` is honoured. (`R5-restore-test-postfix.txt`) | Restore drill **R2, R4a, R4** (two fresh offline hosts): two real generations plus an interrupted attempt holding a newer real dump with an extra row. A damaged copy was refused with the control DB still empty. Restore selected the newest complete generation, ignored the attempt, and its row stayed absent. R5/R6 rebuilt, served and verified as before. |

The reviewer harness, run unmodified against the fix, passes its R1, R2, R2-ingress, R3-live-import and R4 checks. It then stops at its R3 pre-fix reproduction, because the paused read-then-unlink step no longer exists. That exit code is expected; see `reviewer-harness-postfix.txt`.

## PR #1 review corrections, round 1 (review of `d8d08af`, R1–R4)

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
| AC01 | PASS | unit runs below; `npm run typecheck`, `npm run build` | 146 unit/contract tests (contracts 12, map-assets 6, api 46, ops 82), including the R1–R5 regressions. Serving code has no fixture/mock substitution; mocks exist only in unit tests. |
| AC02 | PASS | `infra/compose/runtime.yml`, lock, lifecycle and offline logs | All four providers start unconditionally; no profiles or toggles; `pull_policy: never`, no `build:` sections. `verify-images`, `import`, `activate` and `start` fail early on a missing or mismatched image. |
| AC03 | PASS (simulated offline host) | `docs/evidence/offline/`, `docs/evidence/restore/` | Install, import, start/restart, update and rollback on a fresh, network-isolated Docker daemon with zero outbound packets (O0–O5, new bundle). Fresh-host restore drill with backup generations (R1–R7, R4a), also with zero outbound packets. Target-hardware repetition pending. |
| AC04 | PASS | `security/external-urls.txt`, browser `report.json`, `tiles.it.test.ts` | Static inventory of every URL in the built web client, the release styles/TileJSON, proxy and provider configs, compose files and entrypoints: 0 unclassified. The only external strings are XML namespaces, library error/doc links and MapLibre's `maplibre.invalid` parsing base. Runtime request audit: 0 external requests. Provider remote fetches are disabled at build: Valhalla without HTTP fetch or elevation/timezone downloads, Tegola without viewer or cloud caches, Overpass without clone/replication/areas, Photon/Nominatim offline import. |
| AC05 | PASS | lifecycle L3–L5, `check-ingress-roles.sh`, unit tests | Same `dataset_id` in manifest, Tegola map name, Valhalla tileset timestamp, Photon marker and Overpass label. Mismatch or missing provider means not ready (L3). Requests with another `dataset_id` get 409, and tiles for another dataset get 404 `DATASET_MISMATCH`. |
| AC06 | PASS | `lifecycle/summary.txt` L1, L2, L9, L12–L14 | Corrupt and truncated inputs are refused at `source-validate`. A killed import is recovered. A live import is protected from a concurrent prune (R3). Killed lock holders never block or break exclusion (L13/L14). The active release's artifact fingerprint is unchanged in every case. Build jobs mount only the new release directory. |
| AC07 | PASS | lifecycle L3–L8, L10, L11, L13 | Provider-start failure (L3), a real `compose up` failure (L7), a failed recovery finished by `recover` (L8), and an activation whose container was killed holding the lock (L13) all end on the previous release, verified through the real ingress. Concurrent mutators are refused (R3). Not zero-downtime, not atomic. |
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

On `31961e1`:

```
npm run typecheck   → OK (all workspaces, TypeScript 6.0.3 strict)
npm run build       → OK
packages/contracts  Tests 12 passed     packages/map-assets Tests 6 passed (style-spec validation of all 4 styles)
apps/api            Tests 46 passed     apps/ops            Tests 82 passed
```

That is 146 tests in total: 127 in round 1, and 69 at `d8d08af`. Regression files:
- `apps/api/src/gate.test.ts` (R4, 9 tests)
- `apps/ops/src/access.test.ts` (R1, 29 tests)
- `apps/ops/src/lifecycle.test.ts` (R2/R3, 16 tests: the real activate/recover/rollback/prune/lock code on a real temporary `SEYRA_HOME`, with only the Docker/SQL boundary simulated and real OS processes as lock holders)
- `apps/ops/src/lock-race.test.ts` (R3 follow-up, 5 tests: two real OS processes running the real lock module, test/lock-worker.mjs)
- `apps/ops/src/restore.test.ts` (R5, 18 tests: the real backup()/restore() with real tar on temporary hosts)

Repeat runs were all green: R2/R3 3 times, R4 5 times, `lock-race` 10 times and `restore` 5 times.

## Real-provider integration suite

`tests/integration` (vitest 5.0.4) runs against the running stack through `https://127.0.0.1:8443`, trusting the generated CA. Re-run on `31961e1` with the images above: **5 files, 137 tests passed** (also 137/137 in round 1):

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

Run on `31961e1` with the images above, real providers and real concurrent CLI processes, each in its own ops container: **14/14 PASS**. Releases: A = `ds-20261001-681455d56afb`, B = `ds-20261008-681455d56afb`, C = `ds-20261009-681455d56afb`. Evidence: `docs/evidence/lifecycle/`.

```bash
SEYRA_HOME=… FIXTURE=…/synthetic-v1.osm.pbf SNAPSHOT_TS=2026-10-08T00:00:00Z SNAPSHOT_TS_L9=2026-10-09T00:00:00Z \
  NODE_BIN=…/node tests/lifecycle/lifecycle.sh    # run from a copy; it must not be edited while running
```

| Case | Result | Detail |
| --- | --- | --- |
| L1 truncated PBF / random bytes | PASS / PASS | Refused at `source-validate`; active release byte-identical and ready. |
| L2 import killed during geocoder-build | PASS | The next import recovers the lease, stops 1 orphaned job, replaces the failed build and validates it; A stays ready. |
| L3 Photon cannot open its index during A→B | PASS | Detected (readiness timeout 90 s for the test); previous release restored, all four providers ready; **130.0 s not ready**. |
| L4 activation A→B | PASS | **35.5 s not ready** (connection refused while the proxy restarts, then maintenance 503). |
| L5 rollback B→A | PASS | **35.0 s not ready**; providers report A's four identities. |
| L6 prune | PASS | Exactly active + previous remain. |
| L7 real `compose up` failure (R2) | PASS | `tests/lifecycle/port-squatter.mjs` binds 127.0.0.1:8443 the moment the old proxy stops, so Docker fails to publish the new proxy (`address already in use`). It releases the port once the failure is journalled. A restored; `runtime.env`, `release.json` and pointers byte-identical; no journal, no maintenance; ready. |
| L8 recovery failure (R2) | PASS | The port stays taken, so restoring A fails too. Both errors are reported, and maintenance plus the journal stay; `activate`, `prune` and `start` refuse. After the squatter exits, `recover` restored A and recreated the proxy Docker had left without its port (`[ingress] … recreating it`); A answers through the real ingress. |
| L9 prune during a live import (R3) | PASS | Prune skipped C ("being built by the running import"); the import completed; `verify-release C` passes. |
| L10 prune during an activation (R3) | PASS | Refused ("another lifecycle operation is running: activate B"); the activation completed; nothing removed. |
| L11 activate during a rollback (R3) | PASS | Refused ("…running: rollback"); the rollback completed (active A, previous B). |
| L12 prune after the transitions | PASS | C removed; A and B kept. |
| L13 lock holder killed mid-transition, then racing mutators (R3 follow-up) | PASS | The ops container of `activate B` (`eb6f7a182a70`) was killed while holding the lock, journal written. `status` then showed the lock free with only a leftover record, plus `UNFINISHED activate`. `recover`, `prune` and `activate B` were started together in separate containers. `recover` took the lock; `prune` and `activate` were both refused with "another lifecycle operation is running: recover". A served again, B was kept, journal and maintenance were cleared, no owner remained. Owner sequence: `activate` (killed) → `recover` → none. |
| L14 lock holder killed without a transition, then racing mutators (R3 follow-up) | PASS | The ops container of `stop` (`3f2efb010c78`) was killed while holding the lock. `start` and `prune` started together: `start` took the lock, `prune` was refused as busy. A was ready after `start`, with no owner left. Owner sequence: `stop` (killed) → `start` → none → `start` (final) → none. |

The real-process cases can only show the interleavings that actually occurred. In L13, `recover` happened to win. The other order, where a mutator takes the lock first and is refused with "ended without finishing; run: seyra-maps recover", is covered deterministically by `lock-race.test.ts` and `lifecycle.test.ts`.

## Security (AC16/AC17) — `tests/security/check-ingress-roles.sh`

Re-run on `31961e1` (its AC16.14/AC16.15 checks run the rebuilt ops CLI): **28 checks PASS, 0 FAIL**, plus one recorded NOTE (AC16.3b, host-local bridge reachability). See `docs/evidence/security/checks.txt`.

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

**Not re-run in round 2**: the API, proxy and web-client images and sources are unchanged since `c5c6f3f`, and the browser audit exercises only those and the providers. Round-1 result on `c5c6f3f`: 62 requests, all to `https://127.0.0.1:8443`. 0 external, 0 RTL-plugin, 0 failed, 0 console errors (PASS). The 2026-10-14 run made 64 requests; the count depends on how many tiles the screenshot viewports load. Persian text uses the local Vazirmatn woff2 `font-faces`; Latin uses SDF PBF range 0-255.

Screenshots:
- `search-light-fa`: Persian search, original Arabic-letter result text, ZWNJ «یک‌طرفه», Persian digit «۳».
- `lam-alef-light-fa`: «پارک لاله آزمایشی» drawn on the map with the lam-alef ligature.
- `light-en`, `dark-fa`, `dark-en`.

Observations:
- Dark theme: road labels on the brown primary road have weak contrast.
- The restaurant label under the search marker is not drawn (symbol collision).

## Offline host (AC03/AC18) — `tests/offline/`

**Bundle (re-exported from `31961e1`):** `bundle export` produced 10 image archives (1.3 GB in total) and 17 install files in 1 min 7 s. SHA256SUMS digest: `5cf828a9f17a3b35a696b2b60be65ca91f80ece2b1cd48d993a4b44b85fab205`. It includes the new OPS image `6da54385…` and the updated install files. The round-1 bundle (`ea9c2a10…`) and the 2026-10-14 bundle (`4241264e…`) are superseded.

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
| O2 init, TLS, import, activate | PASS: `init` on a brand-new `SEYRA_HOME`, taking the new kernel lock; fixture imported with staging validation and activated; ready through `https://127.0.0.1:8443`. The `dataset_id` (`ds-20261001-681455d56afb`) is identical to the preparation host's: same inputs and images give the same release identity. |
| O3 stop / start | PASS: all four providers ready again |
| O4 update and rollback | PASS: update to `ds-20261002-681455d56afb` and rollback, each verified through the ingress |
| O5 outbound attempts | PASS: **0** packets to non-local destinations across O1–O4. 6 link-local IGMP membership reports (224.0.0.0/4, emitted by the kernel when bridge/veth interfaces come up) are counted separately by a dedicated rule. |

Limits of this simulation:
- It ran in a cloud container, not on separate hardware.
- DNS names resolved by Docker's embedded resolver are not visible to iptables. External resolution fails on the internal network (checked in O0), so name lookups cannot reach the outside, but individual lookup attempts were not logged.

## Fresh-host restore drill — `tests/offline/restore-drill.sh`

```bash
BUNDLE=…/bundle-2026-10-17-r2 FIXTURE=…/synthetic-v1.osm.pbf LAB=…/offline-lab DIND_IMAGE=docker:29.8.2-dind tests/offline/restore-drill.sh
```

Re-run in round 2 on the new bundle with the backup-generation format. Two offline hosts are used one after the other, each a fresh Docker-in-Docker daemon on the internal network with the same egress counters as above. Host 1 is destroyed (container, Docker volume and `SEYRA_HOME`) before host 2 is created. Host 2 never sees host 1's Docker state or `SEYRA_HOME`, only the backup root and the separately kept `secrets/` copy. Install and rollback are not counted as restoration. Evidence: `docs/evidence/restore/`.

Result: **R1–R7 and R4a PASS**.

| Case | Result |
| --- | --- |
| R1 source host | PASS: active B `ds-20261002-681455d56afb`, previous A `ds-20261001-681455d56afb`, ready through the ingress; 6 control-DB release events; non-default server names. |
| R2 backup generations | PASS. Two published generations: `seyra-backup-20261017T102959379Z-430836` (only A active, taken before B was activated) and `seyra-backup-20261017T103040653Z-b8c965` (with both managed inputs), each with a SHA-256 completion record (`R2-backup-manifest.json`). Then an **interrupted attempt**: a never-published `.partial` directory holding a newer real `pg_dump`, taken after one extra marker row was added. No secret value or private-key line in the backup or its archives. |
| R3 fresh host, out-of-order restore | PASS: images loaded from the bundle. `restore` before the secrets are back is refused and starts nothing. |
| R4a damaged generation | PASS: a copy of the newest generation with one SQL byte changed is refused ("seyra_app.sql does not match its recorded SHA-256") before any database change. The freshly initialised control DB still has 0 rows; settings untouched. |
| R4 secrets → `init` → `restore` | PASS: restore **selected the newest complete generation and named it** ("newest of 2 complete generations; others: …"), reported the ignored `.partial` attempt, and verified 7 files by SHA-256. The dump then replaced the initialised control DB. All 6 release events are identical (ids and timestamps), and the interrupted attempt's extra row is **absent**. `seyra_api` logs in over TCP with the restored password. Settings restored. |
| R5 rebuild from the printed commands | PASS: one import command per backed-up release, using the generation's verified sources and the operator snapshot timestamps. Both rebuilt with **the same dataset IDs**. |
| R6 activate | PASS: the restored host serves B (previous A) through `https://127.0.0.1:8443`. The restored event history is kept and extended. Secret files are identical to the secrets backup. |
| R7 outbound attempts | PASS: 0 packets to non-local destinations from either host. |

In round 1 (old flat layout), R1–R7 also passed after a harness fix. That layout is now refused, so the round-1 drill no longer describes a supported format.

Limits:
- It ran on the synthetic fixture, in a cloud container.
- The interrupted attempt is the leftover a killed backup produces, placed with a real dump, not an actual kill: the fixture backup finishes in well under a second. The unit tests exercise the real backup code with a failure injected right after its SQL dump.
- Without `--include-sources`, the owner must supply the original input that matches the recorded SHA-256; that path was not exercised end to end.
- A restore on the target hardware remains pending.

## Not run / blocked

| Item | Status | Reason and prerequisite |
| --- | --- | --- |
| Iran extract import/serve (time, RAM, disk, latency, quality) | PASS for import/serve with measured resources; quality and load NOT RUN (run `vm2-2026-10-18`) | Owner dataset supplied 2026-10-18. Two preprocessing defects were found and fixed before the import passed (see the top section). Quality acceptance needs owner-approved fixtures; load needs targets. Was NOT RUN on 2026-10-17 (no owner dataset). |
| Customer hardware / target OS / internal CA / DNS | NOT RUN | Not available; run RUNBOOK §1–2 on the target host. |
| Mobile SDK (Android/iOS, MapLibre Native) | NOT RUN | No mobile project in scope; contract and fixtures prepared. |
| Restore from backup on the target host / without `--include-sources` | NOT RUN | The fresh-host drill passed on simulated offline hosts (above). Repeat RUNBOOK §7 on target hardware; also exercise the path where the owner supplies the original input. |
| Docker Hub direct pulls / ghcr.io | BLOCKED (preparation only) | 429 / egress policy; used the mirror.gcr.io registry mirror and built Valhalla from source. No effect on operation. |
| Load/soak testing | NOT RUN | No capacity targets yet; the phase-1 limits are defaults, not measurements. |
| Browser audit in round 2 | NOT RUN (not affected) | API, proxy and web-client images and sources unchanged since `c5c6f3f`; the round-1 PASS stands. Re-run with `tests/browser/web-client.mjs` if those change. |
| Lifecycle lock on a network filesystem (NFS/SMB) | NOT RUN (unsupported) | `SEYRA_HOME` must be on a local Linux filesystem. Every lock acquisition checks that `flock` is enforced and refuses otherwise; that refusal path was not exercised on a real network share. |
| CI (typecheck/unit/build on push) | NOT RUN | Not set up. This is a useful follow-up, not a substitute for the real-provider, lifecycle and offline suites. |
