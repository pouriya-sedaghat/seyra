# VM2 operational follow-up review at e7a2175

Reviewed on 2026-10-19. The attached patch contains 15 commits from `82942c1296e638c8715c021fee49aeb7c540a703` through `e7a2175149824f7cba92e47382c464607248f609`.

The main corrections work for their reported cases. Four boundary defects remain: reclaimable storage is overstated for sparse/linked files; the update gate ignores unlisted symlinks; a failed map-result click still counts as a successful visit; and attached hosts can reach destructive cleanup without the lab-label check. These are corrections to the current Map Services work, not new module requirements. Keep PR #1 draft. A normal feature-branch push may share the reviewed work; this report does not approve merging or closing all follow-up items.

## Material and verification boundary

- Received patch SHA-256: `e18a0f83a52dc4eb4f2ce55b3f849b9ca739ec95efb09a26e0dcfee56a90d344`.
- Applied all 15 mail patches to a copy of the previously reviewed content. One missing unchanged base file, `tests/browser/web-client.mjs`, was retrieved at the exact base SHA.
- All **200 final changed-file Git blob hashes** match the patch's final indexes, including binary artifacts. This checks received file content; it does not reconstruct/verify the Git commit objects themselves.
- Read `CLAUDE.md`, the earlier review and follow-up prompt, changed OPS code, validation scripts, RUNBOOK and new run records. Application code was not changed by this reviewer.
- Reviewer runtime: **Node 24.19.0**, rather than the project's pinned 24.21.0. Dependency-free targeted checks use Node's TypeScript transformer or extracted actual functions; no package installation was performed.
- **Not rerun by the reviewer:** full 160-test workspace suite, typecheck/build, Docker/image execution, real non-root wrapper/export, full Iran import, real Photon or Playwright. VM results below are inspected submitted evidence, not independently repeated provider tests.

## Accepted parts

1. **V1 ordering for ordinary files:** digest and payload checks now precede install replacement/bootstrap; rejected cases finish the run. The supplied actual-block regression yields **19/19 PASS** here. Against the old `82942c1` block the same test gives the reported **14 failures**.
2. **V2 predicate:** console errors, missing declared visits and caught script errors now affect the verdict. The supplied test gives **8/8 PASS** here; the old inline predicate accepts four failing cases. F3 below concerns how a visit is recorded, not this aggregation improvement.
3. **Capacity policy/measurement:** the 120x reference, floor, persisted-40x warning and within-step monitor are implemented. Actual-code checks confirm the exact admission boundary, a mid-step low-water mark, ignored failed samples and timer shutdown. F1 concerns the estimate credited before deletion.
4. **Bundle output ownership:** the actual helper changes an archive from 0600 to 0644, retains executable mode/content, leaves OUT's mode unchanged and does not follow an output symlink to chmod its target. The submitted real-operator evidence shows verification, copying and loading without manual chown.
5. **Frozen runs/L14:** the archive/self-copy mechanisms and recorded revisions address editing a running harness. L14 now requires a busy refusal. The submitted r5 log contains `another lifecycle operation is running: start`, rather than treating a sequential outcome as overlap.
6. **Identity scope:** comparing the base and final dependency locks shows only the OPS image changed, to `sha256:7367b56f9f337b61a6e9f5259c3373cb46fb2bdfe2fcafe40767b27d7a61c1bb`. Data-component identities are unchanged. The submitted bundle digest is `d128cce3f691de06c09914c08900bcb9767ff339674cb20ed6f8cc8c18870fde`; no bundle archive was supplied for independent verification.

## Findings

### F1 — P2: logical file length is credited as reclaimable disk space

Location: `apps/ops/src/importer.ts:221-222`; helper `apps/ops/src/manifest.ts:127-138`.

The new admission path credits `duBytes(setupDir)` before removing a failed build. That existing measurement helper sums `stat.size`, follows symlinks and does not account for allocation, links or filesystem boundaries. Apparent byte length is not the number of bytes deletion frees on the filesystem checked by statfs.

**Reproduced with actual code and a real sparse file:** an 8 GiB logical-length file has zero allocated blocks in the reviewer filesystem, yet `duBytes` credits all 8 GiB. Feeding that credit into the actual capacity check admits a 4 GiB requirement with an illustrative free-space budget of only 1 GiB. Deleting that file cannot supply the missing 3 GiB. A separate symlink fixture also credits bytes of a target outside the release, although removing the release removes only the link. The free-budget example is controlled arithmetic; no actual low-disk import or large disk allocation was attempted.

**Impact:** a retry can delete its failed build and begin another import despite lacking the promised storage. The measured 120x factor and the successful Iran run are not disproved; this is an unsound additional credit in the admission decision.

