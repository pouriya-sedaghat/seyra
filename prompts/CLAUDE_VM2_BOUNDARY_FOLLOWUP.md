# Seyra VM2: close four reviewed boundary defects

Continue in the VM-connected Claude Code session, repository `~/seyra`, branch `feat/map-services-v1`. Expected reviewed head: `e7a2175149824f7cba92e47382c464607248f609` (15 commits after `82942c1`). Inspect current refs and working tree, preserve unpublished/local work and newer commits, and never reset to an older remote head. Keep PR #1 draft and main unchanged. Respect the owner's choice to push the branch themselves.

Read CLAUDE.md, the current Map Services documents, RUNBOOK, and `docs/validation/iran/vm2-2026-10-19-followup/README.md`. From `origin/review/map-services-vm2-e7a2175`, read with git show:

- `docs/reviews/VM2_e7a2175_REVIEW.md`
- `docs/reviews/VM2_e7a2175_evidence.json`
- `docs/reviews/verify-vm2-e7a2175.mjs`

Do not merge the review branch: it contains review artifacts based on the previously available remote head, not your 15 local implementation commits. The earlier follow-up is substantially accepted: retain the 120x reference, persisted-setting warning, five-second measurements, bundle ownership fix, frozen runs, deterministic L14 and improved browser aggregation. This task fixes the four counterexamples in the review.

## F1: conservative reclaimable-storage credit

`importer.ts` now credits `duBytes(setupDir)` before deleting a failed build, but that helper sums logical `stat.size`, follows symlinks and can credit storage deletion will not free. The reviewer reproduced an 8 GiB sparse file with zero allocated blocks receiving an 8 GiB credit, and an outside symlink target receiving credit.

Implement a dedicated conservative reclamation policy. Keep logical measurement helpers separate if still useful. Do not follow symlinks, count another filesystem's storage, double-count shared inode allocations or credit data whose links survive deletion. Unknown/unsupported reclamation may count as zero. Examine the render-DB contribution too: `pg_database_size` must not be asserted to guarantee the same immediate statfs gain. Prefer a conservative decision over an optimistic promise.

Preserve the existing refusal contract: if verified available capacity is insufficient, leave the failed build, its DB, active/previous releases and original PBF unchanged. After authorized cleanup, check observed free space before new import writes. Document what is estimated/observed and which filesystem is covered; no claim of reservation against unrelated concurrent disk writes.

Add regressions that fail before and pass after: sparse file, outside symlink, shared/hard-linked file and the ordinary allocated-file case. Exercise admission near a boundary with the actual importer boundary where practical, not only the pure addition function. Verify no failed-build deletion or build startup on refusal. Retain C1-C5 and low-water-mark behavior.

## F2: reject unverified filesystem entry types before install

The incoming update gate's `find -type f` ignores extra symlinks. The actual block accepts an unlisted `install/unlisted-link.sql`, copies it and calls bootstrap. Later bundle verification is too late to satisfy verify-before-install.

Use trusted existing tools to validate entry types and containment before reading/checking/installing payloads. For the generated bundle format, permitting directories and listed regular files while rejecting symlinks and other special entries is a simple policy. Handle dangling links and paths outside the bundle explicitly; do not silently dereference them. Continue comparing the out-of-band SHA256SUMS digest and every allowed file checksum. Reject before install/image/bootstrap changes and skip dependent phases on failure. Check copy/replacement command failures explicitly as well.

Extend the current actual-block regression with an unlisted symlink and malformed/special-entry cases that terminate safely. Demonstrate unchanged install/image state and zero bootstrap calls for refused updates on a disposable host. Preserve all existing 19 checks.

## F3: prove navigation, not only a matching search card

`searchAndOpen` sets rank, swallows a failed click and returns `found: true`. The actual helper with a rejected click still produces a PASS verdict for six records. The scale bar is currently only a recorded string.

Separate result discovery from successful navigation. Propagate/report click errors and verify the resulting viewport reached the selected feature/accepted target before marking the required visit complete. A fulfilled click with no resulting navigation must fail unless the current viewport already satisfies that target. Use a meaningful center/bounds/target check through an appropriate test interface; scale text alone is not location proof. Keep changes scoped and avoid product hooks unless actually needed; if packaging changes, rebuild/relock the affected image correctly.

Add regressions for rejected click, no-op click/wrong viewport, valid navigation, already-at-target, console error, incomplete visit list and script crash. Rerun the corrected browser audit and retain the prior reports unchanged. Search ranks remain exploratory and are not owner relevance acceptance.

## F4: protect attached hosts at every mutating boundary

`new_host` checks `seyra.validation.lab`, but `attach_host` does not; `drop_host` kills/deletes without checking. The restore phase can reach `drop_host` on an attached unlabelled owner host before any new-host guard. The cold-start readiness phase can also stop/start an attached unlabelled host.

Add a common fail-closed ownership check before mutating attached-host phases and inside destructive cleanup. Validate the host is a disposable member of this exact lab and check ownership of related volumes before deleting them. An explicit read-only path may inspect a preserved host, but must not allow update/import/restart/cleanup. Do not label, recreate, restart or modify `seyra-iran-restore` to make a test pass.

Test unlabelled and wrong-lab attached hosts at the restore/drop and readiness boundaries, asserting zero kill/rm/volume-rm/CLI mutation calls. Use a disposable dummy with identity recorded before/after for a real negative check. Test the valid disposable-host restore path too. Preserve safe resumption of the lab's own hosts.

## Verification and delivery

- Implement through Claude Code with regression-first before/after evidence. Freeze scripts from a named commit during runs; do not edit a running harness.
- Preserve the original Iran PBF and the running `seyra-iran-restore` host, including uptime. Failure tests use separate disposable hosts/daemons; changing SEYRA_HOME alone is not isolation.
- Online preparation remains authorized. Operational paths remain offline and all four map providers remain mandatory.
- Run relevant build/typecheck/unit and targeted real-wrapper/harness checks, then affected lifecycle/offline/restore tests. Rebuild/relock OPS and export a new bundle for the changed capacity product code; keep data-producing image identities/stores unchanged unless a real additional requirement demands otherwise. A full hour-long Iran import is not needed for these changes.
- Keep the original unreproduced readiness 503 open. Do not weaken identity checks or adjust provider timeouts without evidence. Do not start Auth, Relations, SOS, mobile implementation or a basemap redesign.
- Save a new evidence identity, preserving old results. Report fix commits, regressions and their scope, image/bundle identities, host/PBF preservation and remaining limitations. Do not merge, force push or mark PR #1 ready for merge.
