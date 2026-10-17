# Seyra PR #1 — Independent Review and Required Corrections

Date: 2026-10-17
Reviewed PR: https://github.com/pouriya-sedaghat/seyra/pull/1
Reviewed head: d8d08afa7316ba33740932d8f129b8c5ae0f4e2c
Base: a3460fcb2fed0340796f216fc9081d7e1b132fe3
Verdict: REQUEST CHANGES; keep the PR draft while the findings below are corrected and verified.

## Scope and evidence

GitHub inspection confirmed an open, unmerged draft with 205 changed files, no submitted reviews and no check runs/PR-triggered workflow runs for the reviewed commit. The implementation does contain the subsequent integration/lifecycle/offline evidence absent from the owner's pasted narrative: it is not accurate to describe import as still unfinished solely from that narrative.

The committed test report records 69 unit/contract, 137 real-provider integration, 22 security checks, browser rendering and an isolated-daemon lifecycle/offline run. I read the report, relevant harnesses and recorded browser/lifecycle/offline summaries. These are implementer-recorded results; I did not independently rerun the full Docker/image suites or inspect all 205 files. Iran data, actual mobile SDKs, production load and fresh-host restore remain explicitly untested.

This review examines the ingress/settings, API validation/readiness/providers, routing/proximity, release import/verification/cutover/prune, bundle and geocoder preprocessing paths. Four findings were independently reproduced with the actual checked TypeScript control flow under Node 24.19.0. Docker/SQL/image/checksum effects were stubbed in isolated local fixtures; no daemon, network, real release or customer data was touched. This proves the identified control-flow decisions, not a complete deployed-stack exploit or integration run.

## R1 — P1: loopback mode accepts a non-loopback bind without a LAN allowlist

