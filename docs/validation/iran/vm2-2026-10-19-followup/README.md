# Run `vm2-2026-10-19-followup`: operational follow-up after the Iran run

Run identity **`vm2-2026-10-19-followup`**, on the same replacement VM `seyra` (Ubuntu 26.04 LTS, 4 vCPU, 7.2 GiB RAM) as [`vm2-2026-10-18`](../vm2-2026-10-18/README.md). It implements `prompts/CLAUDE_VM2_OPERATIONAL_FOLLOWUP.md` and the findings of `docs/reviews/VM2_82942c1_REVIEW.md`, both on `origin/review/map-services-vm2-82942c1` (read with `git show`, not merged).

- Base: `82942c1296e638c8715c021fee49aeb7c540a703`, pushed by the owner. Both geocoder fixes the review accepted (`2df015f`, `6a665ae`) are unchanged.
- Preserved: the owner's PBF `iran-261017.osm.pbf` (SHA-256 `7060fbb5…`, checked before and after) and the serving restored host `seyra-iran-restore` (`ds-20261017-2d2c87f31d11`). That host was only *read*: two bounded diagnostics joined its network namespace from the VM daemon. Nothing was loaded into it, and it was not restarted or reconfigured. Its containers, uptimes and egress counter (0) were the same before and after.
- Disruptive tests ran on disposable offline hosts that this run created and labelled: `seyra-gate-host` (`LAB=$HOME/seyra-gate-lab`) and a dummy safety probe. The synthetic suites ran on the VM daemon's existing fixture home and on fresh DinD hosts.
- Data-component images are unchanged, so every `dataset_id` and the existing geocoder stores are unchanged. Only OPS was rebuilt.

| Bundle | OPS image | `SHA256SUMS` digest | Exported as |
| --- | --- | --- | --- |
| r3 (previous run) | `sha256:489d2a40…` | `9c4e87da…` | root-owned `0600` archives |
| r4 (`d2925a5`) | `sha256:a6e35dce595c1c11016f0aea06500a58fea086bb19feb8e296d910a4abe0a639` | `f977ab1c94f7ab613955e3445eb0848edcae5500fb0e10ed806248ad90a075ac` | operator `owner`, `0644`/`0755` |
| **r5 (`8c27175`, current lock)** | `sha256:7367b56f9f337b61a6e9f5259c3373cb46fb2bdfe2fcafe40767b27d7a61c1bb` | **`d128cce3f691de06c09914c08900bcb9767ff339674cb20ed6f8cc8c18870fde`** | operator `owner`, `0644`/`0755` |

## Summary

| Item | Result |
| --- | --- |
| V1 update gate before any install action | **Fixed.** Regression 14/19 checks fail on `82942c1`, 19/19 pass. On a disposable host, a wrong digest and a corrupted payload are refused with the install tree, image set and OPS image unchanged and dependent phases skipped. Valid r3→r4 and r4→r5 updates pass. |
| V2 browser exit status | **Fixed.** Console errors, the declared required visits and script completion now count. Regression: 4 bad cases accepted on `82942c1`, 0 now. Read-only Iran browser audit: PASS on every check. |
| Frozen execution, deterministic L14, host safety | Done. Harnesses run from recorded read-only copies. L14 FAILs unless prune overlaps start. A container not created by the lab is never replaced. |
| Capacity policy and within-step measurement | **Implemented and tested.** Reference factor 120× with explicit semantics, checked before side effects. Free space is sampled every 5 s within steps. Disposable-host scenarios C1–C5 pass. |
| Operator-readable bundles | **Fixed.** Reproduced through the real wrapper on r3, fixed in r4/r5. The non-root operator verifies, copies, tamper-checks and `bootstrap-load`s without chown. |
| Readiness 503 observation | **Still open; not reproduced.** Diagnostics added. 3 fixture cold starts under tile load and a read-only warm Iran run: 0 not-ready after first ready. The Iran tiles probe reached 4.29 s of its 5 s timeout (recorded below as an observation, not a cause). |
| Synthetic suites on r5 | All PASS: unit 160, integration 137, security 28 + 1 note, lifecycle 15/15 (L14 overlap demonstrated), tamper T0–T5 as the non-root operator, offline host O0–O5 and restore drill R1–R7 + R4a, each with 0 outbound packets |

