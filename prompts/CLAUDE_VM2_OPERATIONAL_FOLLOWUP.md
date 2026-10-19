# Seyra VM2 follow-up after the Iran run

Work in `pouriya-sedaghat/seyra`, existing branch `feat/map-services-v1`, PR #1 kept draft. Expected local patch head is `82942c1296e638c8715c021fee49aeb7c540a703`, nine commits after `9f0d792`. They may still be local: preserve them and inspect refs/newer commits; never reset to the older remote head or drop unpublished work. Respect the owner's choice to push the branch themselves when credentials/handoff require it.

Read CLAUDE.md, current Map Services documents, RUNBOOK and the replacement-VM README. Read the follow-up report from `origin/review/map-services-vm2-82942c1` using git show:

`docs/reviews/VM2_82942c1_REVIEW.md`

Do not merge the review branch. It contains reviewer artifacts and is not the implementation patch. The review accepts both geocoder fixes (`2df015f`, `6a665ae`) for the draft feature branch. Preserve them. This task closes operational/validation gaps; do not start Authentication, Relations, SOS, mobile implementation or a basemap/provider redesign.

## 1. Make the update test gate precede every incoming install action (V1)

In `tests/validation/iran-offline-host.sh`, verify the out-of-band SHA256SUMS digest and listed bundle file checksums using trusted existing tools before replacing install files, running an incoming wrapper, loading images or assigning the new bundle for dependent phases. On failure, fail the phase/run and skip dependent operations. The current code performs those actions before comparing the digest.

Add regressions that fail before and pass after: wrong out-of-band digest, payload corruption with an unchanged SHA256SUMS file, and valid update. Rejected updates must make zero install/bootstrap changes. Verify on a disposable test host; do not run a tamper test against the owner's serving host.

## 2. Make the browser audit's exit status match its claimed conditions (V2)

The current predicate ignores console errors and required visits. Require zero console errors and success of all required visits, or explicitly separate categories with a correctly aggregated final status. Test the predicate with a console-error case and a missing required visit, plus the successful report shape. Preserve exploratory relevance labels; do not turn manually chosen province/radius hits into owner quality acceptance.

Freeze validation scripts during execution. Use an immutable copy/worktree or a test-runner artifact tied to a commit; record the revision. Never edit the script used by a running shell. Make concurrency scenarios deterministic when they claim to exercise overlap; L14's final r3 run had both commands succeed sequentially and did not prove a busy refusal.

## 3. Address storage admission and within-step measurements

The Iran run disproved interpreting the default 40× input-size guard as sufficient capacity. Inspect the raw measurements and storage layout, including replacement of failed releases, instead of blindly multiplying one observed number. Define a conservative, documented Iran capacity policy with explicit margin and configuration semantics; retain protection against starting with too little space. Explain which filesystem/mount and remaining temporary footprint each check covers. Do not lower a guard or delete unrelated data to make a run pass.

Measure free space during long steps so the release/run record captures the observed low-water mark. State sampling interval/limits. If adding cancellation on low space, ensure job cleanup, failed-release recording and protection of active data are tested; do not introduce an unreliable kill/delete path. Do not promise that finite polling guarantees avoiding every external disk-exhaustion event.

Add meaningful boundary tests: insufficient capacity rejects before build side effects, adequate capacity passes the check, and a simulated within-step dip appears in the measured minimum. Use disposable fixtures for failure tests. Raw PBF and active stores must remain unchanged.

## 4. Make exported bundles usable by the documented non-root operator

Reproduce the mode-0600/root-owned archive behavior through the real wrapper/export path. Implement a deliberate output ownership/readability policy so the initiating operator can run documented verification/loading without manual chown. Preserve restrictive secret/key permissions and existing bundle contents/hash semantics. Do not apply broad recursive permission changes to SEYRA_HOME or unrelated files.

Test with a real non-root operator and locally generated bundle on a disposable environment. Re-run bundle verification/tamper/load as appropriate and document the supported ownership model.

## 5. Retain and investigate the readiness observation

Keep the original two 503s and later clean runs. Collect bounded cold-start and uncached/cancelled map-request diagnostics with per-provider status, safe error and latency timestamps. Default logs must not expose coordinates, query text, credentials or private data. Do not hide failures by weakening identity/readiness checks or increasing timeouts without evidence. If the incident remains unreproduced, state exactly that and keep it open with a reproducible diagnostic command; do not invent a cause or fix.

Large low-zoom tiles remain a measurement/design input. Record them for the later load/UX target discussion; do not silently remove required detail or change providers in this task.

## Validation and delivery

Preserve the original PBF and running `seyra-iran-restore` host. Use separate disposable test hosts/daemons for mutations and failures; fixed Compose project/network names mean SEYRA_HOME alone does not provide isolation.

Run appropriate typecheck/build/unit and targeted real-wrapper/harness checks. Rebuild/relock OPS and re-export the bundle if changed product packaging requires it. Keep data-component identities and existing geocoder stores unchanged for capacity/permissions/harness-only work. Re-run affected lifecycle/offline/restore/security checks; do not repeat an hour-long full Iran import unless a changed data-producing path or unresolved defect actually requires it. Preserve historical run evidence and label all new results with commit/environment/dataset identities.

Online preparation is authorized; operational install/import/start/assets/update/restore must still work without external access. Keep all four providers mandatory. Keep secrets, raw PBFs, built stores and image archives out of Git. Leave PR #1 draft and main untouched. Return fix commits, before/after evidence, ownership/capacity policy, affected image/bundle identities, and unresolved observations/owner inputs.
