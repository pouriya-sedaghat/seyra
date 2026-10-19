# VM2 boundary review at d63f1d9

Reviewed on 2026-10-19. Base: `e7a2175149824f7cba92e47382c464607248f609`. Attached patch head: `d63f1d9310c4a3c51abee3dde832eb36e51b267f` (10 commits).

**Verdict: F1–F4 from the e7a2175 review are closed within the reviewed scope. A normal push of the 25 local commits after origin's 82942c1 to `feat/map-services-v1` is approved. Keep PR #1 draft; this is not approval to merge or claim production acceptance. No further corrective implementation prompt is required for these four findings.**

## Material and independent checks

- Patch SHA-256: `9b394041e80a75262f9f982204b864324a79c20e74356816d1bf65e107c97729`.
- All 10 patches applied to the previously reviewed content. All **222 final changed-file Git blob hashes** match the final patch indexes, including binary artifacts. This validates the received contents, not reconstructed commit-object identities.
- Read the changed OPS admission code, harnesses, navigation helper, regressions, RUNBOOK and new `vm2-2026-10-19-boundary` records. No application code was changed by this reviewer.
- **122 developer-provided regression checks executed independently here:** F1 credit 4, F2 update gate 74, F3 navigation 9, F3 verdict 9, F4 host guard 26. All pass on the supplied final content.
- Before/after checks rerun here: F1 gives 3 failures on e7a2175 versus 0 now; F3 navigation gives 4 versus 0; F4 host guard gives 14 versus 0. The old full F2 suite (which deliberately encounters a blocking FIFO) was not repeated here; a separate actual-block test confirms the original unlisted-link counterexample passes the old gate but is rejected before installation by the new one.
- **Seven additional reviewer scenarios** exercise the actual admission module and update blocks with real temporary files and controlled external boundaries. All pass. Details and runnable source accompany this report.
- Bash syntax checks on the relevant shell scripts and Node syntax checks on all validation `.mjs` files pass.

Reviewer runtime is Node **24.19.0**, not pinned 24.21.0. TypeScript is executed with Node's built-in transformer. The partial review checkout has no installed workspace dependencies. The reviewer did **not** rerun the 170-test workspace suite, full build/typecheck, real Docker/Photon/PBF import, browser or non-root export/load. Those VM results are inspected evidence, not independently repeated provider tests.

## Dispositions

| Finding | Final implementation and verification | Disposition |
| --- | --- | --- |
| **F1: logical sizes credited as reclaimable capacity** | `reclaimableBytes` uses lstat and allocated blocks on the checked device; it excludes symlinks, external/shared hard links, other devices, special and unreadable entries. Internal hard links count once. Render-DB logical size earns zero credit. The actual importer calls `admitImport` before deletion/new release setup, and observed free space is checked again after authorized cleanup. Reviewer scenarios verify refusal preserves the sparse failed store with no cleanup, logical DB size cannot admit it, and an after-cleanup shortfall prevents new writes. Submitted real C1–C7 evidence covers both sparse refusal and allocated reclaim. | **Closed** |
| **F2: an unlisted symlink passes the update gate** | The gate rejects unsupported filesystem entry types and names before payload reads; it also validates relative checksum paths and compares the trusted digest/checksums. Invalid entries are refused before copy/bootstrap. The staged install copy is verified, and copy/move failure status is checked. All 74 regressions pass here. The reviewer's same dangling-link fixture is installed by the old block and rejected without CLI/bootstrap by the new block. Submitted real-host records cover unlisted/listed-file symlinks and FIFO refusal, unchanged install/images and a valid r5→r6 update. | **Closed** |
| **F3: a failed map click counts as a successful visit** | A visit now separates result discovery, selected API feature, click errors and observed viewport. Required visits need `reached === true`. The viewport is read through the client's existing bias-coordinate requests; an unknown viewport fails. Regression tests distinguish rejected/no-op/wrong-place clicks from valid navigation and an already-correct viewport. Per-visit preconditions are reasserted after panel remounts. Both navigation and aggregation checks pass here. | **Closed** |
| **F4: attached hosts bypass lab ownership checks** | Attach, every mutating phase and destructive cleanup now require the exact lab label. Volume removal requires the verified host's expected dedicated mount and no other container using it, or a labelled orphan volume. New volumes are labelled. The 26-check actual-harness regression passes here; it fails 14 checks on the old content. Submitted dummy-host negative evidence and valid labelled-host restore records support the intended real-Docker paths. | **Closed** |

