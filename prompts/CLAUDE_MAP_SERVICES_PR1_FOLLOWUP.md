# Correct the remaining PR #1 lifecycle and restore defects

Work in `pouriya-sedaghat/seyra`, on the existing `feat/map-services-v1` branch and draft PR #1. Expected reviewed head: `d967a000cf378af2f4e286fef6bd2ce28bdd2d01`. Preserve unrelated changes. If the head differs, inspect the new commits and map the review to the actual code before editing; never reset or overwrite someone's work.

Read `CLAUDE.md`, the v1.0 Map Services documents and the following review artifacts from `origin/review/map-services-pr1-d967a00`:

- `docs/reviews/PR1_d967a00.md`
- `docs/reviews/PR1_d967a00_evidence.json`
- `docs/reviews/verify-pr1-d967a00.mjs`

Use `git show` or a separate read-only checkout to read those files. Do not merge the review branch. It contains documentation and a reproduction harness, not implementation fixes.

## Scope

Fix only the remaining R3 stale-lock race and the new R5 backup-generation defect, plus necessary tests, offline packaging and documentation. R1, R2 and R4 passed the follow-up's isolated checks; preserve those behaviors. Do not start Authentication, Relations, SOS, mobile implementation, CI or unrelated features. Do not download Iran OSM data.

First reproduce both cases from the review. The reviewer harness executes real TypeScript control flow with isolated Docker/SQL boundaries. Its last two assertions confirm pre-fix failures, so an exit code of 0 is not an acceptance result. Add desired-behavior tests to the actual test suites and show that those regressions fail before your fix and pass afterward. Keep fixes and work on the existing feature branch, not main.

### R3 — stale lifecycle-lock reclamation must preserve mutual exclusion

Two commands can read the old token, then one can unlink the other command's newly acquired live lock. A second read immediately before unlinking is not an atomic ownership check.

Use a reliable interprocess exclusion mechanism that remains safe when two commands simultaneously recover from a crashed owner. Preserve cross-container and same-process behavior, nested rollback → activate, conservative owner handling, init on a fresh home, bounded waits and interrupted-import recovery. Ensure the solution is included in the pinned offline images/bundle if it needs a new dependency.

Required tests:

1. A deterministic two-process race at stale-lock reclamation. At most one critical-section callback may be entered at any time; a live successor's ownership must never be removed by a delayed reclaimer.
2. Ordinary live-holder contention, process/container death, re-entrancy, fresh init and an unresolved transition still behave correctly.
3. Exercise the fix with real concurrent CLI processes/containers after rebuilding, including stale recovery competing with another mutating operation. Record the owner/transition outcomes. Do not rely only on a mock of the lock itself.

### R5 — restore must use one completed backup generation

Restore currently picks newest SQL, state and manifest files independently. An interrupted second backup in the same output directory can silently mix its SQL with an older complete backup.

Publish a coherent, identifiable backup set only after all its required outputs are complete. Validate the selected set before any database mutation. Never assemble a backup from different generations. Either reject an incomplete newest generation with a useful error, or explicitly choose an identified complete generation and report that choice. Document the selection behavior. Account for `--include-sources`, per-file integrity, and older-format backups explicitly; do not silently assume that mixed legacy filenames are a complete set.

Preserve separate secret/TLS backup and the working restore sequence. Update the runbook and drill for the new format.

Required tests:

1. A complete older backup plus a second backup interrupted after its SQL output: no mixed restore and no mutation until a complete selected set has passed validation.
2. Missing or corrupted SQL/state/manifests and any requested included source: refuse before DROP/CREATE/replay.
3. Multiple complete generations: select one consistently and state which one.
4. A successful backup/restore on a fresh isolated offline host using the new format, with control rows, settings, source identities and serving release verified as before.

## Validation and delivery

Run appropriate typecheck/build/unit checks, rebuild and relock affected custom images, and repeat lifecycle/offline/restore scenarios affected by these changes. Re-export the bundle if its images or installed files change; record its new checksum and image identities. Re-run broader existing checks when the changed boundaries justify it. Keep all four providers mandatory and keep install/import/start/update/restore free of external-network dependencies.

Keep secrets, private keys, raw map inputs, generated stores and image archives out of Git. Separate exact completed results from NOT RUN/BLOCKED checks. Do not invent evidence or claim production readiness from the synthetic fixture.

Commit and push normally to `feat/map-services-v1`, update `docs/TEST_RESULTS.md`, `docs/IMPLEMENTATION_STATUS.md` and PR #1's description, and keep the PR draft. Do not merge, force push or alter main. Finish the authorized runs within the session where possible; if an environment constraint blocks a check, give the exact reason and reproducible command.

Return: final head SHA, each fix's commit, the pre-fix/post-fix regression evidence, affected image/bundle identities, completed test results and remaining validation limits.