New harness defects found and fixed during this run (each recorded below): an invalid first capacity C3 check, a C2 claim that was not verified, cold-start trials without tile load, a stale read-only diagnostic copy reused by a later run, and a browser-audit crash with no report.

## 1. V1: the update gate precedes every install action

`tests/validation/iran-offline-host.sh`, block `# >>> update-phase`. `update_gate()` uses only coreutils on the operator host; nothing from the incoming bundle runs. It checks, in order:
1. the digest of `SHA256SUMS` equals the out-of-band value;
2. `sha256sum --quiet --strict -c SHA256SUMS` passes for every listed file;
3. the bundle holds no file that `SHA256SUMS` does not list.

Only after all three pass is the install tree replaced and the incoming wrapper's `bootstrap-load` run. A refusal records `FAIL U1` with the reason and calls `finish`: the run ends, nothing is copied or loaded, and `BUNDLE` is not reassigned. The RUNBOOK §8 operator procedure now states the same order.

**Regression** ([`v1-update-gate/`](v1-update-gate/), `tests/validation/test-update-gate.mjs`). It runs the actual block of a given harness revision with recorders for Docker and the CLI, on temporary bundles:
- On `82942c1`: **14 of 19 checks fail.** With a wrong digest the old block copied the new install tree, ran `bootstrap-load`, reassigned `BUNDLE` and continued. A corrupted payload and an unlisted file even produced `PASS U1`.
- Now: **19/19 pass.**

**Real disposable host** (`seyra-gate-host`, installed from r3):

| Case | Result | Install tree / image set / OPS image |
| --- | --- | --- |
| r4 offered with r3's digest | `FAIL U1 update refused before any install change: SHA256SUMS digest f977ab1c… does not match the out-of-band value 9c4e87da…`; run exit 1; import phase not run | unchanged (`dff3c18f…` / `e936e72c…` / `489d2a40…`) |
| r4 copy with one byte changed in `images/proxy.tar`, `SHA256SUMS` untouched (digest still `f977ab1c…`) | `FAIL U1 … listed file checksums do not match`; run exit 1; import phase not run | unchanged |
| valid r3 → r4 | `PASS U1 … 28 listed files verified; no unlisted files; install tree replaced; all locked images verified` | OPS in host `a6e35dce…` |
| valid r4 → r5 | `PASS U1` (same checks) | OPS in host `7367b56f…` |

These tamper cases ran only on the disposable host.

## 2. V2: the browser audit's exit status matches its claims

`tests/validation/browser-verdict.mjs` is used by `iran-browser.mjs`. Its checks are `external_requests`, `rtl_plugin`, `failed_requests`, `console_errors`, `required_visits` (against a declared count, so a script that stopped early cannot pass vacuously) and `script_completed` (a crash now produces a FAIL report). The run passes only if every check passes. `tests/browser/web-client.mjs` (fixture audit) now also counts console errors. A required visit means "the intended area opened": its rank stays an exploratory observation, not owner quality acceptance.

**Regression** ([`v2-browser-verdict/`](v2-browser-verdict/), `tests/validation/test-browser-verdict.mjs`):
- The `82942c1` predicate accepted a console error, a missing required visit, missing declared visits and a crashed script (**4 failures**).
- The verdict rejects all of them and accepts the successful shape (**0 failures**).

**Iran, read-only** ([`browser-iran-readonly/`](browser-iran-readonly/)). Playwright 1.56.1 ran from the VM daemon inside `seyra-iran-restore`'s network namespace, using the frozen `fd623e7` scripts:
- **PASS:** 504 requests, 0 external, 0 RTL-plugin, 0 failed, 0 console errors; 6/6 required visits, each at rank 1. The scale bar after opening each place (100 m … 3 km) confirms the map moved there.
- The host's egress counter stayed 0.
- Run 1 crashed: a zoom-out step met the disabled control at the style's minimum zoom, then exited 1 **without a report** ([`run1-crash.log`](browser-iran-readonly/run1-crash.log)). Why the map was already at its minimum zoom there was not determined, and the rerun did not hit it. The audit now zooms out only while the control is enabled and reports a crash as `script_completed: false`.

## 3. Frozen execution, deterministic L14, host safety