Source: [layout.ts lines 120–130](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/ops/src/layout.ts#L120-L130), [proxy entrypoint lines 14–18](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/infra/images/proxy/entrypoint.sh#L14-L18), [runtime published port](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/infra/compose/runtime.yml#L153-L155).

Trigger: init/settings with accessMode=loopback, bindAddr=0.0.0.0 and lanCidrs empty. Actual validateSettings accepts it. Compose uses the supplied bind; the proxy omits all client allowlist rules in loopback mode because it assumes the host binding restricts clients. Thus a documented network-control boundary can be bypassed through an ordinary configuration combination before Authentication exists.

Required change: validate access-mode enums and enforce a real loopback bind in loopback mode. Non-loopback binds require explicit LAN mode, valid CIDRs and deny-all fallback. Keep defensive checks at the runtime boundary as appropriate. Reject invalid configuration before changing operational settings.

Regression evidence: negative config tests plus a real ingress test demonstrating that a non-loopback/no-allowlist combination cannot be exposed, while valid loopback and configured LAN access still work. Also reject malformed IPs/CIDRs rather than relying only on octet-shaped regexes.

## R2 — P1: a Compose command failure bypasses activation recovery

Source: [activate.ts lines 128–171](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/ops/src/activate.ts#L128-L171).

Trigger: A is active; B passes verification; the tool enters maintenance, stops A, changes runtime.env and the active descriptor to B, then compose up throws (for example a mount/daemon/container-create error). startStack is awaited outside a recovery try/catch. The restore path only runs if startup returned successfully and waitSameRevision returned false.

Isolated reproduction: the injected up exception propagates, active descriptor is B, pointers still name A, maintenance remains set, and no recovery up is attempted. The existing L3 test makes Photon fail readiness after compose up succeeds; it does not cover this case.

Required change: put the whole post-maintenance transition under exception-safe recovery, retaining a durable prior configuration. Attempt recovery for command/filesystem/probe exceptions as well as not-ready results. If recovery fails, keep maintenance, accurately report both errors, and preserve recoverable state. Address interruptions with an explicit recovery/journal procedure; do not promise atomic multi-service switching.

Regression evidence: injected compose-up/creation failure and a filesystem/config-write failure, plus the existing not-ready case. Assert restored previous descriptor, runtime configuration, pointers and real provider readiness, or a documented fail-closed recovery failure with actionable evidence.

## R3 — P1: prune can delete a release currently being imported or activated

Source: [activate.ts lines 181–200](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/ops/src/activate.ts#L181-L200), [import lock](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/ops/src/import-lock.ts#L67-L85).

Trigger: import B holds import.lock and creates its building manifest. Concurrent prune only preserves active/previous pointers; it ignores the import lock, building status and in-flight activation target. It force-drops B's render database and deletes its release/work directories. Concurrent activation/prune and overlapping activations have no shared mutation exclusion either.

Isolated reproduction: a building release is removed and its DROP DATABASE issued while an import lock remains present. This is a live import destruction path, not just cleanup of an abandoned import. Existing L6 runs pruning after transitions complete.

Required change: define a shared lifecycle exclusion/lease strategy for mutating commands, including import, activation/rollback and prune; protect the in-flight target until pointers are committed. Protect start/stop/settings mutations from incompatible transitions. A simple global mutation lock is acceptable initially if nested calls avoid deadlocks. Do not prune a live building release or recover a live owner. Stale recovery must stay bounded to managed jobs/paths.

Regression evidence: real or deterministic multi-process/barrier tests for import+prune, activation+prune and competing activations; prove no live database/directory is dropped and active/previous/in-flight targets remain coherent. Preserve ordinary stale-import recovery and post-transition pruning.

## R4 — P2: the provider gate permits requests without a verified current revision

Source: [health.ts lines 60–70](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/api/src/services/health.ts#L60-L70), [server startup](https://github.com/pouriya-sedaghat/seyra/blob/d8d08afa7316ba33740932d8f129b8c5ae0f4e2c/apps/api/src/server.ts#L54-L78).

Trigger: gate runs before the first probe completes, or the target provider's identity/status probe is unavailable. It rejects only revision_mismatch; missing snapshots and unavailable entries are admitted. health.start launches a probe asynchronously before the server listens. Consequently the target provider may receive a request despite its served identity being unknown; a successful operation is labeled with the configured dataset even though the marker has not been verified.

Isolated reproduction: gate('routing') accepts before any snapshot, and again after readiness explicitly reports routing unavailable. This contradicts the fail-closed revision-identity claim. A healthy provider may still operate when another provider is down; the requested provider itself must have a recent matching verification.

Required change: require a successfully verified, sufficiently fresh target-provider identity. Refresh/await with bounded timeout or fail with a typed unavailable/mismatch error for unknown, unavailable or stale target state. Preserve per-provider independence during unrelated outages and keep readiness honest. Do not fix this by hardcoding green status or deleting the identity requirement.

Regression evidence: before-first-probe, target unavailable, stale snapshot and mismatch cases must not call the operation adapter. Test recovery to matching status and operation of a healthy target during an unrelated provider outage. Exercise startup/admission at the HTTP level as well as unit logic.

## Reproduction resources

- reproduce-pr1-d8d08af.mjs loads the pinned source using Node's built-in TypeScript transformer. It stubs external effects only; it does not edit application source.
- PR1_d8d08af_evidence.json contains the independently observed results.
- Run against an isolated checkout of the exact reviewed commit with Node 24: node --disable-warning=ExperimentalWarning PATH/TO/reproduce-pr1-d8d08af.mjs PATH/TO/CHECKOUT.
- The reproducer deliberately asserts the old bugs. After corrections it should fail those assertions; convert the cases to desired-behavior regression tests in the real test suites, rather than trying to keep this old reproducer green.

## Follow-up and limits

Fix R1–R4 on feat/map-services-v1 and update PR #1. Rebuild/relock affected custom images; old image evidence does not establish behavior of corrected images. Rerun relevant unit/integration, access and lifecycle/offline cases, updating reported commits and exact statuses. Keep the existing honest Iran/mobile/load limitations.

Fresh-host restore is already marked NOT RUN. Review the documented order (init before restoring secrets, initial schema before plain SQL replay, availability of source PBFs) and execute a real isolated restore drill if resources permit; document/fix failures. Do not relabel prior install/rollback tests as restore evidence. Lightweight CI for typecheck/unit/build would improve ongoing review, but absence of CI alone is not one of these reproduced code defects. No monitoring automation or PR messages were sent by this review, and no merge/deployment was performed.
