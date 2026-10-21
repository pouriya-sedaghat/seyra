# Correct Windows certificate-time comparison and recover the existing issuance

**Respond in English throughout this task, including progress updates and the final handoff.** The owner explicitly requested this. Continue in the existing VM-connected Claude Code session.

Read `docs/reviews/LAN_PKI_352BD9A_WINDOWS_TIME_REVIEW.md` from this same pinned reference commit in full. Reference branch only: do not merge or cherry-pick it.

## Current state and authorization

The feature branch was pushed to `352bd9ae95dcb3fe2c68d0722dac520de5aa1260`. Verify the actual tree/head before changes. This prompt authorizes a focused source/test/documentation correction to the Windows PKI tooling, plus a versioned private script-update draft. Do not restart or reconfigure the preserved service, replace its TLS, publish the edge/LAN endpoint, rebuild any image, export a new operational bundle or reimport data.

The owner's real Windows PowerShell 5.1 acceptance has now passed: W1–W7 14/14; W1–W10 17/17; exit 0 and cleanup OK in both. The earlier W8 failure was an accidental Yes rather than No; the rerun passed. Do not investigate that as a source defect or unnecessarily repeat enrollment.

The pinned Windows Step CLI 0.31.0 archive matched its hash. Its actual Authenticode result was NotSigned, as recorded. The owner created an encrypted Root CA and encrypted issuing CA successfully; the issuing chain verified. These keys exist only on the owner's Windows PC. The VM's server key and request remain unchanged. Never ask for issuer private keys or passwords to be uploaded to the VM or Git.

Signing wrote an existing leaf and its request files, then failed in `Test-SeyraLeafCert` at `CHECK FAILED: already valid`. The owner ran the reviewer-provided read-only diagnosis on Windows:

- zone: Iran Standard Time, +03:30;
- parsing the ISO NotBefore produced `DateTimeKind.Local`;
- original local-versus-UTC comparison: False;
- normalizing the same value to UTC before comparison: True.

There are three issuance attempt directories; only one contains a leaf. Their actual names are in the owner's Windows transcript/private handoff, not public Git. The root fingerprint and all endpoint/account/certificate details must also remain private. Offline-backup completion has not been confirmed; do not record it as done.

## 1. Reproduce and correct the time semantics

Reproduce the unsafe comparison on unmodified `352bd9a` using disposable fixtures and a positive-offset timezone. Preserve before/after evidence, clearly distinguishing actual scripts, a small comparator demonstration, Linux PowerShell execution and owner-run Windows evidence. A UTC-only run is insufficient.

Normalize certificate instants explicitly before time comparison. Inspect all related validity comparisons and export/renewal timestamps in the module and `Export-PublicPacket.ps1`. Handle the actual forms produced under Windows PowerShell 5.1 and PowerShell 7: ISO strings with a timezone and parsed DateTime values. Use consistent UTC or DateTimeOffset semantics; do not silently reinterpret ambiguous, malformed or unzoned input as the local zone.

Preserve the existing not-yet-valid tolerance and certificate lifetime/issuer bounds. Do not solve this by removing `already valid`, enlarging the allowance, waiting several hours, modifying the owner's system clock/zone, bypassing TLS, or regenerating CAs and the VM request.

Add meaningful regressions with deterministic reference times:

- a valid backdated NotBefore passes in UTC, +03:30 and a negative-offset zone;
- a genuinely future NotBefore beyond the existing allowance fails in every zone;
- equivalent instants written with Z and explicit offsets compare identically;
- DateTime values produced by JSON parsing retain the same instant;
- invalid/ambiguous timestamp input fails;
- issuer lifetime bounds remain enforced;
- exported validity and renewal dates are consistent across zones, including a date near UTC midnight where the local calendar date differs.

Exercise the actual validation helper/flow, not only a duplicate formula. Changing a process-local timezone for disposable Linux tests is fine; do not change the VM's or Windows PC's global timezone. Keep Windows PowerShell 5.1 compatibility. Retain the previous trust snapshot/record, ACL, recovery and fixture coverage behavior.

## 2. Prepare recovery of the existing Windows leaf

Do not ask the owner to run `Sign-ServerCsr.ps1` again or delete the failed attempts merely to satisfy a single-directory count. Prepare exact owner-run commands using the explicitly identified existing candidate directory. Do not choose an attempt solely by its age.

The recovery procedure must:

1. Inventory the attempt directories and identify the candidate and missing artifacts without writing or deleting them.
2. Verify the candidate's CSR/manifest against the original delivered VM request, its public key, exact SAN and usages, and its root/issuing hierarchy.
3. With the corrected module, validate the real NotBefore/NotAfter instants and all existing issuer/lifetime bounds.
4. Verify the actual leaf signature chain and host with the pinned Step CLI and explicit local root/intermediate, without network retrieval or system trust. The signing flow failed before its final chain-verification step, so metadata checks alone do not complete that step. If a temporary combined chain is needed, use a separate temporary file and leave the issued certificate unchanged. Verify CLI options against the pinned tool; do not guess an intermediate flag or promote the intermediate to a trust anchor.
5. Export only this fully verified candidate to a new public packet using its explicit path. If a public destination already exists, stop rather than overwrite it. Do not select the most recent directory automatically or weaken the original multi-directory refusal.

Prefer reusing the existing verified public-validation/export functions and a small recovery command sequence. Add a check-existing entry point only if needed; keep the change focused. If the candidate fails a genuine cryptographic or request-binding check, report that exact failure before proposing new issuance.

You cannot execute these operations on the owner's Windows PC. Test the preparation with disposable fixtures, then supply the real commands privately for the owner. Do not claim the current leaf is fully validated until the owner actually runs them.

## 3. Verify, commit and stage the update

Run the focused LAN PKI suites affected by the module/export changes, the new timezone regressions and PowerShell 5.1 compatibility analysis. Small existing offline tool-test containers are permitted; no second map stack or service outage is needed. Do not count unavailable Windows/fixture cases as passed. Preserve the actual successful Windows W1–W10 results as owner evidence, with sensitive operational details kept private.

Commit the minimal source/test changes and sanitized evidence in logical commits. Leave the feature commits local for owner review/push. Keep `main` and PR #1 unchanged.

Stage a fresh versioned, hashed Windows update draft from the committed source. Keep the sealed v3 packet and the existing PKI base intact. The update can reuse the pinned Step installation; it need not resend tool archives or contain any key. Include the corrected scripts/module, clear instructions, a manifest and exact hashes. Compare delivered bytes with the committed source. Do not hand-edit the owner's sealed module or release unreviewed replacement bytes.

## Final response, in English

Report the cause, changed files/commits, before/after regression evidence and platform limits; identify the staged update and its hashes, and provide the owner-side recovery command plan for review. Confirm the preserved service, VM request and issuer keys were not changed. Keep actual endpoint/host/fingerprint/path bindings in the private operator record, and distinguish offline-backup status from completed work.

No live cutover, new trust, CA recreation or re-signing is part of this corrective turn.
