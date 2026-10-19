# Run `vm2-2026-10-19-boundary`: four reviewed boundary defects closed

Run identity **`vm2-2026-10-19-boundary`**, on the same replacement VM `seyra`. It implements `prompts/CLAUDE_VM2_BOUNDARY_FOLLOWUP.md` for the findings in `docs/reviews/VM2_e7a2175_REVIEW.md`, both on `origin/review/map-services-vm2-e7a2175` (read with `git show`, not merged).

- **Base:** `e7a2175149824f7cba92e47382c464607248f609`, the 15 commits after `82942c1`, still local at the start; nothing was rebased or reset.
- **Kept, per the review's acceptance:** the 120× reference, the persisted-setting warning, 5 s measurements, bundle ownership, frozen runs, the deterministic L14 and the browser aggregation.
- **Preserved:**
  - The owner's PBF: SHA-256 `7060fbb5…`, checked before and after.
  - `seyra-iran-restore`: container id `73fbd9e9…`, started 2026-10-18T14:01:28Z, 0 restarts, unlabelled, inner container ids unchanged, egress counter 0. That host was **only read**: the browser audits joined its network namespace from the VM daemon, and I read its logs.
  - One consequence to state plainly: while my disposable hosts were running imports next to it, its Photon slowed under VM memory pressure, and the first re-run audit saw 504/503 responses (§3). It recovered on its own; nothing on it was changed or restarted.
- **Disposable test hosts, all created by this lab and removed afterwards:**
  - `seyra-bnd-host`, `seyra-bnd-restore` and `seyra-bnd-restore3` (`LAB=$HOME/seyra-bnd-lab`);
  - two dummy busybox containers for the negative ownership check.
- **Runs** used frozen copies of named commits (`c75bb0a`, `8208e71`, `948443a`); every run directory records its revision (`harness-<stamp>.revision`: commit, tree and per-file SHA-256). The frozen script copies themselves are not committed, as in earlier runs.

| Bundle | OPS image | `SHA256SUMS` digest |
| --- | --- | --- |
| r5 (previous run) | `sha256:7367b56f…` | `d128cce3…` |
| **r6 (`c75bb0a`, current lock)** | **`sha256:135ef05c476379db3b51165ab816967cd3ba4c789c96fbd2311c9a6221325dc7`** | **`f4cb50a07a7bbaaec026ae41b278b7a42db29dc84e9001cba5f21e48c12f827d`** |

Only OPS changed (F1 is product code); data-component identities, dataset IDs and stores are unchanged. The r6 bundle is operator-owned and contains only directories and regular files: 10 image archives and 17 install files, files 0644/0755 ([`bundle-r6/`](bundle-r6/) has the export log, manifest and `SHA256SUMS`).

## Summary

| Finding | Fix | Before (`e7a2175`) → after |
| --- | --- | --- |
| F1 reclaim credit | `f336064` | `test-reclaim-credit.mjs`: the importer's credit admitted 3/4 bad cases (8 GiB sparse, outside symlink, surviving hard link), now 0. The real importer on a disposable host (C6/C7) refuses the sparse case and admits the allocated case, with the post-cleanup check observed. |
| F2 unverified entry types | `70c284d` | `test-update-gate.mjs`: 33/74 checks fail, now 74/74 (the original 19 included). Real host: symlink, listed-file symlink and FIFO bundles are refused before any change; the valid r5→r6 update passes. |
| F3 navigation proof | `fac94d5`, `948443a` | `test-browser-navigation.mjs`: 4/9 wrong (a rejected, no-op or wrong click, or an unknown viewport passed), now 0. Read-only Iran audit: 6/6 visits reached their selected feature at 0 m. |
| F4 attached-host ownership | `955a02d`, `8208e71` | `test-host-guard.mjs`: 14/26 checks fail, now 26/26. Real dummies (unlabelled, wrong lab): restore and readiness refused, identities byte-identical. The valid lab-host restore path passes. |
| OPS-affected suites (r6) | relock `c75bb0a` | All PASS on the r6 bundle with tests frozen from `948443a`: verify-images, integration 137/137, security 28/0, lifecycle 15/15 (L1–L14), tamper T0–T5, offline host O0–O5, restore drill R1–R7 with R4a (§6). |

