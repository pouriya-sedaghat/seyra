# LAN PKI UTC correction review: 80935b4

**Source verdict: accepted. No blocking implementation finding in this change.** The old private recovery instructions must be superseded before another Windows handoff because the owner has since deleted the company PC's PKI folder. The next step is inventory of the retained PKI on the Windows PC hosting the VM.

Reviewed head: `80935b42a9b5616c21df7483412c5fb2ccbc6df8`, three commits after `352bd9ae95dcb3fe2c68d0722dac520de5aa1260`:

- `d2cc9041f00c397b9271ef09bb833220a024a3ae`: implementation;
- `f59318eb62301481ed9d52eb9e0e1531f1dd818d`: regressions;
- `80935b42a9b5616c21df7483412c5fb2ccbc6df8`: evidence and status.

Patch SHA-256: `c5996aed53d369d894054691c5cd5bc996f565c02349a0329d72924f2979680e`. All 16 final file blobs match the patch's full index hashes.

## Implementation

The confirmed local-versus-UTC NotBefore defect is corrected. The normalizer accepts zoned ISO strings, UTC/Local DateTime values and DateTimeOffset values, and returns a UTC instant. Unzoned/malformed strings and Unspecified DateTime values are rejected. The module compares normalized instants, cross-checks certificate length and retains the existing lifetime, issuer and not-yet-valid limits. Exported validity and renewal dates use UTC and invariant formatting.

Signing and export now use the same actual chain check: leaf plus intermediate in a temporary PEM, with only the explicit Root as trust anchor and the intended IP supplied to Step. The intermediate is not passed as a root. The explicitly selected recovery attempt must match the delivered CSR and request manifest byte for byte. Export refuses an existing destination. The ACL, trust-record, snapshot-import and exact-undo logic is retained.

One wording clarification: `-CheckIssuedDir` leaves the issuance attempt and PKI files unchanged, but the chain helper creates and removes a temporary public-certificate bundle. Describe it as non-signing validation that does not modify the attempt, rather than claiming no filesystem activity anywhere. This does not block the source correction.

The recovery feature remains useful for a retained attempt on the issuer PC. It cannot recover the deleted company-PC attempt and must not be advertised as doing so in the next instructions.

## Verification and limits

Independent reviewer checks:

- Reconstructed the patch and verified all 16 changed-file blobs.
- Inspected the normalizer, callers, chain validation, explicit attempt resolver, export logic and regressions.
- Ran seven checks with pinned Linux Smallstep CLI 0.31.0, real disposable PKI and the same leaf/intermediate/explicit-root construction: valid chain accepted; missing intermediate, unrelated root, wrong IP, future NotBefore, altered signature and missing root file rejected. **7 passed, 0 failed.**
- The changed Bash harness passes `bash -n`.

The independent chain checks execute the pinned CLI, not the PowerShell helper. The reviewer cannot execute PowerShell here: portable PowerShell fails to create CoreCLR (`0x8007000E`, exit 137). No reviewer-run Windows, NTFS, store, Docker-image or live-service result is claimed. Reproduction code and records are supplied beside this review.

The author's committed evidence reports:

| Suite | Reported result |
| --- | --- |
| Linux PowerShell module | 33/33 |
| Actual scripts with controlled ACL/store boundary | 98/98 |
| Acceptance-driver cleanup model | 26/26 |
| UTC / Tehran / New York, each in native and emulated 5.1 JSON form | 6 x 51/51 |
| PowerShell 5.1 static compatibility | 0 findings |

The recorded before runs reproduce the Tehran false rejection, negative-offset false acceptance at the module check, and renewal-date shifts. The 5.1 JSON shim is accurately identified as emulation, not a real 5.1 runtime. The earlier successful real Windows acceptance and failed issuance were owner results on the company PC, not on the VM-host Windows PC. They do not establish that the corrected code has run on either Windows machine.

## Current operator state supersedes the historical recovery plan

The owner clarified after the implementation run that separate PKIs had been created on two Windows PCs:

- **Issuer candidate A:** the Windows PC hosting the VM. Its existing `%LOCALAPPDATA%\SeyraPKI` was retained. Its actual contents, certificate fingerprints and issuance state still need read-only inventory.
- **Client B:** the separate company Windows PC, which produced the supplied transcripts. The owner deleted its `%LOCALAPPDATA%\SeyraPKI`, including the old issuance attempt. The old fingerprint and attempt cannot be assumed to describe A.

Do not request further deletion or blindly recreate either CA. Select one validated issuer hierarchy on A. B will receive public CA material and its own local trust record later; issuer private keys are not distributed to it. Folder deletion is not proof that the corresponding root is absent from the Windows trust store, so inspect project-related trust entries before proposing any exact cleanup. Never remove roots by name alone.

Keep the historical test evidence intact. Mark the old private recovery plan obsolete with an external status note, leave sealed drafts intact, and release a fresh versioned handoff with current instructions and verified source bytes. Its first owner action should be inventory only, with no key creation, signing, trust enrollment or deletion. Offline backup completion remains unconfirmed.

No API/proxy/OPS/data-image rebuild or operational bundle export is required. Keep the VM key/CSR and live service unchanged. The owner may push the reviewed feature commits normally after checking the clean head. Keep PR #1 draft and leave `main` unchanged. Do not merge this reference branch into the feature branch.
