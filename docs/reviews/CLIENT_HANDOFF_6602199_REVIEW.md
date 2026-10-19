# Client handoff review: 6602199

Date: 2026-10-19. Verdict: **CHANGES REQUESTED before image builds, rehearsal or deployment.**

Reviewed baseline `d63f1d9310c4a3c51abee3dde832eb36e51b267f` → reported local head `66021999bb8ca2268327ed872b1744e94df43da9` (seven mailed commits). PR #1/main were not changed. The new head was not available from GitHub at review time; this review uses the owner's attached binary/full-index format-patch.

## Evidence identity and scope

- Patch SHA-256: `ae23ca98ab1225f8e48c2da60c737372454281cbd6ec83d6f5a106e54014e666`, matching the owner's value.
- All seven mail headers match the reported sequence. The patch applied cleanly to the reconstructed baseline preimages (only mode/whitespace warnings), and **all 67 final changed-file Git blob hashes match the full-index patch**. See `CLIENT_HANDOFF_6602199_blob_checks.json`. This verifies reviewed content, not a separately fetched commit object/signature.
- Re-ran **175 existing standalone checks**, all passing: reclaim 4, update gate 74, host guard 26, navigation 9, browser verdict 9, seed evaluator 18, development proxy 35. See `CLIENT_HANDOFF_6602199_regressions.json`.
- Independently reproduced the five findings below with `verify-client-handoff-6602199.mjs`, using actual source, temporary certificate hierarchies and recording Docker stand-ins. No Docker daemon, serving host, corporate endpoint or owner input was accessed. See `CLIENT_HANDOFF_6602199_actual_code_evidence.json`.
- Reviewer runtime: Node 24.19.0, OpenSSL 3.0.13; this is not the project's pinned 24.21.0. The sandbox cannot chown files to uid 101, so the TLS reproduction selects the source's explicit unprivileged-test branch using a documented `process.getuid` adapter. No certificate/chain result, filesystem replacement, lock or recovery decision is mocked. Claude must reproduce and add product regressions on the pinned runtime.

## H1 — P2: wrapper does not make the new CA/chain inputs available

Locations: `bin/seyra-maps:35–40`; new CLI flags in `apps/ops/src/main.ts:103–109`.

The host wrapper mounts inputs only for `--pbf`, `--cert` and `--key`. The new mandatory `--ca` and optional `--chain` arguments are passed through unchanged but never mounted/resolved. A normal operator layout with the leaf, public root and intermediates in separate directories therefore fails inside the OPS container, even though module-level validation tests pass. It happens to work if the inputs share an already mounted directory or live below an existing mount; that is not the documented path contract.

Reproduction: run the real wrapper with a Docker argv recorder, using separate input directories. Leaf/key paths are covered by read-only mounts; root/chain paths are not, while both are passed to the CLI.

Required correction: handle every new input flag, resolve relative paths, mount only the needed read-only inputs, deduplicate overlapping mounts and preserve writable service state. Add wrapper-boundary coverage with separate directories, relative paths/spaces, already-mounted service paths and missing inputs. Do not assume co-location with the leaf certificate.

## H2 — P1: unlocked CSR replacement can invalidate a locked import; recovery repeats the failure

Locations: `apps/ops/src/main.ts:101–111`; `apps/ops/src/tls.ts:202–234, 275–310`; `apps/ops/src/activate.ts:261–264` for a related precondition placement.

Only `tls import` acquires the lifecycle lock. `tls csr --replace-pending` and `tls recover` mutate the same files without it. Import validates the pending key, awaits OpenSSL checks, then reads/copies that pathname again. Another CSR can replace the key during that interval.

Deterministic reproduction: the real import holds the kernel flock; its last OpenSSL check is paused and later executed normally. While paused, the actual CSR function replaces the pending key. Import resumes, installs the new certificate with the different key, then throws. Both previous served-file hashes have changed and the replacement journal remains. `tls recover` also throws the key/certificate mismatch: all files match the journal's hashes, so its "completable" branch repeatedly chooses the incompatible pair instead of restoring the valid backup.

This invalidates on-disk TLS provisioning and blocks a subsequent safe start/restart. It does not prove the already-running Nginx immediately stops serving its cached old pair.

Required correction:

- Serialize every TLS mutation, including CSR replacement/recovery and the legacy test initializer, against import/start/restart/activation. Check relevant journal/preconditions **after acquiring** the same lock, not only before waiting for it.
- Stage an immutable snapshot of the exact inputs being validated, and verify the proposed served pair/chain before changing current files. Do not re-read a mutable pending pathname as though it were still the validated key.
- Validate recovery candidates, including pair consistency; fall back to the verified previous pair where appropriate. Retain a safe recoverable state if neither candidate is valid.
- Add deterministic concurrent-command regressions (CSR/import and recover/import), plus interruption/fallback cases. Do not bypass production preconditions just to accommodate incomplete unit fixtures.