- **Iran harness:** `iran-offline-host.sh` copies `tests/validation` to a read-only `$OUT/harness-<stamp>/` and records the commit (also from a `freeze.sh` copy), the uncommitted-change count and every file's SHA-256 in `$OUT/harness-<stamp>.revision`. It then re-executes that copy, so editing the repository cannot alter a running script.
- **Other harnesses:** `tests/validation/freeze.sh COMMIT RUN_DIR` prepares a `git archive` copy with read-only `tests/`, `bin/` and `fixtures/`, plus `revision.txt`. Every run in this follow-up names its frozen commit.
- **Stale-copy defect (found and fixed):** files staged from the read-only copy into the lab kept mode `0444`, so a later run's `cp` could not overwrite them and silently used the stale script. One set of cold-start trials ran the old diagnostic this way (§6). Staging now uses `install -m 0644`, and a failed copy stops the run (`dbec020`).
- **L14:** `prune` is launched only after `start` is observed holding the lock, and must be refused with "another lifecycle operation is running: start". A sequential outcome now FAILs as "overlap not demonstrated" rather than passing. Result on r5: PASS. The killed `stop` (`f5b91d3d2753`) was followed by `start` (`40b90986505c`) holding the lock, and the concurrent `prune` was refused: `another lifecycle operation is running: start (started 2026-10-19T05:52:13.895Z)` ([`synthetic-r5/lifecycle/L14-owners.txt`](synthetic-r5/lifecycle/L14-owners.txt), [`L14-prune.log`](synthetic-r5/lifecycle/L14-prune.log)).
- **Host safety:** hosts are named by `HOST1_NAME`/`HOST2_NAME` and labelled `seyra.validation.lab=$LAB`. An existing container without this lab's label is never removed. Shown with a dummy unlabelled container ([`host-safety/`](host-safety/)): exit 2, "it is left untouched", same container ID afterwards. `seyra-iran-restore` carries no label and is therefore protected.

## 4. Capacity policy and within-step measurement

**Derived from the raw 10 s samples of the Iran runs, not from one headline number:**

| Run | Free at import start | Low point (time, step) | Peak use above the start | Retained after import |
| --- | --- | --- | --- | --- |
| Fresh SEYRA_HOME (restore host 2) | 62,999,662,592 | 41,069,465,600 (14:55:54, overpass-build) | **21,930,196,992 = 95.4× input** | 11,083,399,168 (48.2×) |
| Attempt 4 (replaced a failed build) | 51,925,258,240; 61,744,816,128 once the failed build was removed | 41,219,506,176 (overpass-build) | 20,525,309,952 from the post-removal maximum (89.3×) | ≈ 0 net (it replaced a build of the same size) |
| Attempt 3 (replaced a failed build) | 59,758,206,976; max 63,211,905,024 | 42,663,292,928 (overpass-build) | 20,548,612,096 (89.4×) | 6,366,666,752 net |

Input: 229,845,082 B. The importer's own manifest minimum for host 2 was 51,916,546,048, which shows how much boundary-only sampling missed.

**Policy** (`apps/ops/src/capacity.ts`; RUNBOOK §1, §3):
- **What is compared:** `required = max(minFreeBytes, minFreeFactor × input)` against `available = statfs(SEYRA_HOME) + bytes of a failed build of the same dataset_id` (its release directory plus render DB).
- **Default factor:** `minFreeFactor` = **120** (95.4× + ~25 % margin for the 10 s sampling interval, snapshot growth and filesystem reserve). That is 27,581,409,840 B for the Iran input. The 2 GiB floor is unchanged.
- **Order:** the check runs before any side effect. A failed build is removed only after it passes, and a refusal reads `import failed at setup: insufficient free space for <dataset_id> on <SEYRA_HOME>: available … < required …; nothing was changed`.
- **Existing homes:** `init` persists settings, so homes initialised earlier keep `minFreeFactor: 40`. Every import then logs `warning: minFreeFactor 40 is below the measured reference 120`. The guard was not lowered anywhere, and the owner's restore host was not reconfigured.
- **What the check covers:** the filesystem of SEYRA_HOME, where every import byte goes (source copy, render DB under `data/postgres`, Valhalla, the temporary Nominatim DB under `work/`, Photon, Overpass and its temporaries). It does **not** cover a Docker data root on another filesystem (images ≈ 3.6 GB, container logs) or tmpfs.
- **Measurement:** free space is sampled every 5 s and at each step boundary. The manifest records `steps[].free_bytes_min`, `free_bytes_min_observed(_at)`, `free_space_sampling` and `capacity_check`.
- **Limits:** a dip shorter than 5 s can be missed, and another process can still fill the disk. No cancellation path was added, to avoid an unreliable kill/delete path.