**Needed:** a separate conservative reclaim estimate, with no symlink following, correct same-filesystem/allocation handling and no credit for bytes that deletion cannot release (including shared hard links). Unknown release/DB reclamation may be credited as zero. Do not treat `pg_database_size` as a guaranteed immediate statfs increase without support. Preserve refused failed builds and the owner input; recheck observed free space before starting the new writes. Keep descriptive logical-size measurements separate if useful.

### F2 — P2: an unlisted symlink passes the pre-install update gate

Location: `tests/validation/iran-offline-host.sh:234-243`, especially `find . -type f`.

`present` includes regular files only. An extra symlink under the incoming install tree is absent from both `SHA256SUMS` and this set, so the equality check passes. `cp -a` then copies the link before bootstrap.

**Reproduced:** the actual update block, trusted local coreutils and a temporary bundle accept `install/unlisted-link.sql`, copy it and call bootstrap. Its audit records `PASS U1 ... no unlisted files`. CLI/Docker calls are recorders in this test. A later product verifier may reject the bundle; that would happen after install mutation, so it cannot establish the promised pre-install gate.

**Needed:** validate all filesystem entry types before hashing/installing. The simplest policy for the current generated format is to permit directories and listed regular files and reject symlinks/special entries, including dangling links. Validate contained normalized relative paths and fail closed. Rejected cases must preserve the install tree/image set and make zero bootstrap calls. Keep the existing wrong-digest/corruption tests.

### F3 — P2: a failed result click is reported as a successful required visit

Location: `tests/validation/iran-browser.mjs:64-74`.

The helper sets `rank` before clicking and suppresses a rejected click with `.catch(() => undefined)`. It returns `found: rank !== null`; the new verdict then treats this as a successful required navigation. The scale bar is recorded but never asserted against the selected target.

**Reproduced:** execute the actual `searchAndOpen` function with a controlled Playwright boundary whose matching card's click rejects. It returns `found: true` with an unchanged `100 km` scale. Six such records produce verdict `PASS`.

**Needed:** distinguish finding a result from opening it. Do not suppress click failures; verify the resulting viewport has reached the selected feature/accepted target before recording navigation success. A click that returns but causes no move must also fail unless the viewport already satisfies that target. A generic scale bar is not location proof. Preserve exploratory search ranking and avoid claiming owner-approved relevance.

### F4 — P2: attached hosts bypass the lab-label guard before destructive operations

Location: `tests/validation/iran-offline-host.sh:167-174`; the `restore` phase calls `drop_host` before creating host 2. The `readiness` phase also stops/starts an attached host without checking its label.

The new `new_host` label guard protects one replacement path, but `attach_host` accepts any container name and `drop_host` does not validate ownership. With existing dataset metadata, attaching an unlabelled serving host and requesting restore reaches kill/remove operations on that host before `new_host` checks the restore target. Selecting such a host for the supposedly disposable-only readiness phase can restart it as well.

**Reproduced:** execute actual `drop_host` with container operations replaced by call recorders and an unlabelled owner-host name. It issues inner `docker kill`, path deletion, `docker rm -f` and volume removal without any inspect/label check. No real container was accessed or removed.

**Needed:** one fail-closed lab-ownership assertion before every mutating attached-host phase and again in destructive helpers; validate related volume ownership before removing it. A read-only observation path may be explicit, but must not admit stop/start, import, update or cleanup. Test unlabelled/wrong-lab attached hosts, not only `new_host`. Never label or restart `seyra-iran-restore` to bypass this rule.

## Evidence assessment and limits

The submitted run record supports the reported happy-path results: r5 synthetic summaries contain no failures; C2 records a 38,179,172,352-byte low-water mark inside `staging-validation`; the final browser report records 504 requests, no external/failed/console events and six found results. The Azadi screenshot was visually inspected and shows the intended square with Persian map labels. F3 does not claim those screenshots are wrong; it shows that a later invalid run can still pass automatically.

The Iran read-only readiness JSON contains **442 polls, all HTTP 200**, and tiles-probe maximum **4,288 ms**. The original 503 remains unreproduced; the timing is a possible mechanism, not a proven cause. No readiness semantics were changed. Approved relevance fixtures, load targets, LAN configuration, a second Iran snapshot, mobile and licence review remain separate pending work.

Reproduction:

```bash
node docs/reviews/verify-vm2-e7a2175.mjs /path/to/e7a2175-checkout /path/to/evidence
node tests/validation/test-update-gate.mjs
node tests/validation/test-browser-verdict.mjs
```

The first command confirms seven positive actual-code checks and the four boundary findings (F1 has two counterexamples). The latter two rerun the developer's 19 and 8 checks. This is targeted independent verification, not another full Iran or Docker run.
