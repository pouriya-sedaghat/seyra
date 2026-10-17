# Claude Code — correct Seyra PR #1 review findings

Repository: https://github.com/pouriya-sedaghat/seyra
PR: #1
Reviewed implementation head: d8d08afa7316ba33740932d8f129b8c5ae0f4e2c
Development branch: feat/map-services-v1
Review branch: review/map-services-pr1-d8d08af

This is corrective implementation within the agreed Map Services phase-1 scope. Do not restart the project, repeat requirements intake or implement Authentication, Relation System, SOS or the mobile application.

## Establish context safely

Inspect status/branch/commit and preserve all local work. Fetch remote refs without resetting or overwriting local changes. Work on the existing feature branch and update PR #1; never develop on main, force push or merge. If the feature head advanced after the reviewed SHA, inspect the intervening changes and revalidate each finding rather than blindly applying stale instructions.

Read CLAUDE.md and the v1.0 brief, requirements, architecture and acceptance register. Read the review from the remote review branch without merging the whole review branch:

    git show origin/review/map-services-pr1-d8d08af:docs/reviews/PR1_d8d08af.md
    git show origin/review/map-services-pr1-d8d08af:docs/reviews/PR1_d8d08af_evidence.json

The reproduction harness is at docs/reviews/reproduce-pr1-d8d08af.mjs on that review branch. It runs the actual checked control flow with isolated external effects, not a full deployed stack. It asserts PRE-FIX defects; after fixing them, create desired-behavior regression tests in the project instead of keeping the old bug assertions green.

## Required corrections

R1 (P1): validateSettings currently accepts loopback + 0.0.0.0 + an empty allowlist. Enforce a real loopback bind for loopback mode; explicit LAN mode with valid CIDRs and deny-all fallback for any non-loopback exposure. Validate mode/IP/CIDR values and fail before persisting/starting unsafe operational settings. Add configuration and actual ingress regression checks.

R2 (P1): automatic activation recovery is bypassed if compose up or another transition operation throws. Protect the full maintenance/drain/config-switch/start/probe transition with exception-safe recovery. Retain recoverable prior configuration, consistent descriptors/pointers and accurate maintenance state. Cover command failure, filesystem/config failure and provider-readiness failure, then test recovery failure too. Do not claim atomic switching or silently swallow errors.

R3 (P1): prune ignores an active import lock/building release and can DROP DATABASE WITH FORCE plus delete its files during a live build or transition. Implement shared lifecycle exclusion/leases that protect live imports, activation targets and conflicting mutators. A straightforward global mutation lock is acceptable if nesting avoids deadlock. Stale-owner recovery must not kill live owners or touch unrelated jobs/data. Add deterministic parallel-process/barrier tests for import+prune, activate+prune and competing activations; preserve stale-import recovery.

R4 (P2): HealthService.gate admits requests before initial verification and when the requested provider's status is unavailable. Require a recent successful identity verification for the target provider, refreshing/awaiting with a bounded deadline or failing with a typed error. Retain the intended ability for a healthy provider to work during a different provider's outage. Test startup, unavailable/missing/stale/mismatch states, adapter not called on rejection, and recovery, including HTTP-level tests.

Do not remove readiness checks, disable required map services, weaken test expectations or substitute mocks in serving paths to make tests pass. Keep all resources and operational assets offline/local.

## Validation and evidence

Run appropriate typecheck/build/unit/contract checks. Rebuild and update actual image locks for every changed custom image. Run real ingress/lifecycle/offline regression scenarios on those image identities where the environment permits. Preserve source datasets and unrelated local state; do not change the developer's global firewall or deploy to a customer/public network.

The existing 69/137/security/browser/offline results are historical implementer evidence, not proof of the corrected commit. Update docs/TEST_RESULTS.md and IMPLEMENTATION_STATUS.md with actual commands, commit/image identities and PASS/FAIL/BLOCKED/NOT RUN. Keep Iran, mobile and production performance limitations explicit.

Also review RUNBOOK's fresh-host restore sequence and execute an isolated restore drill if feasible, addressing secret/password alignment, initialized-schema replay and availability of original map input. Do not count install or rollback as backup restoration. If blocked by disk/tooling, record the exact reason and required run command without overstating completion.

Lightweight CI for typecheck/unit/build is a useful follow-up if available, not a substitute for real provider and lifecycle checks. Do not add scheduled monitoring or send messages to reviewers.

Proceed through the authorized fixes and verification rather than stopping at a plan. Commit coherent fixes to the feature branch and push normally; update the existing PR description/evidence and keep it draft. Return each R1–R4 disposition, changed commits/image identities, regression evidence and remaining blockers. Do not merge or declare production readiness.