**Disposable-host scenarios** (`tests/validation/capacity-guard.sh`, fixture PBF, `seyra-gate-host` on r5, frozen `8c27175`; [`capacity/final-r5/`](capacity/final-r5/)):

| Case | Result |
| --- | --- |
| C1 adequate capacity | PASS: admitted with the figures logged (the floor applies to the tiny fixture). The manifest records `capacity_check`, 5 s sampling (34 samples) and per-step minima, and the import warned that the persisted factor 40 is below the reference. |
| C2 within-step dip | PASS: a 3 GiB file held for 15 s inside `staging-validation` is the run minimum (38,179,172,352 B at 05:01:44.728Z). The previous step's minimum (41,401,937,920) and the free space after the import (41,400,180,736) are ≥ 2.9 GB higher, so boundary sampling alone would have missed it. |
| C3 insufficient, no failed build | PASS: refused at `setup`; no release directory, render DBs and release events unchanged, lease released |
| C4 insufficient with a failed build | PASS: the import was killed mid-build. The next import with insufficient capacity was refused and the failed build (manifest `failed`, render DB) was kept. With adequate capacity it was replaced, counting 16,552,271 reclaimable bytes. |
| C5 | PASS: fixture unchanged; settings restored |

Earlier runs are kept:
- [`run1-harness-defect/`](capacity/run1-harness-defect/): C3 FAILed only because a refused import never logs its id, so the check tested `releases/` itself.
- [`run2-r4/`](capacity/run2-r4/): all PASS, but C2's dip spanned several short steps and its "boundary samples were back up" text was not verified. C2 now asserts it.

## 5. Bundle ownership for the non-root operator

**Reproduced** through the real wrapper on the r3 OPS image, as `owner` (uid 1000, Docker group, no sudo): archives `root:root 0600`, `sha256sum -c` and `cp -a` fail with "Permission denied", and `bootstrap-load` stops at its first checksum ([`ownership-before.txt`](bundle-ownership/ownership-before.txt)).

**Policy** (`applyBundleOwnership`, `09bc34e`):
- Every path `bundle export` writes under `--out` belongs to the owner of `--out`, which the wrapper creates as the invoking operator.
- Directories and executables are `0755`, other files `0644`.
- `--out`'s own mode, all contents and digests, SEYRA_HOME and secrets are untouched.
- Bundles hold image archives and install files only.

**After** (r4, r5): every file is owned by `owner` and world-readable. The operator's `sha256sum --strict -c`, `cp -a` (and the copy re-verifies) and `bundle verify` pass ([`ownership-after.txt`](bundle-ownership/ownership-after.txt)). The non-root operator `bootstrap-load`ed r4 and r5 on the disposable host (§1) and ran the tamper suite on r5 (§7), all without chown.

## 6. Readiness observation: still open

The original incident is kept unchanged ([`../vm2-2026-10-18/iran-run-attempt4/browser-run1-report/`](../vm2-2026-10-18/iran-run-attempt4/browser-run1-report/)): two `/health/ready` 503s about 2 minutes after `start`, with matching console errors.

New tool, `tests/validation/readiness-diag.mjs`:
- **What it does:** a bounded run that polls `/health/ready` and per-provider health every 250 ms. It records ready codes, transitions, per-provider status, latency and a truncated error, while N clients request uncached tiles at random zooms and abandon about 35 % of them.
- **What it never records:** coordinates, tile x/y or query text.
- **How to run it:** the harness phase `readiness` restarts the stack per trial, so it is for disposable hosts only.