The reviewer's own verifier (`verify-vm2-e7a2175.mjs`, run unchanged) reproduces all five observations on `e7a2175` ([`reviewer-verifier-at-e7a2175.json`](review-reproduction/reviewer-verifier-at-e7a2175.json)). Against `HEAD` it now stops with an assertion error at its F2 reproduction: it expected the symlinked bundle to be accepted (`rc 0`) and got `rc 1` ([`reviewer-verifier-at-head.err`](review-reproduction/reviewer-verifier-at-head.err)). Its F1 lines still pass, because they call `duBytes` directly; that helper is kept for descriptive sizes, and the importer no longer uses it as credit.

## 1. F1: conservative reclaimable-storage credit

**Policy** (`apps/ops/src/capacity.ts`, RUNBOOK §3):
- **What is credited:** `reclaimableBytes(dir, dev)` counts allocated blocks (`st_blocks × 512`) of regular files and directories, via `lstat`, on the device that `statfs(SEYRA_HOME)` reports.
- **What is not credited:**
  - symlinks, which are never followed;
  - other filesystems (a mount point is not descended);
  - hard-linked inodes with a link outside the tree (an inside pair is credited once);
  - special files and unreadable subtrees;
  - apparent `st_size`, which is recorded only;
  - the failed build's **render DB**, credited **0**: `pg_database_size` is recorded but not treated as an equal `statfs` gain.
- **Admission order** (`admitImport`):
  1. estimate = observed free + reclaim credit;
  2. if insufficient, refuse with **nothing changed** (failed build, DB, other releases and input kept);
  3. otherwise remove the failed build, then compare the **observed** free space with the requirement before any new write, and stop if the removal released less than estimated.
- **Coverage:** SEYRA_HOME's filesystem only. It does not cover a Docker data root on another filesystem or tmpfs. No reservation is claimed against concurrent writers, and space held by still-open files is only released when they close; hence the observed recheck.
- **Recorded:** the manifest's `capacity_check` holds `admission`, `reclaim` (credited and apparent bytes, non-credited counts by reason), `render_db_logical_bytes`, `render_db_credit_bytes: 0` and `after_cleanup`.

**Regressions:**
- **Before/after** ([`regression-e7a2175.txt`](f1-reclaim/regression-e7a2175.txt), [`regression-head.txt`](f1-reclaim/regression-head.txt)): the credit function each revision's `importer.ts` actually uses, near the boundary with that revision's `capacityCheck`.
  - On `e7a2175`, the 8 GiB sparse file (0 allocated) was credited 8,589,934,592 B and admitted. The outside symlink and the surviving hard link were each credited 67,108,864 B and admitted.
  - Now all three are credited 0 and refused, while the ordinary 96 MiB allocated file is still credited 100,663,296 B and admitted.
- **Unit tests** (`capacity.test.ts`, +12): the same fixtures plus an inside hard-link pair, another device, a FIFO (not opened) and an unreadable subtree. They also cover `admitImport`: a refusal does not call cleanup, the render DB is not credited, an admitted case triggers cleanup and then the observed recheck, an after-cleanup shortfall stops before writing, and without a failed build only observed space counts. Unit total: **170** (ops 106; [`unit-summary.txt`](f1-reclaim/unit-summary.txt)); workspace typecheck at `948443a` rc 0 ([`typecheck-948443a.txt`](f1-reclaim/typecheck-948443a.txt)).
- **Real importer on a disposable host**, r6, `capacity-guard.sh` from frozen `c75bb0a`, [`capacity-r6/`](f1-reclaim/capacity-r6/). **C1–C7 all PASS**:
  - **C6:** a killed build holding an 8 GiB sparse file, with `required = free + 4 GiB`, was refused at setup with the build, the sparse file and the render DB kept, and no new build started. The estimate credited only the build's 7,168,000 allocated bytes. (The run's printed size line is empty: busybox `du` lacks `--apparent-size`; the line now uses `stat`, `b8630e1`, with no rerun.)
  - **C7:** the same build plus 3 GiB of allocated data, with `required = free + 2 GiB`, was admitted on 3,228,397,568 B of allocated reclaim. Its apparent 11,818,224,912 B were not credited and the render DB counted 0. After the cleanup the **observed** free space was 37,330,755,584 B ≥ the required 36,244,582,400 B, and the build was rebuilt and validated.
  - **C1–C5** keep their earlier meaning: C1 admission, the C2 within-step dip (a 3 GiB file inside `staging-validation` is the run minimum), C3 refusal before side effects, C4 failed build kept and then replaced, C5 input unchanged.

