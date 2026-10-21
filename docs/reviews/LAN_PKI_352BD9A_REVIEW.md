# LAN PKI follow-up review: 352bd9a

**Verdict: accepted for source integration and controlled Windows acceptance. No blocking finding in this change.** This is not evidence that Windows enrollment, client SDKs or the live LAN cutover have passed.

Reviewed head: `352bd9ae95dcb3fe2c68d0722dac520de5aa1260`, following `f4bd578ffe6a7c9f1c59ecb2ec91c363eb154bc9`. The supplied patch SHA-256 is `d662bf889408ac087cabdb8811e8c28ee8974e22c93d668115a3395cb66b99f1`. All 32 final file blobs match the patch's full index hashes. The four commits are `5cf500e`, `7e14887`, `bc5267b` and `352bd9a`.

## Disposition of the previous review

| Item | Assessment |
| --- | --- |
| F1: importing a different root after checking the input file | Accepted. `Add-RootTrust.ps1` reads the certificate once. Hashing, parsing and the trust record use that snapshot. `Add-SeyraRootStoreEntry` takes DER bytes and their expected hash, checks the hash again and constructs the store certificate from those bytes. It does not reopen the external path. The permanent regression changes the original file at the store boundary and checks that only the original, checked certificate is imported. |
| F2: acceptance cleanup losing recovery information | Accepted in source. The driver writes recovery instructions before enrollment, keeps the certificate and record while the exact test root remains or its absence cannot be confirmed, and does not retry a removal already attempted. A remaining test junction prevents deletion of both its containing folder and its target folder. The operations model covers declined removal, exceptions, a killed process, native-command failures and successful cleanup. Actual Windows behavior remains to be exercised. |
| N1: OpenSSL subject formatting | Accepted and independently exercised with OpenSSL 3.0.13. The CSR check uses `-nameopt RFC2253`; creation and read-only revalidation pass without a formatting shim. |
| N2: unavailable fixtures counted as passes | Accepted and independently exercised for the unavailable socket and device fixtures here. Assertions are reported NOT RUN, with reasons. The suite separately reports executed checks, failures, skipped assertions and setup failures. |

The earlier record/lock/exact-undo behavior is retained. This patch changes PKI tooling, its tests and documentation; it does not require an API, proxy, OPS or data-image rebuild, a new operational bundle, or a new VM key/CSR.

## Evidence and limits

Independent reviewer checks are in `verify-lan-pki-352bd9a.mjs` and `lan-pki-352bd9a-verification.json`:

- Node 24.19.0, OpenSSL 3.0.13 and the previously pinned Linux Smallstep CLI 0.31.0.
- The submitted VM suite: **55 checks passed, 0 failed, 14 assertions NOT RUN, 0 setup failures**. Four unavailable assertions concern the socket/device fixtures prohibited by this environment. Ten concern the optional alternate-OpenSSL image, which was not provided.
- CSR creation and read-only `--check` pass. Injected `jq` failure exits non-zero, publishes no ready request and prints no READY message.
- All five relevant Bash scripts pass `bash -n`.

The Docker boundary was an explicit host recorder. It ran the actual Bash scripts, real disposable Step/OpenSSL PKI and the retained TypeScript certificate validator on the host. Recorder image IDs are not independently inspected image evidence. No Docker daemon, real r9 image, VM service, Windows account or trust store was accessed by the reviewer.

The author's committed evidence reports VM 69/69, Linux PowerShell module 33/33, script-boundary 98/98 and acceptance-model 26/26, plus zero static PowerShell 5.1 compatibility findings. Those are author results, not independent Windows results. The reviewer could not execute PowerShell in this environment. No real Windows result is claimed by either review.

## Next step

Release the corrected private v3 packet after comparing its delivered scripts with this reviewed source and checking its file hashes. Start with the normal-user Windows folder acceptance, without `-IncludeTrustStore`. If that passes, the explicit test-store acceptance can follow, with its one-day disposable root and documented recovery behavior. Stop on a failed check or incomplete cleanup.

Successful Windows acceptance permits continuation of the already selected manual issuer/signing workflow. It does not establish web/mobile SDK compatibility. Do not change the live installation while waiting for the owner's actual results and returned public certificate packet. The reboot/startup-persistence item remains separate and must be resolved or explicitly accounted for before live publication; changing the outer restart policy alone is not a substitute for restoring namespace isolation.

The owner may push the reviewed feature history normally after confirming a clean tree at this head. Keep PR #1 draft and leave `main` unchanged. This review branch contains reference material only and must not be merged into the feature branch.
