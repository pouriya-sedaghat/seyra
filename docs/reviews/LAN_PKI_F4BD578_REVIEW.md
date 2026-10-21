# Review of LAN PKI corrections at f4bd578

**Disposition: the original R1–R4 fixes are addressed in the reviewed code, with the validation limits below. Request two localized follow-up fixes before Windows enrollment.** Keep the existing service and prepared VM request unchanged. The selected two-tier private PKI remains the same.

## Input identity

- Patch SHA-256: `a676a154e8c6693de31c0ae3099a07a22f82694379cc8347f2f1a57eee579a9d`.
- Base: `f5bd9780c9781e5ac829df50ae12694475abe610`.
- Four commits: `0a91f32d488ff00cb62072d2fc7b352a1a78df09`, `f35a90a205fcb3a0414d5f3ae4c1b970569c9d73`, `2b7981a231fff9b294be9717524dfeb08c0c7a2b`, `f4bd578ffe6a7c9f1c59ecb2ec91c363eb154bc9`.
- All 36 patched file versions match their complete Git blob identities. Reviewed the added/changed scripts, helpers, tests, evidence and deployment-plan status.

## Disposition of the previous findings

| Previous finding | Reviewed result |
| --- | --- |
| R1: folder ACL/path boundary | Addressed in source: equal/ancestor/descendant path checks; redirection refusal; fresh-base-only ACL change; read-only full tree/SID checks on reuse; no recursive ACL repair. Real NTFS behavior remains unexecuted by this reviewer. |
| R2: trust ownership after interruption | Addressed in source: pre-import pending state, current-account binding, exclusive file lock, recoverable replacement, preserving the original pre-existing observation and exact undo. The new mutable-input issue below is separate. |
| R3: special files and validator failure | Addressed: abort before content reads; distinguish read failures; bounded Docker execution; require zero status and the precise matching output. Relevant non-platform cases pass independently. |
| R4: incomplete CSR reported ready | Addressed: checked tools/copies/serialization, incomplete directory, validation before publication, nonzero failure and read-only `--check`. A host-output portability note remains below. |

The labelled missing-file guard in the previous reviewer's reproducer is appropriate: a failed request no longer publishes a manifest, so unconditional `stat` was a limitation of that reproducer. Its old success/exit conventions are not an acceptance verdict for Windows.

## F1 — P2: the root installed can differ from the root whose fingerprint was checked

`infra/tls/lan-pki/windows/Add-RootTrust.ps1:33-43,67-75`; `SeyraPki.psm1:378-385`

The entry script verifies the input file's SHA-256, parses `$cert` and binds its DER bytes to that hash. It then passes the **original filename** to `Add-SeyraRootStoreEntry`. The real boundary reads that filename again into a new certificate object. The validated `$cert` is not what gets imported.

A change of the original public file between validation and the store call gives this execution sequence:

1. Root A matches the independently provided fingerprint; the pending record names A.
2. The file is replaced with another valid root B.
3. The boundary reopens it and adds B.
4. The caller checks for A, does not find it, deletes A's pending record and reports `nothing is trusted`.

Root B can therefore remain trusted without a matching record even though the command fails. This is a check/use mismatch in the import input, not a failure of the repaired pending-state algorithm for a fixed input.

**Required:** read the public DER once; hash, parse, validate, journal and import that same immutable byte snapshot/certificate object. Pass the checked bytes/object through the real and test boundaries. A change of the external source file must either be irrelevant to the frozen import or cause refusal before store mutation. Preserve the exact CurrentUser/account/fingerprint rules and genuine-pre-existing behavior.

**Evidence level:** source-backed execution sequence; no actual Windows store or PowerShell execution is claimed. `reproduce-root-snapshot-f4bd578.sh` prepares two new desired-behavior assertions using the candidate's actual scripts and existing Linux store stand-in. It changes only the original external root path at import time; the native implementation and stand-in both currently reopen that path. This prepared reproducer was NOT RUN here because CoreCLR cannot initialize in the sandbox. Run it on the VM's existing PowerShell test setup before fixing, then keep a permanent regression against the corrected snapshot interface.

## F2 — P2: the Windows acceptance test discards recovery state after failed root cleanup

`tests/tls/windows/Test-LanPkiOnWindows.ps1:93-119`

