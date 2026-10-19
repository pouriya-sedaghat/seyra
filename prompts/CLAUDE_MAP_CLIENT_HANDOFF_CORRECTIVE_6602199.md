# Seyra client handoff: correct H1–H5 before image builds

Continue in the same VM-connected Claude Code session at `~/seyra`, on `feat/map-services-v1`.
Expected local head: `66021999bb8ca2268327ed872b1744e94df43da9`, seven commits above `d63f1d9`. Verify refs/working tree and preserve newer/local work. Do not reset, merge, push or touch main/PR state.

The owner supplied a patch with SHA-256 `ae23ca98ab1225f8e48c2da60c737372454281cbd6ec83d6f5a106e54014e666`; all 67 changed final blobs matched it during independent review. The overall v0.3 architecture remains accepted, but five reproduced defects need correction before the build/rehearsal milestone.

## Read and reproduce

Fetch origin. From `origin/review/client-handoff-6602199`, read these files using `git show`, without merging the branch:

- `docs/reviews/CLIENT_HANDOFF_6602199_REVIEW.md`;
- `docs/reviews/CLIENT_HANDOFF_6602199_actual_code_evidence.json`;
- `docs/reviews/verify-client-handoff-6602199.mjs`;
- `docs/reviews/CLIENT_HANDOFF_6602199_regressions.json`.

Read `CLAUDE.md`, brief v0.3, your deployment plan, and the changed wrapper/TLS/CLI/egress/OpenAPI code. Reproduce the findings against the unmodified local head using the reviewer's verifier, then add desired-behaviour project regressions that fail before and pass after each correction.

The reviewer used Node 24.19.0/OpenSSL 3.0.13, a documented unprivileged-ownership adapter and recording Docker stand-ins. Reproduce on the project's pinned Node 24.21.0 with real temporary certificates and the real lifecycle-lock boundaries. The verifier's exit 0 means the OLD defects reproduced; it is not the final product acceptance suite.

## Required fixes

### H1: mount the actual TLS inputs at the wrapper boundary

`bin/seyra-maps` only handles `--pbf|--cert|--key`; the new `--ca` and `--chain` remain inaccessible if their files are in separate directories.

Resolve and expose every required input read-only, including relative paths/spaces, while preserving writable `SEYRA_HOME`. Avoid duplicate/overlapping mounts that shadow writable state. Reject missing input arguments/files before Docker execution. Test the actual wrapper's argv/mounts using recorders; cover same-directory and separate-directory material, service-local inputs and relative paths. Do not rely solely on module tests that run directly on the host filesystem.

### H2: serialize TLS mutation and validate the exact staged material

The reviewer held the real import lifecycle flock, paused its last OpenSSL check, then replaced the pending key through the unlocked CSR command. Import installed a different key from the one it validated, changed the old served files, threw, and left a journal. `tls recover` then selected the journal-matching but incompatible pair and threw again.

- Put CSR replacement/recovery and every other TLS mutation under the same lifecycle exclusion used by import/start/restart/activation. Evaluate safety preconditions inside the lock. In particular, an activation check made only before lock acquisition is not a sufficient invariant.
- Stage an immutable snapshot and validate the exact key/certificate/chain/trust material that will be installed before altering current files. Prevent a pending-path replacement from changing what is copied after validation.
- Validate recovery candidates and restore a verified prior pair when the proposed files are incompatible; retain a clearly recoverable state if neither is valid. Do not erase or trust a journal merely because filenames/hashes line up.
- Add deterministic concurrent-command regressions for CSR/import and recover/import, plus staged-data mismatch and interrupted replacement/fallback. Preserve valid existing recovery/start/activation scenarios. Give unit fixtures valid TLS prerequisites instead of moving production checks outside their exclusion boundary.

### H3: egress failure must be a failed process

`namespace-egress.sh` can print `FAIL` and return 0, including its unconditional host-only `exit 0`. Implement a cumulative verdict in both modes. Tool/exec errors must not count as successful blocking. Keep checks bounded and clean only test-owned sinks.

Test routable host, forbidden connect succeeds, missing/unchanged drop counter, allowed upstream unreachable and tool failures; each must return nonzero. Valid host-only and host-plus-edge cases return zero. Use controlled command recorders now; actual Docker namespace verification remains for the separately approved rehearsal.

### H4: make rollback work with the saved full chain

The backup's `server.crt` contains leaf plus intermediates, while `tls import --cert` requires one certificate. The documented rollback rejects that backup after a normal company-CA renewal.

Provide a consistent validated backup/restore interface or separated leaf/chain representation, update the commands to match, and test import → renewal → rollback using the actual saved files and a temporary root/intermediate/leaf hierarchy. Preserve key/SAN/purpose/chain checks. Include interruption/recovery and prove the previous served chain/key/trust are restored; no manual PEM editing or validation bypass as the documented solution.

### H5: make the 413 response and machine-readable schema agree

The ingress omits `request_id` while route/proximity 413 schemas require it. Describing the omission in prose does not fix the schema. Model the API and ingress alternatives truthfully or provide the identifier consistently. Preserve strong API error validation and validate both real response shapes against the served/exported schema, including provider-response-too-large cases.

## Small related corrections

Correct "Valhalla matrix" where proximity uses `routing.pair()`, and the claim that every response has `dataset_id`. Define/package the offline client handoff files deliberately: the integration guide links examples/handoff files that `INSTALL_PATHS` currently omits. Use a separate developer/off-host pack if appropriate; never ship issuer keys. Add an artifact/link inventory check rather than claiming an unbuilt bundle was tested.

## Validation and execution boundary

Run the focused new regressions, relevant existing unit/schema/HTTP/temporary-certificate tests, workspace build/typecheck in the required order, and the seven existing standalone suites (175 checks before corrections). Retain failures and exact evidence; make no claim that a reproduction script stopping early alone proves a fix.

The v0.3 shared-VM boundary still applies: no Docker/browser/service workload, image build/relock/bundle, rehearsal, live Iran query, load test, LAN publication, relay startup, host/service restart or live TLS/settings change in this turn. No on-device trust installation. Do not touch the original PBF, preserved serving host or legacy live CA copies. Do not change readiness behavior or claim the original incident resolved.

Do not rebuild data-producing images or change dataset inputs. Complete the independent code, tests, docs and reviewable resource/cutover plan now. Image builds and full Docker/browser/egress/lifecycle/offline/restore suites stay explicitly NOT RUN until safe resources are agreed. Company-CA availability versus a separately managed development issuer also remains an operator decision; it does not block these corrections.

Commit logically on the existing feature branch with a clean final tree and preserve the owner's manual-push workflow. Keep PR #1 draft and main unchanged. Return each H1–H5 disposition, regression-before/after evidence, new head/commits, executed versus pending checks, affected image/build inputs, and the revised concrete rehearsal/cutover/rollback plan. Ask no repeated subnet/client-type questions and do not contact either developer.
