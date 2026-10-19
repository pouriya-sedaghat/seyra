# Correct the c73db85 build/rehearsal safety findings

Work in the existing VM-connected Claude Code session on `feat/map-services-v1`, currently expected at local head `c73db85d824a801ff9c31fe958c2ee8da164c496`. Verify local/remote state and preserve all work. The owner has not pushed these 12 commits yet. Do not reset, merge reference branches, push, change main, mark PR ready or contact developers.

Fetch `review/client-handoff-c73db85` and read with `git show` (do not merge):

- `docs/reviews/CLIENT_HANDOFF_C73DB85_REVIEW.md`;
- `docs/reviews/verify-build-rehearse-c73db85.mjs` and the counterexamples JSON;
- retained checks/lock/blob evidence.

Read `CLAUDE.md`, current RUNBOOK/deployment plan and the accepted prior fixes. The submitted patch SHA-256 is `aa05ca6808311ceca889b61f69e3ec469b293b8c9bc33b43a229bf97db9d1131`. The independent review reproduced four new negative cases. Its verifier exit 0 means defects reproduced, not success of the product. Run it unchanged against the unmodified head, in temporary paths, then write desired-behavior regressions before changes.

## Required corrections

1. **R1: protect the rehearsal VM volume before mounting it.** The fixed-name volume currently has no ownership preflight; `docker volume create` can return an existing foreign volume. Check exact daemon, existing object and label before use; verify newly created state and handle errors/races conservatively. Unlabelled, wrong-lab and uncertain state must never reach a read/write mount in the privileged rehearsal VM. Positive owned/new paths must work. Keep every preserved-host guard intact.
2. **R2: remove the false trust-removal inference from edge stop.** A refused/timed-out TCP connection is not proof that persisted relay trust is gone. Ordinary stop must establish removal of the exact peer's persistent and applied authorization, or keep its address reserved. A stopped/restarting proxy, missing state, failed inspection or wrong/stale evidence must refuse without releasing the address. Design the smallest reliable mechanism; do not weaken this to a checkbox/file or use emergency force as the ordinary path. Retain explicit emergency handling and the correct manual rollback order. Correct RB1's runtime-state path and require successful reads instead of counting empty failed output as absence.
3. **R3: fail on invalid/inconclusive sink verification.** Missing ping (127), failed Docker exec/daemon and other tool errors must be nonzero verdicts. A lack of ICMP response alone must not be presented as proof that a gateway/address does not exist. Preserve the intended valid internal sink-route test and controlled destination checks with reliable bounded evidence. Make RE1's positive sink-control results actual required assertions, not just log text.
4. **R4: cleanup must affect the verdict.** Failed required removals/inventory checks, unexpected remaining owned objects or changed outer routes must be FAIL/nonzero. A clean run must pass. Preserve foreign objects and never change global firewall/routing to make the test pass. Retained evidence, if intentional, must have a clear explicit policy rather than silently masking cleanup errors.

Keep B1/B4/B5 and all accepted H1–H5/R1–R2 behavior. Add new negative cases to the existing tests where appropriate; do not preserve the misleading old assumption that nc exit 1 proves authorization removal. Report the old and fixed results with the same desired-behavior tests. The reviewer verifier may stop being structurally applicable after a proper guard redesign; explain that and supply direct tests of the actual implementation rather than treating a loader failure as proof of a fix.

Also make the bounded evidence corrections in the review: mark the bridge-TCP root cause unknown without stronger evidence, and ensure the Swagger test detects operation requests between Try-it-out and Execute and compares exact origins. Add focused regression cases. No broad redesign or new feature intake is requested.

## Execution and scope

Start with source and recording-stand-in tests only; the original serving stack remains running for those. No full Iran import, no live LAN endpoint, no certificate/access/image replacement on the preserved installation and no trust installation.

Run focused regressions, relevant source build/typecheck/unit checks and retained boundary tests. Freeze committed harnesses before real runs; do not edit running copies. Preserve invalid/failed attempts and historical records.

If real disposable rehearsal is needed, the owner already authorized the reversible same-VM pause/resume policy in `plan/map-client-handoff-shared-vm-3431e7e` at `6bbee984b9f96c21887aabe09d50d4c447755e40`; read its complete execution prompt. No new VM or repeat permission request is needed for that scope. Record private identities/backups/recovery instructions, stop only the original inner stack through its own installed CLI, retain its outer host/network/volumes, supervise resources, run heavy tasks serially and restore the unchanged original service before finishing. Use only positively owned disposable objects and never bypass lab guards. Do not pause the service just for shell stand-in tests.

Most fixes are scripts/tests/docs outside image inputs. Keep image identities if inputs did not change. If an OPS helper is necessary, rebuild/relock only affected images and prove all data entries unchanged. Do not run all-image builds or repin packages. Online preparation is permitted; operational rehearsal remains isolated/offline.

When shipped edge/install files change, export a new bundle to a fresh operator-readable directory and record its out-of-band checksum. Retain r8 for recovery and distinguish new evidence from r8's historical successful run. Run affected bundle integrity/tamper/offline checks and the targeted real relay/authorization-removal/rollback/egress/cleanup rehearsal on the new artifacts, including failure cases. Do not rerun unrelated full suites without a change-related reason.

Before ending, remove only this task's owned disposable workloads and verify that the original service is ready on its original dataset/images/config/TLS, with retained volumes and isolation. If a resumed service fails, prioritize restoring that unchanged installation, preserve data and report the exact problem; do not deploy the new build or reimport to conceal it.

Commit fixes and sanitized evidence logically; keep real addresses, host identifiers, keys and owner data out of Git. Return final local head, failing-before/passing-after table, changed files/image/bundle identities, targeted real-run results, recovery verification and unexecuted checks. Keep the manual-push workflow and PR draft. End with a corrected concrete live cutover plan for review, not live execution.