## H3 — P2: egress checks can print FAIL and return success

Location: `tests/offline/namespace-egress.sh:26–41, 64–69`.

`fail()` only echoes a message. Without an edge argument the script unconditionally exits 0 after the host-route check. With an edge, a later successful case/echo can mask earlier failures because there is no cumulative failure verdict.

Reproduction: a Docker stand-in returns a valid route for all ten prohibited destinations. The actual script prints `FAIL nested host: 10 destinations are routable` and exits **0**. No packet is sent. A rehearsal that relies on exit status can therefore falsely accept failed isolation.

Required correction: accumulate failures and return nonzero for any failed required assertion, in both host-only and host-plus-edge modes; distinguish execution/tool failures from successful denials. Keep bounded checks and cleanup of only test-owned sinks. Add controlled negative tests for routable hosts, successful forbidden connections, unchanged/missing counters, unreachable allowed upstream and tool errors, plus valid cases.

## H4 — P2: documented certificate rollback rejects its own full-chain backup

Locations: `apps/ops/src/tls.ts:39–40, 105–107, 207–217`; `docs/handoff/DEPLOYMENT_PLAN.md` §4 step 3.

Import serves and backs up `server.crt` as leaf plus intermediates. The documented rollback passes the saved `previous-…/server.crt` to `tls import --cert`, but validation requires that file to contain exactly one certificate. Thus the command rejects an ordinary company-CA backup containing an intermediate. The single-leaf legacy test-CA case does not cover this failure.

Reproduction: two successful imports with a real temporary root → intermediate → server hierarchy; the saved backup has two certificates. Executing the documented rollback arguments fails with `must hold exactly one certificate (found 2); pass intermediates with --chain`.

Required correction: provide a validated restore interface or a consistent separated leaf/chain backup format, and publish commands that work on the actual saved artifacts. Preserve SAN/purpose/key/trust checks; do not merely disable validation. Test successful import → renewal → rollback byte-for-byte on the real backed-up files with an intermediate, including interruption recovery.

## H5 — P2: the advertised ingress 413 violates the exported response schema

Locations: `infra/images/proxy/locations.conf.template:15`; `apps/api/src/api-docs.ts:errorDoc/documentRoute`; route/proximity 413 responses in `docs/openapi/map-services-v1.json`.

Nginx returns `{"error":{"code":"PAYLOAD_TOO_LARGE","message":"request body exceeds 64 KiB"}}`. The new description correctly says ingress errors omit `request_id`, but the machine-readable 413 schema still requires `error.request_id` by copying `ErrorBodySchema`. Generated clients/schema validation therefore reject a normal documented response.

Reproduction: compare the actual configured 413 literal with the actual exported route schema's required list; `request_id` is required and absent. This is a configuration/contract comparison, not a fresh Nginx execution.

Required correction: accurately model API-generated versus ingress-generated errors or supply an appropriate ingress request identifier consistently. Preserve strong API error schemas. Add a test that validates both actual response forms against the served/exported contract, including provider-originated 413, instead of checking only the description/status.

## Additional documentation/packaging observations

- The new proximity documentation says "Valhalla matrix"; the inspected `ProximityService` actually invokes objective-specific `routing.pair()` calls. Correct the wording without changing the routing algorithm.
- "Every response carries dataset_id" is too broad (e.g. liveness and some ingress errors). Align that sentence with actual success/error schemas.
- `INSTALL_PATHS` adds the edge and integration guide but omits the linked `examples/web-dev-proxy/` and `docs/handoff/` pack. Declare which artifacts belong to the developer/off-host handoff and package them separately or include them deliberately; test the assembled links/files before claiming the offline handoff pack is complete. The issuer helper must remain an off-host tool and never carry real keys.

These observations do not establish additional runtime failures beyond H1–H5.

## What this review does and does not approve

The overall API/Swagger/shared-client direction remains accepted, and existing standalone checks pass. This review requests narrowly scoped corrections; it does **not** approve image build/rehearsal on the shared VM or live cutover. No product implementation, PR state or operational file was changed by the reviewer.

Not executed by the reviewer: full 219-unit suite/workspace build, dependency/provenance verification, exact-image Nginx boundary tests, browser/Swagger CSP or Try-it-out checks, Docker topology/egress/lifecycle/offline/restore tests, LAN/Windows/mobile/load tests, live Iran queries or a serving-host identity check. The preparation report's claims for those checks are distinguished from independent evidence here.

Reproduction (in a disposable checkout, temporary directory on a writable local filesystem):

```bash
node path/to/verify-client-handoff-6602199.mjs path/to/checkout path/to/evidence.json
```

On this reviewed pre-fix tree, exit 0 means all five reported defects reproduced. After correction use desired-behaviour regression tests; do not call a changed outcome a reproducer failure that proves correctness by itself. Keep the original readiness incident open, serving host/input preserved, draft PR unchanged and owner manual-push workflow intact.
