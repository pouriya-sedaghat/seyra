# Seyra: final input-snapshot and Windows acceptance cleanup corrections

Continue in the same VM session on `feat/map-services-v1`, expected clean head `f4bd578ffe6a7c9f1c59ecb2ec91c363eb154bc9`. The review accepts the original R1–R4 fixes in source, with the explicit Windows/runtime limits. Address two localized new findings F1/F2 and two small notes N1/N2 in `docs/reviews/LAN_PKI_F4BD578_REVIEW.md` before releasing the Windows packet.

Read `CLAUDE.md`, the complete review, its prepared reproducer and the existing selected-PKI/cutover prompt. Read this reference branch via `git show`; do not merge it, reset the feature branch or rewrite existing work.

## F1: import exactly the checked public root

The caller validates root A, but `Add-SeyraRootStoreEntry` accepts its path and opens it again. If the external file becomes B, the helper can import B while the caller checks/journals A, removes A's pending record and says nothing is trusted.

1. Before modifying code, run the prepared `docs/reviews/reproduce-root-snapshot-f4bd578.sh` against an untouched export of f4bd578 using the existing pinned Step and existing Linux PowerShell/container test setup. It extends only the test boundary/harness, not the product, and uses disposable roots and a file-backed fake store. The reviewer could not execute it; check its actual result rather than treating the expected outcome as observed evidence. Keep any harness correction and its diff explicit.
2. Read the external DER once and use exactly those immutable bytes/the validated certificate object for fingerprint validation, parsing, state recording and the native store import. Do not reopen the original external filename in the real or controlled boundary. Preserve the original pre-existing observation, lock, recoverable record, current-account scope and exact undo.
3. Add a permanent desired-behavior test that changes the ORIGINAL external file after validation and before store import. Importing the frozen checked A is valid; refusing before any import is valid. Installing unchecked B is never valid, and failure must not falsely claim nothing is trusted. Keep the existing interruption/declined/pre-existing/incorrect-fingerprint regressions.
4. Do not create or trust any real issuer/root for this correction; the actual Windows store remains untouched.

## F2: acceptance cleanup must preserve failed undo state

1. Refactor `Test-LanPkiOnWindows.ps1` so unexpected errors, a refused/failed W10 removal and interruption have explicit cleanup/recovery handling.
2. Only delete the public test certificate and its record/recovery directory after verifying that the exact test root is absent from the current-account store. If cleanup is refused or fails, retain minimal exact-root recovery state, print a concrete fingerprint/account-bound recovery command/path and exit nonzero. Preserve genuine pre-existing/unrelated roots. Do not silently force removal after the owner declines it.
3. Use only disposable test-owned junction targets. Check native `icacls`/`cmd rmdir` statuses and actual resulting link state. An unremoved junction must never fall through to broad recursive cleanup. Keep unrelated Desktop/TEMP contents untouched.
4. Add controlled tests for the acceptance cleanup path itself: store removal refusal, exception after import, successful cleanup, residual junction/native-command failure and retention of the right certificate/record on failure. Clearly separate Linux models from real Windows NTFS/store evidence. Keep Windows cases NOT RUN until the owner actually executes them.

## N1/N2: small robustness corrections

- Compare the CSR subject using an explicit OpenSSL output format (e.g. `-nameopt RFC2253`) or a structured equivalent instead of default display spacing. Verify the normal CSR and `--check` with both available 3.0/3.5 behavior, or a declared faithful output fixture when a version is unavailable. Preserve the already-created real VM key/CSR/manifest; formatting a diagnostic must not rotate it.
- Check that special-file fixture creation succeeded and produced the intended type before claiming coverage. Failed `mknod` or socket creation must produce a setup failure or an explicit NOT RUN/SKIP, not PASS for another file type or a missing file. Retain bounded FIFO assertions and the mandatory-validator failure checks.

## Scope and evidence

- Keep the original service running unchanged. Do not start/stop/reconfigure the preserved host, change its restart policy, apply certificate/access changes, publish the edge, change global firewall/routing, reimport Iran, create a second full stack, rebuild images or re-export r9. Reboot/startup persistence is a separate later operational item, not part of this source fix.
- Preserve and recheck the existing VM request read-only; keep the private v2 packet marked unreviewed, then stage a versioned corrected draft with hashes. No Windows issuer creation or trust enrollment yet.
- Small bounded disposable no-network tooling tests are allowed under the existing resource safeguards. Use the pinned verified Step and existing test images; run recorded tests from committed/frozen sources. Run the retained 33/92 checks, added regressions, VM tests and 5.1 compatibility analysis appropriate to these paths; do not inflate local or unavailable platform results.
- Keep source findings, actual executions, adapters and unavailable Windows checks distinct. Report before/after outcomes for F1 and F2 and any harness defects honestly. No private keys/passwords/real endpoint or certificate metadata in public evidence.
- Commit focused fixes/tests/evidence locally, keep main and PR #1 unchanged/draft, and do not push or merge the reference branch. Return the exact new head and the patch-export command for the next review. The owner has already selected the PKI/window policy; do not reopen those generic questions.
