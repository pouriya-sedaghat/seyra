# Corrections to the c73db85 review (run `2026-10-20-c73db85-corrective`)

This run corrects review [`CLIENT_HANDOFF_C73DB85_REVIEW.md`](https://github.com/pouriya-sedaghat/seyra/blob/review/client-handoff-c73db85/docs/reviews/CLIENT_HANDOFF_C73DB85_REVIEW.md) (reference branch `review/client-handoff-c73db85` @ `4a4d86f`, read with `git show`, not merged). It started from local head `c73db85`, which was not yet pushed. Boundary throughout:
- nothing was deployed to the preserved serving installation;
- no LAN endpoint, certificate, access setting or device trust changed;
- no image was rebuilt;
- `main` is unchanged, PR #1 stays a draft, and nothing was pushed.

## 1. Reproduction first

The reviewer's verifier (`verify-build-rehearse-c73db85.mjs`, SHA-256 in [`verifier/verifier-sha256.txt`](verifier/verifier-sha256.txt)) ran unchanged against an untouched `git archive` of `c73db85` in temporary paths, on the pinned Node 24.21.0. It exited 0, which means **all four defects reproduced**: R1 foreign volume mounted, R2 closed TCP port releases the edge, R3 missing `ping` passes, R4 failed cleanup exits 0 ([`verifier/verifier-at-c73db85.json`](verifier/verifier-at-c73db85.json)).

Desired-behavior regressions were then written and run against the same untouched `c73db85` and against the fix:

| Finding | Regression (actual scripts, recording stand-ins) | `c73db85` | Fixed |
| --- | --- | --- | --- |
| R1 volume ownership + R4 cleanup verdict | `tests/rehearsal/test-rehearsal-guards.mjs` | **24 of 25 FAIL** | 25/25 |
| R2 trust-removal evidence | `tests/security/test-edge-stop.mjs` (every case with the relay port closed) | **19 of 23 FAIL** | 23/23 |
| R3 sink evidence | `tests/offline/test-namespace-egress.mjs` (8 new cases) | **7 of 29 FAIL** | 29/29 |
| Swagger exact origins; requests before Execute | `tests/browser/test-swagger-checks.mjs` | structural: no helper existed; the pre-fix prefix expression is shown accepting a prefix-extended host and port | 14/14 |

Outputs: [`before-after/`](before-after/). The old `edge-stop` test asserted that `nc` exit 1 means "relay trust removed". That assumption was wrong, and the test has been replaced, not kept.

**Reviewer verifier on the fixed tree** ([`verifier/verifier-at-fixed.json`](verifier/verifier-at-fixed.json)):

| Case | Result |
| --- | --- |
| R1 | Not reproduced: `volume inspect` is called and no mount is attempted. |
| R2 | Not reproduced: refused, edge kept. The two R2 controls still refuse as they should. |
| R3 | **Structurally not applicable.** The adapter rewrites one exact `ping` line in the old stand-in, and that line no longer exists (the check no longer relies on ping), so the verifier throws "ping stub changed" before R4. |
| R4 | Checked with an adapted copy whose only change skips that R3 guard ([`verifier/adapted-copy.diff`](verifier/adapted-copy.diff)): not reproduced (FAIL, exit 1). |

The loader error is not counted as proof of anything. The R3 fix is shown by the direct tests above and the real run below.

## 2. Corrections

| # | Change | Where |
| --- | --- | --- |
| R1 | The rehearsal VM's fixed-name `/var/lib/docker` volume is checked on the outer daemon's explicit endpoint before any mount. An absent volume is created with the lab label, then inspected again, which catches a concurrent foreign create. An existing volume must already be this lab's (local driver) and unused. Unlabelled, foreign, in-use and uncertain states (any inspect/create/list error other than "no such volume") are refused with FAIL RV0. | `tests/rehearsal/handoff-rehearsal.sh` |
| R2 | `edge.sh stop` reads the serving installation read-only (`EDGE_INNER_DOCKER_HOST`, `EDGE_INNER_HOME`) and stops only on positive evidence for the edge's exact lab address. Refusals keep the edge and its address (see the R2 detail below). | `infra/edge/edge.sh`, `edge.env.example`, RUNBOOK §6.2 |
| R3 | A sink route counts as isolated only on positive evidence (see the R3 detail below). Tool, exec and daemon errors and empty results fail. ICMP silence alone is never evidence. | `tests/offline/namespace-egress.sh` |
| R4 | Every required removal, the final labelled inventory (containers, networks, volumes), lab-directory removal and the outer route comparison are counted. Any failure is **FAIL RC1** with a non-zero exit. Objects that are not this lab's are never removed; they are reported. The explicit retention policy is that only `OUT` (evidence) is kept. A cleanup-only run no longer needs the rehearsal VM to exist. | `tests/rehearsal/handoff-rehearsal.sh` |
| RB1 | Reads `state/runtime.env` (was `<home>/runtime.env`), parses the peer, and requires every read to succeed. It also checks `settings.json`, the running proxy's environment and the relay-port publication. | driver |
| RE1/RE2 | The positive sink controls (both reachable from the rehearsal VM itself, both removed) are now a required assertion, RE2. | driver |
| Swagger | External requests are judged by exact origin (scheme, host, port) via `URL`, so `https://127.0.0.1:8443.attacker.example` and `:84430` are external. Operation requests while an operation is opened or at Try it out are a failing step. | `tests/browser/swagger-ui.mjs`, `swagger-checks.mjs` |
| Docs | The bridge-TCP cause is "unknown". The evidence shows timeouts, not their cause. Corrected in DEPLOYMENT_PLAN and in the 2026-10-19 record, which also gained a corrections note. | docs |

**R2 detail: what `edge.sh stop` requires.** For the edge's exact lab address, all of these must hold:
1. `state/settings.json` is read and its `relayPeer` is not that address.
2. Exactly one serving proxy container exists, plainly running (not stopped, restarting or paused).
3. That proxy's `SEYRA_RELAY_PEER` is not the address, and without a relay peer it publishes no relay port.
4. `state/runtime.env` has not changed since that proxy was created. This is checked by ctime, which a copy or rename cannot preserve, so the running environment is what a restart would apply.

Any failed read, stale or inconsistent state, or a down proxy refuses and keeps the edge and its address. A refused TCP connection is no longer used at all. `--force` remains the explicit emergency path, with its residual risk printed.

**R3 detail: what proves a sink absent.** All three are required:
1. every host network is `--internal`;
2. Docker's address inventory of those networks holds no container or gateway with the sink address;
3. a bounded probe from the host namespace ends in failed link-layer resolution (neighbour `FAILED`/`INCOMPLETE`, no `lladdr`). The ping only triggers that resolution and must itself have run (exit 0 or 1).

One more defect was found while rerunning the reviewer's verifier on the fix: `edge.sh stop` treated an unrecognized run state as "not running, nothing to stop" (exit 0). It now refuses unless the state is exactly `true` or `false` (`7f8a358`, an extra case in `test-edge-stop.mjs`).

No image input changed after `043993c`, so API/proxy/OPS images and the lock are unchanged; there was no rebuild or relock.

## 3. Pinned runtime

- Standalone regressions: 16 suites, 402/402 before the final edits ([`regressions/summary-pre-commit.txt`](regressions/summary-pre-commit.txt)).
- Build, typecheck and unit (226) pass.
- Final-tree counts are in [`final-tree.txt`](final-tree.txt).

## 4. Bundle r9

| Item | Value |
| --- | --- |
| Directory | `<PREP>/bundle-2026-10-20-vm2-r9`, exported from `7f8a358` by the operator to a fresh directory |
| `SHA256SUMS` digest | **`50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`** |
| Integrity | `bundle verify` OK; inventory = `SHA256SUMS`; no special files; files 0644/0755, directories 0755, operator-owned; install lock = committed lock |
| Changes against r8 | Only `install/infra/edge/edge.sh`, `install/infra/edge/edge.env.example` and `install/docs/RUNBOOK.md` differ. All 10 image archives are byte-identical. |
| r8 | **Retained** for recovery (`10797ff1…`). Its 2026-10-19 rehearsal remains historical evidence of r8 under the old guards. |
| Tamper T0–T5 (operator, copy of r9) | 6/6; the copy was restored byte-identical |
| Offline host O0–O5 (r9) | 6/6; 0 outbound packets |
| Restore drill | Not rerun: no change-related reason. Images, wrapper and OPS are identical to r8, and the drill does not use the edge. |

## 5. Real runs

**Without pausing the service** (tiny labelled objects only; [`r1-real/`](r1-real/)), real R1 checks on the VM's own daemon:
- I planted a fixed-name volume with a foreign lab label, then an unlabelled one.
- Each time the frozen driver failed with **FAIL RV0** before any mount, and no rehearsal VM was created.
- Cleanup then **passed** and **preserved** the planted volume, reporting it as not this lab's.
- I removed my two probe volumes afterwards.

**In the authorized maintenance window** ([`maintenance/README.txt`](maintenance/README.txt)), the preserved installation was paused through its own installed CLI. That was needed only for the real rehearsal's RAM. Under the 5 s supervisor (0 aborts; min. available 4,729 MiB; swap growth 160 MiB; min. free disk 35.2 GB), these ran serially:

1. **Offline host on r9:** O0–O5.
2. **Swagger UI in Chromium, corrected harness** (`7f8a358`, frozen):
   - normal **16/16**, including the new per-operation steps "no operation request while opening … or at Try it out" for getCapabilities and computeRoute;
   - provider-down **13/13** (searchPlaces).
   - Zero external requests by exact origin. Geocoder outage recorded in [`outages/`](outages/).
3. **Rehearsal r3 → r9, attempt 1** ([`rehearsal-r9-attempt1/`](rehearsal-r9-attempt1/)): 29 of 30 PASS.
   - **RB0a FAIL was a harness defect.** With the trust still configured and the proxy stopped, `edge.sh stop` correctly refused (exit 2, edge kept), but on the first evidence item (`settings.json`), whereas the check expected the proxy-state reason.
   - On the same lab, a **real cleanup failure:**
     - I planted an operator-owned 0555 directory in the lab directory;
     - cleanup returned **FAIL RC1, exit 1**, having removed every other owned object;
     - after restoring the mode, the retry returned **PASS RC1, exit 0** on the "VM already gone" path.
4. **Rehearsal r3 → r9, attempt 2** (driver `469e55a`; [`rehearsal-r9/`](rehearsal-r9/)): **32/32, 0 failures**, including cleanup.

| Check (attempt 2) | Result |
| --- | --- |
| RV1, RH1–RH3b, RT1–RT6, RR1–RR8 | as on r8: VM isolation, install/gate/update, TLS lifecycle, relay grants and refusals (19 approved-client checks, outsiders, forger, control) |
| RE1 | 7 checks. The real sink evidence is: internal network; inventory has only the gateway, host and edge; neighbour state for the sink `FAILED` ([`rehearsal-r9/egress-host-sink-probe.txt`](rehearsal-r9/egress-host-sink-probe.txt)) |
| RE2 | both controlled sinks started, reachable from the rehearsal VM (`rc=0 rc=0`), removed |
| RB0 | trust configured and applied: stop refused (settings), edge kept |
| RB0a | **review R2 case:** proxy stopped with the trust configured, relay port closed: stop refused, edge kept; the same proxy started again |
| RB0b | trust removed in `settings.json`/`runtime.env` but not applied: stop refused ("the running proxy still trusts …"), edge kept |
| RB1 | after `proxy restart`: settings, `state/runtime.env`, running proxy all show no peer; relay port unpublished; every read succeeded; edge still running |
| RB1a | trust removed and applied, then the proxy stopped: stop refused ("not plainly running"), edge kept; proxy started again |
| RB2, RB3 | relay closed to the lab network; then the edge stopped **on positive evidence** and was removed |
| RB4, RB5 | `tls restore` from the root-only backup; software rollback to r3 |
| RC1 | every owned object removed; inventory empty; lab directory removed; outer routes unchanged |

Measured transitions (0.5 s sampling): update cutover 2.03 s (api, proxy); every proxy restart about 0.51 s; the two intentional proxy-down tests 0.51 s each (nothing recreated); software rollback 2.55 s (api, proxy). Provider identities were equal throughout.

**Resume.** Ready again at 04:47:14Z, after about 22.7 min of intentional unavailability. The post-resume baseline is identical to the pre-stop one, except memory, load, disk and uptimes:
- the inner containers keep the same ids and images (still r3);
- all four providers are ready with matching identities on the original dataset;
- the loopback ingress answers 200; verify-images 10 OK;
- no outside route and no TLS journal.

The marker was cleared only after this.

## 6. Not executed

The live LAN cutover, Windows H-01, mobile, load and Iran quality acceptance were not run, and neither was the restore drill on r9 (§4). The Overpass shutdown and the 18 October readiness 503 remain open, separate records.