With `-IncludeTrustStore`, W9 adds the disposable root. If W10's removal is refused/fails, `Remove-RootTrust.ps1` correctly keeps its record and reports failure. The acceptance driver then deletes the public certificate, prints `CLEANUP NEEDED`, and unconditionally recursively removes `$T`, including that retained record. The deliberate recovery information is lost while the root may still be installed. It is a one-day test root, but the test still must honor its own exact cleanup/undo contract.

The driver also has no encompassing cleanup/recovery structure for unexpected failures after enrollment. Its junction-removal commands have no checked native exit status before later cleanup. Do not rely on a success-oriented sequence for a test that deliberately exercises Windows permission/store refusals.

**Required:** track the exact test root and test-owned artifacts; make cleanup exception-safe; verify removal from the actual current-account store before deleting the certificate or its record. On refusal/error, retain the minimal certificate/state/recovery directory and print the exact fingerprint-bound recovery command, then exit nonzero. Preserve unrelated/pre-existing roots. Use disposable targets for junction tests, check native command results, and avoid recursive deletion through any unremoved junction. Do not turn a declined confirmation into an automatic forced retry.

**Evidence level:** source finding, NOT an executed Windows failure. Add controlled refusal and interruption regressions for the acceptance driver's cleanup itself. Keep real NTFS/store cases NOT RUN until the owner actually executes them.

## Narrow notes to include in the follow-up

### N1 — OpenSSL subject display is not a stable validation format

`new-server-csr.sh:51` compares default `openssl req -noout -subject` output to `subject=CN=<ip>`. On the review host's OpenSSL 3.0.13 the actual output is `subject=CN = <ip>`, so a valid request is refused. Explicit `-nameopt RFC2253` gives the expected compact representation. The current VM uses 3.5.5, where the recorded run passes; this is not evidence that its preserved request is broken. Use an explicit formatter/structured comparison for portable host tooling, or state and enforce a precise version requirement before generating a key. The display change must not rotate or alter the existing VM request.

### N2 — special-file fixture creation must be checked

`tests/tls/test-lan-pki-vm.sh:130-134` ignores the status of Docker `mknod`. In this sandbox it fails and leaves `server.crt` absent, yet both character-device assertions print PASS because a missing file is correctly refused. That does not exercise a character device. Assert the fixture's type before the check or report an explicit unsupported case; do not claim device coverage from an absent file. The Unix-socket fixture is also unavailable here, but its two assertions fail rather than silently pass. Keep such setup failures distinct from product defects and recorded coverage.

## Independent execution and limitations

- Node 24.19.0, OpenSSL 3.0.13, verified Linux Smallstep CLI 0.31.0. No package/image/data input was modified.
- Without an adapter the normal CSR case demonstrates N1. For further behavioral checks, an explicit host wrapper supplies `-nameopt RFC2253` only on `req -subject`. The reviewed source files themselves remain unchanged.
- The submitted VM suite runs its actual Bash scripts, pinned Step and retained actual `validateProposedCertificate` through the existing host Docker adapter. Of 59 assertions, **55 supported assertions pass**. Two socket assertions cannot execute because socket creation is denied; two character-device assertions are unexercised despite printing PASS because `mknod` is denied. The raw stock summary is therefore 57 PASS / 2 FAIL, not an independent 59/59 claim.
- Additional controls confirm a correctly generated request passes `--check`, and failing jq returns nonzero without publishing `to-windows` or printing READY.
- Docker/image responses are recording adapters, not independently verified r9 container or namespace behavior. The actual r9 execution in the submitted evidence remains the implementer's evidence.
- PowerShell 7.4.7 Linux remains unavailable at runtime (`Failed to create CoreCLR, HRESULT: 0x8007000E`); the reported 33 module + 92 controlled-script checks and 5.1 static analysis were reviewed as submitted evidence, not rerun here. No Windows, NTFS, store, Authenticode or client SDK check is claimed.
- A first local test attempt exposed the same sandbox socket/device limits; raw output is retained. These are not reported as candidate product failures.
- The VM reboot/recovery and current service readiness are operator evidence only; the reviewer did not connect to the VM. Startup/namespace restoration after a future reboot remains a separate operational item before live publication.

`verify-lan-pki-f4bd578.mjs` records these controls, platform limits and source obligations. Its zero exit means that those explicit observations agree with the reviewed revision; it is not Windows acceptance or approval for enrollment.

## Next action

Apply the focused follow-up prompt in the existing VM session. No downtime, new issuer, image rebuild, r9 re-export, Iran import or real trust-store action is needed for this round. Keep the original request, private draft packet and service intact, version the corrected packet after source review, and keep feature pushing manual. Do not merge this reference branch.
