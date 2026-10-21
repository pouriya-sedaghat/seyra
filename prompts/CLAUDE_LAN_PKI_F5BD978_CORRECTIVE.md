# Seyra: correct LAN PKI tooling before Windows enrollment

Continue in the existing VM session on `feat/map-services-v1`. The owner supplied the one-commit patch `d570074..f5bd978`; review found four focused tooling issues. The live original service must remain running unchanged. The private PKI architecture and already-approved LAN target do not change.

## Read and reproduce

1. Read `CLAUDE.md`, the full `docs/reviews/LAN_PKI_F5BD978_REVIEW.md` and evidence on this reference branch, plus the existing pinned PKI/cutover decision/prompt at `7cf8107cfbd9c137618c06382e0435c73885ef0f`. Read reference files via `git show`; do not merge the review/planning branch.
2. Check the working tree and exact head; expected `f5bd9780c9781e5ac829df50ae12694475abe610`. Preserve newer/uncommitted work and private preparation material. Do not reset or rewrite history.
3. Reproduce the Bash cases on the unmodified tree first with disposable keys only. The review verifier takes a candidate source tree, retained d570074 TLS source tree, pinned Linux Step 0.31.0 executable and optional report filename. It expects the old defects; its zero exit is not acceptance of a corrected tree. Its Docker boundary is a host adapter, not a real-image test.
4. Distinguish Windows source findings from executed evidence. The review did not run NTFS or the CurrentUser store. Do not claim the Windows issues were independently reproduced on Windows merely because the supplied code patterns match.

## R1: narrow and verify the private-key directory boundary

- Reject unsafe Base equal to or beneath Desktop, Documents, synchronization/shared roots, unrelated broad user/system directories, and reparse/redirected paths before any recursive ACL mutation. Do not change permissions on a user's Desktop just because it was passed as Base. Keep the safe default user-local path working.
- For reuse, explicitly enumerate/validate or safely enforce the intended current-owner DACL policy for the managed root/key directories and existing issuer-key files, including foreign explicit allow entries. `icacls /grant:r` for the owner and checking only the base are insufficient.
- Do not silently take ownership or recursively repair unknown trees. Refuse uncertain ownership/ACL results and give the owner a precise non-destructive remediation. Preserve existing keys/bytes and encrypted-key policy.
- Add a regression with an owner-only base plus a foreign explicit ACE on a child/key; a fresh safe tree, safe reuse, exact forbidden root and a redirected/reparse child. Use controlled orchestration/ACL fixtures where necessary and prepare a tiny real Windows test, recording it NOT RUN until actually executed.

## R2: recoverable CurrentUser trust ownership

- Before importing a root, durably record the original pre-existing observation with exact public fingerprint/thumbprint, current account/store and pending state; verify the state directory is writable before mutation. Protect against overlapping invocations or inconsistent state.
- Reconcile pending/completed states against the actual matching public store entry after interruption or an import that took effect before failing. A root introduced by this operation must not become permanently classified as genuinely pre-existing on retry.
- Keep undo limited to this workflow's exact newly-added CurrentUser root. Verify the certificate bytes/fingerprint and account/store scope; preserve genuine pre-existing roots. Fail closed on tampered/ambiguous records and make recovery instructions concrete.
- Test the actual scripts through a controlled store boundary: no record-write permission, import success then interruption/final-write failure, retry, undo, genuinely pre-existing root, refusal/no-effect import and wrong account/fingerprint. Do not add real trust on the VM or run these actions on the owner's Windows yet.

## R3: bounded, fail-closed returned-packet checks

- Validate packet/request roots and exact expected regular-file entry types/names before any payload content read. Refuse root/file symlinks, FIFOs, devices, extra/nested entries and inspection/read failures immediately. Do not continue into wildcard reads or Docker after structural failure.
- Handle grep/hash/JSON/OpenSSL failures as errors, not absence of a private key or valid empty output. Keep complete checksums, CSR/key/chain/purpose/name checks and independent operator root-fingerprint comparison.
- Require successful Docker/image inspection and zero exit from the mandatory product validator as well as valid expected output; an `OK` line followed by exit 42 must fail.
- Add bounded desired-behavior cases for unlisted/listed FIFO, symlink, unreadable/corrupt material, failed inspection, OK-plus-nonzero, empty output and valid material. Recorder tests must prove product validation was not reached on structural failure; rerun one real r9 read-only/no-network validation on disposable material.

## R4: complete CSR publication or explicit failure

- Check required tools, every generation/copy/chmod/serialization/write result and the final manifest schema/content/hash/key/SAN bindings before announcing a ready request. Preserve the independent OpenSSL checks and overwrite refusal.
- Missing/failing jq, copy failure, write failure and malformed/empty output must return nonzero and never advertise a ready public request. Use a clearly incomplete attempt/publication discipline; no key contents in diagnostics.
- Add before/after regressions for these failures plus the normal request. Keep the owner's existing generated VM key/CSR and transfer manifest if their bindings validate; do not rotate/regenerate live preparation material for a test.

## Scope, evidence and handoff

- This round is source/tooling correction and focused testing, not live cutover. Do not start/stop/reconfigure the preserved service, import its certificate, publish the edge, change host firewall/routing, rebuild data, reimport Iran or create another full stack.
- No image input changes are needed for these new operator scripts; retain r9 and all image/data IDs. Do not rebuild/re-export them merely because the tooling changed. If a genuine image input must change, report the concrete reason before extending this round.
- Use disposable test PKI only. Small bounded read-only/no-network tooling validation containers are permitted under the existing resource safeguards; no broad workload next to the serving service. Freeze committed test sources before a recorded run and retain failed attempts honestly.
- Run build/typecheck/unit checks only where the actual changes require them; rerun the two added PKI suites and the new focused regressions. Run Windows 5.1 compatibility analysis. Keep Linux PowerShell tests, real Windows/NTFS/store acceptance and actual client SDK tests separate in the result table.
- No issuer keys/passwords, real operational values or certificates in Git/public evidence. Do not request private key transfer. Keep the currently prepared operator packet private, version it after corrections and do not tell the owner to execute the superseded scripts.
- Commit focused fixes/tests/evidence on the feature branch with a clean tree; do not push, merge, touch main or change PR #1's draft status. Return exact local head/commit list, before/after outcomes, unexecuted Windows cases, preserved-service identity/readiness and the command to export the next review patch.
- Prepare the eventual exact Windows download/transfer/step-by-step instructions, but await review of the corrected scripts before asking the owner to create issuer keys or add trust. No new generic CA choice or maintenance-window approval is needed.