## 2. F2: the update gate validates entry types before reading payloads

`update_gate` in `iran-offline-host.sh`, block `# >>> update-phase` (`70c284d`) uses coreutils/findutils/grep only and dereferences nothing. It checks, in order:
1. the bundle and `SHA256SUMS` are a real directory and a regular file;
2. every entry is a directory or regular file (no symlink, dangling or not, no FIFO, socket or device) with plain `[A-Za-z0-9._-]` path components (names read NUL-separated);
3. `SHA256SUMS` is well formed: no absolute path, no `.`/`..` segment, no duplicates;
4. the out-of-band digest matches;
5. every listed checksum matches;
6. no regular file is unlisted.

The install tree is then replaced through a staged copy: copy, re-verify the copy against `SHA256SUMS`, remove the old tree, move the new one in. Each step is checked, and any failure ends the run without bootstrap. A refused bundle or a failed copy or re-verification leaves the old tree untouched. The old tree is removed only after the staged copy verified, so a failure of the final move stops safely but does **not** restore the old install. The replacement is not atomic and has no automatic rollback. *(Wording corrected on 2026-10-19 after the d63f1d9 review; the original sentence overstated it as "a failure keeps the old tree".)*

**Regression** ([`regression-e7a2175.txt`](f2-update-gate/regression-e7a2175.txt) → [`regression-head.txt`](f2-update-gate/regression-head.txt)). It adds 11 refused cases to the original 4, each with a 20 s limit.
- On `e7a2175`, **33/74 checks fail**:
  - **Accepted (`PASS U1`), then installed and bootstrapped:** an unlisted symlink, a dangling symlink, an unlisted FIFO, a symlinked bundle root and a symlinked `SHA256SUMS`.
  - **Listed FIFO:** the gate **blocked until killed** (a stuck `sha256sum` was left behind and killed afterwards).
  - **Failing copy:** ignored; the install tree was deleted and bootstrap still ran.
- Now **74/74**, with no blocked process. `ONLY_ORIGINAL=1` reruns the original 19.

**Disposable host** `seyra-bnd-host` (installed from r5), [`f2-update-gate/host/`](f2-update-gate/host/):
- **Refused before any change:** r6 with an unlisted `install/unlisted-link.sql` → `FAIL U1 … l:install/unlisted-link.sql`; r6 with `install/docs/LICENSES.md` replaced by a symlink to identical bytes outside → `l:install/docs/LICENSES.md`; r6 with a FIFO → `p:images/pipe`. Each run exited 1 with the install tree hash, the image-set hash and the OPS image identical before and after. Each run log ends at U1, with no `bootstrap-load` and no files from the requested import phase.
- **Valid r5→r6:** `PASS U1 … 28 listed regular files verified; only directories and listed regular files present`. The host now runs OPS `135ef05c…`, with no staged leftover.

## 3. F3: a visit counts only when the map reached the selected feature

`tests/validation/browser-navigation.mjs` (`fac94d5`, `948443a`) separates the steps, with no product hook:
- **Discovery:** autocomplete and bias are re-asserted off before every visit (the client remounts its search panel, resetting them, e.g. during an outage), so the cards come from one submitted response.
- **Target:** the selected card is matched by OSM id to that response, which gives the coordinates.
- **Click:** a click error is recorded.
- **Viewport center:** read through the client's existing interface (with "bias to map view" on, its search request carries the current center as `bias_lon`/`bias_lat`).
- **Reached:** only within 250 m. A click that changed nothing passes only if the view was already on the target, and an unknown center fails.
- **Verdict:** required visits need `reached === true`. Ranks remain exploratory notes, not owner relevance acceptance.