| Run | Conditions | Result |
| --- | --- | --- |
| Fixture cold starts, 3 trials ([`cold-start-fixture/`](readiness/cold-start-fixture/), frozen `dbec020`) | `stop`, then `start` with the diagnostic from second 0; 6 tile clients, 150 s | First 200 after 8.3 s each time (≈29 connection refusals, then 1–2 × 502, then 200). **0 not-ready polls after the first ready.** ≈480,000 tile requests per trial, all 200, 0 cancelled (fixture tiles are tiny and cached). Max probe latency: tiles 225 ms, geocoder 572 ms. |
| Invalid earlier fixture trials ([`cold-start-fixture-invalid-runs/`](readiness/cold-start-fixture-invalid-runs/)) | run 1: the tile clients gave up while the API was starting (no tile load); run 2: the stale diagnostic copy | Kept and labelled invalid; not counted. |
| Iran, warm, read-only ([`iran-readonly/`](readiness/iran-readonly/)) | owner host, no restart; 4 tile clients, 120 s, zooms 3–12 over the dataset bounds | **442/442 polls 200, 0 not-ready.** 21,112 tile requests (21,080 × 200, 32 cancelled). Per-zoom maximum render times include **23.8 s at z4 and 16.4 s at z5** (uncached, concurrent). **The tiles readiness probe (which renders z0) reached 4,288 ms, against its 5,000 ms timeout**; p50 265 ms (130–160 ms idle on the earlier run). |

Assessment:
- **Not reproduced**, and the cause is undetermined.
- One mechanism is consistent with the data, but no 503 was observed while it was measured, so it remains a hypothesis to test, not a finding: concurrent uncached low-zoom renders slow Tegola's z0 render, which the tiles probe performs, beyond the 5 s probe timeout; the cached `unavailable` result would then make `/health/ready` answer 503 for a cache period.
- Readiness semantics and timeouts were **not** changed.
- Reproducible command, on a disposable Iran host after import and activation:
  ```bash
  PHASES=readiness READINESS_TRIALS=3 READINESS_SECONDS=150 READINESS_CLIENTS=6 tests/validation/iran-offline-host.sh
  ```
  Or, read-only against a serving host:
  ```bash
  docker run --rm --network container:<host> -v $CA:/ca.crt:ro -e NODE_EXTRA_CA_CERTS=/ca.crt <ops image> /diag/readiness-diag.mjs --seconds 120 --tile-clients 4
  ```
- A cold-start trial on Iran data was not run, because the only Iran host is the owner's preserved one. It needs a disposable Iran host: about 22 GB of transient disk and a 1-hour import.

## 7. Synthetic suites on r5

Bundle r5 (OPS `7367b56f…`), harnesses from the frozen copy of `fd623e7` ([`synthetic-r5/`](synthetic-r5/), batch script [`suites-r5.sh`](synthetic-r5/suites-r5.sh)). Integration ran from the checkout, because it needs that checkout's `node_modules`; its sources are unchanged since `9f0d792`.

| Suite | Result |
| --- | --- |
| Unit/contract (`npm test`) | 160 PASS (12 + 6 + 46 + 96; the 11 new OPS tests are capacity and bundle ownership) |
| `verify-images` on the VM daemon | 10/10 match the r5 lock |
| Integration (fixture) | 137/137 PASS |
| Security | 28 PASS, 0 FAIL, plus the known AC16.3b note |
| Lifecycle L1–L14 | 15/15 PASS in 581 s; L14 overlap demonstrated (§3) |
| Bundle tamper T0–T5 | 6/6 PASS, **run directly as the non-root operator** on an operator-owned copy of r5; restored byte-identical (`d128cce3…`) |
| Offline host O0–O5 | 6/6 PASS, 0 outbound packets |
| Restore drill R1–R7, R4a | 8/8 PASS, 0 outbound packets |

The lifecycle, security, offline and restore harnesses still assume root (they read `0400` secrets and use the DinD socket), so they ran in `seyra-test-runner:local`, as before.

## 8. Low-zoom tiles (design input, unchanged)

Recorded for the later load/UX target discussion; no catalog detail was removed and no provider changed:
- Sequential first fetch (2026-10-18): z4 2,099,808 B in 1.55 s; z6 907,204 B; z8 1,262,720 B.
- Under 4 concurrent clients, uncached: up to 23.8 s at z4.

## 9. Remaining limitations and owner inputs

- **Capacity policy:** derived from one extract on one host. Re-measure for larger extracts, other hardware or pipeline changes. Existing homes keep their persisted factor until changed.
- **Readiness incident:** open (§6). An Iran cold-start trial needs a disposable Iran host.
- **Update test:** the real data update test still needs a second Iran snapshot.
- **Owner inputs, unchanged:** quality acceptance needs approved queries and areas; load needs targets; LAN needs CIDRs, DNS and certificates; mobile and licence review are separate gates.
- **Dataset_id and OPS:** the review notes that future output-changing OPS preprocessing needs explicit pipeline-version/fingerprint treatment. Nothing in this follow-up changes import output.