F1's post-cleanup refusal has an explicit distinction: an initial refusal retains the failed build; a later observed-space shortfall may occur after its authorized removal. The latter is reported as such and starts no new build. Storage estimates are not a reservation against other writers.

## Image, bundle and submitted run consistency

The final lock differs from the reviewed e7a2175 lock only in generation time and the **OPS** image:

`sha256:135ef05c476379db3b51165ab816967cd3ba4c789c96fbd2311c9a6221325dc7`

Data-component image identities are unchanged, supporting preservation of existing dataset identities/stores. The submitted r6 bundle's SHA256SUMS digest is:

`f4cb50a07a7bbaaec026ae41b278b7a42db29dc84e9001cba5f21e48c12f827d`

That digest is consistent across the recorded successful update, image verification and tamper run. No image/bundle archives were supplied for independent hashing here.

Inspected r6 summaries record integration 137/137, security 28/0, lifecycle 15/15, tamper 6/6, offline host O0–O5 and restore R1–R7 plus R4a. The labelled-host restore rerun records the missing attach-egress-baseline correction and counter 0→0. These records support the report; their full suites were not rerun by this reviewer.

The final Iran browser JSON contains **572 requests, 0 external, 0 failed and 0 console errors**, with six selected features reached. Their recorded viewport distances round to 0 m. The Azadi screenshot was visually checked and shows the expected square with Persian map labels. These remain exploratory navigation/search fixtures, not owner-approved relevance or load acceptance.

Before/after host records show the same preserved host/container identities and start time, zero restarts, and an unchanged reported PBF SHA-256. The final host snapshot records all four providers ready and egress COUNT 0. That is evidence of no restart/recreation and final recovery; it does **not** establish uninterrupted service quality.

## Observations and practical limits that remain open

- **The degraded browser run is real and retained.** Its JSON has 355 requests with six search 504s, two search 503s and one readiness 503, nine console errors and two unreached visits. The corrected gate reports FAIL. The later quiet-host run passes. Shared-VM memory pressure is a credible reported explanation, but the attached record does not include the cited raw Photon GC/API warning excerpts; those particular causal details are owner-session observations rather than independently verified log evidence here. Preserve them if a root-cause claim is required. This does not explain or close the original 18 October readiness incident.
- **Host/daemon isolation is not resource isolation.** Co-located test stacks can affect the preserved service without changing its identity or uptime. Subsequent heavy tests should use separate resource capacity or a deliberate test window, while retaining before/after service measurements.
- **The update installation is checked, not transactional.** Refused bundles and failed pre-swap copies leave the old install intact. The current valid-update sequence then removes the old install before moving the staged one. A failure after that removal stops safely without bootstrap, but does not automatically restore the old install. The run README's broad “a failure keeps the old tree” wording should be read narrowly/corrected when the record or PR description is next updated; atomic software-install rollback was not established by this fix.
- The capacity estimate can conservatively refuse an import that would fit after dropping a render DB. The 120x sizing policy is still derived from one extract/environment, and finite monitoring can miss short dips.
- Search relevance fixtures, load/latency targets (including heavy low-zoom tiles), target LAN/TLS configuration, a second Iran snapshot update test, mobile execution and licence review remain pending. No Authentication, Relations or SOS development is approved by this review.

## Handoff

The owner can now run a normal `git push origin feat/map-services-v1` from `~/seyra`. Preserve the existing commits; no force push, review-branch merge, main change or PR merge is needed. Keep the current PR draft. Its description should eventually reflect the Iran validation and these reviewed corrections without deleting historical failed-run evidence.

Review artifacts live on `review/map-services-vm2-d63f1d9`, based on the remotely available 82942c1. That branch is for reading reviewer artifacts, not implementation history or merging.

```bash
node docs/reviews/verify-vm2-d63f1d9.mjs /path/to/e7a2175 /path/to/d63f1d9 /path/to/evidence
node tests/validation/test-reclaim-credit.mjs
node tests/validation/test-update-gate.mjs
node tests/validation/test-browser-navigation.mjs
node tests/validation/test-browser-verdict.mjs
node tests/validation/test-host-guard.mjs
```