**Regression** (`test-browser-navigation.mjs` drives each revision's actual helper through a controlled page boundary):
- On `e7a2175`, a rejected click, a no-op click, a ~9 km wrong move and an unknown viewport **all produced PASS** (4 failures).
- Now they fail, valid navigation and already-on-target pass (0 m), and the console-error, incomplete-list and crash aggregations still fail. 0 failures. `test-browser-verdict.mjs` gains a found-but-not-reached case (9/9).

**Read-only Iran audits** against `seyra-iran-restore` (prior reports under `vm2-2026-10-19-followup/` and `vm2-2026-10-18/` unchanged):

| Run | Conditions | Result |
| --- | --- | --- |
| [run 1](f3-navigation/iran-readonly-run1-memory-pressure/) (07:24 UTC, frozen `8208e71`) | My disposable hosts had just run imports and restores; the VM was swapping (≈890 MB swap used, load ≈3.8) | **FAIL**, correctly: 355 requests; 6 search requests answered **504** and 3 answered 503 (one `/health/ready`), with 9 matching console errors. The Tehran and Bazargan visits found no card. The owner API's own log for 07:25:06–07:26:15 shows `DEADLINE_EXCEEDED` (10 s search deadline) and then `PROVIDER_UNAVAILABLE photon`; Photon logged GC overhead at 07:26:19. It recovered by itself (health ready, searches ≈150 ms at 07:27). It also showed biased searches after the panel remounted, which led to re-asserting the preconditions per visit (`948443a`). |
| [run 2](f3-navigation/iran-readonly-run2/) (after removing the disposable host; frozen `948443a`) | 5.4 GB available | **PASS**: 572 requests; 0 external, failed or console errors; 6/6 visits **reached** at rank 1 with the viewport center **0 m** from the selected feature (Azadi Tower `osm:r7814369`, Naqsh-e Jahan `osm:r15540548`, Abyaneh `osm:n27369333`, Zahedan `osm:r7068962`, Bazargan `osm:n244176127`, Shiraz `osm:r8167754`). Host identity unchanged. |

Run 1 is a real, attributable degradation of the preserved host caused by running disposable workloads on the same 7.2 GiB VM. It is **not** offered as the cause of the original 18 Oct 503s: those had no warnings in the API log. That incident stays open (§5).

## 4. F4: lab ownership at every mutating boundary

`iran-offline-host.sh` (`955a02d`, `8208e71`):
- **Where it is checked:** `require_lab_host` on attach, at the start of every mutating phase (update, import, serve, browser, readiness, backup, restore), and inside `drop_host` and `new_host`'s replacement path.
- **What it refuses:** a missing, unlabelled or other-lab container stops the run (exit 2, `REFUSED` in `progress.log`) before any kill, rm, volume rm, run or CLI call.
- **Volumes:** a host's volume is removed only if it is `<name>-docker`, mounted at `/var/lib/docker` by that verified host and used by no other container. A leftover volume without a container is removed only if it is labelled for this lab. New volumes are created with the label, and every rm/volume rm is checked.
- **Read-only access** to a preserved host stays outside the harness (`--network container:<host>`). Nothing labels, restarts or recreates a host the lab does not own.

**Regression** (`test-host-guard.mjs` runs the actual harness with recording `docker`/CLI stubs):
- On `e7a2175`, **14/26 fail**: restore on an attached unlabelled or wrong-lab host issued `docker kill`, `rm -rf` and `rm -f`; readiness issued `cli stop`/`cli start`; an unlabelled orphan volume was deleted; host volumes had no label.
- Now **26/26**, including: the lab's own host is admitted, and a restore onto a preserved target drops only the lab's host 1 and leaves the target untouched.

**Real negative check** ([`negative-dummies/`](f4-host-guard/host/negative-dummies/)): two disposable busybox containers, `seyra-bnd-dummy` (unlabelled) and `seyra-bnd-wronglab` (label `/srv/another-lab`), each with its own volume. `PHASES=restore` and `PHASES=readiness` against each: all four runs exited 2 with `REFUSED … not a disposable host of this lab`. Container id, status, `StartedAt`, restart count, label and volume `CreatedAt` were **identical** before and after.

**Valid path** on the lab's own hosts:
- **Run 1, `seyra-bnd-host` → `seyra-bnd-restore`** ([`f4-valid-restore/`](f4-host-guard/host/f4-valid-restore/)): import, verify, activate, smoke, restart, backup, then R2–R6 (restore refused without secrets, secrets → init → restore, rebuild from the original PBF reproduces `ds-20261001-9843cf36a06e`, serves, 0 outbound). Host 2 and its volume carry the lab label.
  - One harness gap showed up: **I9 FAILed**. A run that attached instead of installing had no `.egress-start` baseline, although the counter read 0. Attaching now records the baseline, and I9 names its starting point (`8208e71`).
- **Rerun, `seyra-bnd-restore` → `seyra-bnd-restore3`** ([`f4-valid-restore-2/`](f4-host-guard/host/f4-valid-restore-2/)): I8, **I9 (0 → 0 since attach)** and R2–R6 all PASS. Safe resumption of the lab's own hosts works.

## 5. Readiness observation (still open)

The original two `/health/ready` 503s of 2026-10-18 remain **unreproduced, with no cause established**. No identity check, readiness semantic or provider timeout was changed.

This run adds one attributable observation: VM memory pressure from co-located workloads can slow Photon past the 10 s search deadline, and then make its probe fail (`PROVIDER_UNAVAILABLE photon` → 503), §3 run 1. The original incident's API log had no such warnings, so this does not explain it.

The diagnostic commands in `vm2-2026-10-19-followup` §6 still apply.

## 6. OPS-affected synthetic suites (r6)

F1 changed the OPS image, so every suite that runs it was repeated on r6.
- **Driver:** [`synthetic-r6/suites-r6.sh`](synthetic-r6/suites-r6.sh), run from the frozen copy of `948443a` ([`frozen-revision.txt`](synthetic-r6/frozen-revision.txt)) on the synthetic fixture.
- **Isolation:** its own `SEYRA_HOME` and labs, with no Iran data.
- **Timing:** it ran 07:30–07:56 UTC, after the final Iran audit. The preserved host was idle apart from its own health probes.

| Suite | Result | Evidence |
| --- | --- | --- |
| `verify-images` (10 locked images, OPS `135ef05c…`) | rc 0 | [`verify-images.log`](synthetic-r6/verify-images.log) |
| Integration (real providers, unchanged sources since `9f0d792`) | 137/137 in 5 files | [`integration.log`](synthetic-r6/integration.log), [`integration/`](synthetic-r6/integration/) |
| Security / ingress roles | 28 PASS, 0 FAIL | [`security-checks.txt`](synthetic-r6/security-checks.txt) |
| Lifecycle L1–L14 (`SNAPSHOT_TS` 2026-10-18/19) | 15/15 PASS in 553 s | [`lifecycle/summary.txt`](synthetic-r6/lifecycle/summary.txt) |
| Bundle tamper, as the plain operator on an r6 copy | T0–T5 PASS; copy restored to `f4cb50a0…` | [`offline/tamper.txt`](synthetic-r6/offline/tamper.txt) |
| Offline DinD host (install, import, restart, update/rollback, egress) | O0–O5 PASS in 349 s; non-local counter 0 → 0 | [`offline/summary.txt`](synthetic-r6/offline/summary.txt) |
| Fresh-host restore drill | R1–R7 and R4a PASS in 482 s | [`restore/summary.txt`](synthetic-r6/restore/summary.txt) |

The r6 image takes the new admission path in L2: the retry after a killed import logged its reclaim estimate, removed the failed build, then logged the **observed** post-cleanup check (`capacity after removing the failed build: … free 46318317568 + reclaimable 0`) before rebuilding ([`L2-recovered.log`](synthetic-r6/lifecycle/L2-recovered.log)).

The preserved host was recorded before and after the batch ([`owner-host-before.txt`](synthetic-r6/owner-host-before.txt), [`owner-host-after.txt`](synthetic-r6/owner-host-after.txt)). The container id, start time, 0 restarts, all seven inner container ids and the non-local egress counter (0) are identical, the PBF SHA-256 is unchanged, and a read-only `/health/ready` returned 200 `ready` on `ds-20261017-2d2c87f31d11` with all four providers `ok`.

## 7. Remaining limitations

- **Reclaim estimate:** conservative by design. A failed build's render DB earns no credit, so a retry near the boundary may be refused although it would fit after cleanup; the observed recheck is authoritative. No space is reserved against other writers.
- **Update gate:** accepts only the generated bundle format (directories, listed regular files, plain names). Any future format with links or other names needs an explicit policy change.
- **Navigation proof:** relies on the client sending `bias_lon`/`bias_lat`. If the client changes that interface, the audit fails closed (unknown center).
- **Shared VM:** test workloads on the same 7.2 GiB VM as the preserved host can degrade it (§3); disposable hosts were removed before the final read-only audit.
- **Still open from earlier runs:** the readiness incident, owner quality fixtures, load targets, LAN configuration, a second Iran snapshot, and mobile/licence review.
