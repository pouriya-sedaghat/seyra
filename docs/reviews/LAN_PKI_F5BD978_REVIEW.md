# Review of LAN PKI preparation at f5bd978

**Disposition: request changes before running the new issuer/trust scripts on the owner's Windows account or starting the live LAN cutover.** Keep the original service running. The selected two-tier PKI remains suitable; this review concerns implementation failure handling, not a change of issuer design.

## Reviewed input and scope

- Commit: `f5bd9780c9781e5ac829df50ae12694475abe610`, one commit after the pushed `d5700749b68929d86f1f468cc61be41f7d741a64`.
- Uploaded patch SHA-256: `44eeb78d97818e33218c590750f12357983b6ec7154710c427f3af08a8d92a2f`.
- All 18 reconstructed files match their full Git blob IDs in the patch; 970 added lines, no existing product/image/lock changes.
- Reviewed all added Bash/PowerShell scripts, template, README and both test harnesses. No owner VM, Windows store, live key, issuer or endpoint was accessed.
- Independent execution: Node 24.19.0, OpenSSL 3.0.13, official Linux Smallstep CLI 0.31.0. The VM's Node/OpenSSL versions differ.
- Official release checksums match the downloaded test tools: Step Linux `a7e13726efa8782f3d5459174dacf602ab3514b9431f2d42a6a75950b7685e5f`; PowerShell 7.4.7 Linux `cfd57927b7a0d9f2da400471ea8dadc3ceb52f5e4a4a9a51c20495b4071f055a`. The two Windows ZIP pins in `Get-StepCli.ps1` also match official `checksums.txt`. This is checksum verification, not a claim of independently verified Fulcio/Rekor evidence.

## Findings

### R1 — P2: the private-folder success verdict does not cover child ACLs

`infra/tls/lan-pki/windows/New-PkiFolder.ps1:23-36`

On a reused base, `icacls /inheritance:r /grant:r <owner> ... /T` removes inherited entries and replaces the named owner's grant; it does not remove a different principal's explicit child-file/directory grant. The only `Get-Acl` checks `$Base`, so an owner-only base with a child issuer-key file carrying an explicit foreign read grant can finish with `ok only <owner> has access`. Parent traversal is not an adequate substitute for checking the child DACL: Windows callers commonly have bypass-traverse privilege.

The path refusal also misses an exact local Desktop/Documents directory: it checks only `StartsWith(forbidden + '\\')`. Passing the forbidden directory itself can therefore reach the recursive ACL mutation rather than being refused. Do not recursively change an unrelated user directory while setting up PKI.

Required: fail before mutation for unsafe equal/descendant paths and reparse/redirected locations; enforce or refuse foreign explicit permissions throughout the managed key subtree, and verify the actual result for root, key directories and existing key files. A fresh default folder and safe reuse must still work. Prefer an explicit, narrow ownership/ACL policy over broad recursive repair of unknown directories.

**Evidence level: source review plus documented Windows semantics, not a real NTFS execution.** Prepare a real Windows regression and keep its execution status explicit. A recorder/model test can exercise the orchestration meanwhile.

- [Microsoft icacls semantics](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
- [Microsoft traversal privilege and file access](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/checking-for-traverse-privilege-on-irp-mj-create)

### R2 — P2: a successful trust import can lose the information needed for its promised undo

`infra/tls/lan-pki/windows/Add-RootTrust.ps1:30-40`; `Remove-RootTrust.ps1:12-15`

The script imports into `Cert:\CurrentUser\Root` before writing the record that says the root did not pre-exist. If the process dies or the record write fails after import, the trusted root remains without a record. A retry sees that root as already present and writes `pre_existing = true`; the supplied removal script then refuses to undo the trust this workflow actually introduced.

Required: publish a validated, recoverable public state record before the store mutation, preserving the original pre-existing observation across retries. Reconcile interrupted states against the exact current-account store entry and fingerprint; handle an import that took effect before reporting an error. Undo must remove only a root introduced by this workflow and must never remove one that genuinely pre-existed. A full disk or blocked record destination must be discovered before import.

**Evidence level: source-backed interruption sequence, not actual Windows store execution.** Test the actual scripts with a controlled store boundary and fault injection after import/before final publication, plus the genuine-pre-existing case. The real CurrentUser acceptance check remains a later manual Windows step.

### R3 — P2: the returned-packet gate keeps reading rejected objects and ignores validator exit status

`infra/tls/lan-pki/check-returned-packet.sh:26-30,60-67`

Two executions demonstrate the gate is not fail-closed at its boundaries:

1. Add an unlisted FIFO to an otherwise valid packet. The entry inventory prints `FAIL`, but the following wildcard `grep` opens the FIFO and blocks. A two-second timeout returns 124; there is no prompt rejection. A symlink or listed special file must likewise be rejected before reads.
2. A Docker boundary returning `OK ...` and then exiting 42 is accepted as `PASS` and the checker exits 0. The script examines the text without checking the `docker run` status.

Required: validate roots, exact allowed names and regular-file types before reading any payload; abort immediately on an invalid inventory or inspection failure. Distinguish a clean no-key match from `grep`/read errors. Require the mandatory validator process to exit zero **and** return the expected successful output. A malformed packet must neither hang nor reach the product validation boundary.

**Evidence: actual candidate Bash script**, real pinned-Step certificate chain and server key, real retained `validateProposedCertificate` for the normal control. Only Docker/image responses are adapted; no container/image claim is inferred from that boundary.

### R4 — P2: CSR preparation reports success after manifest generation fails

`infra/tls/lan-pki/new-server-csr.sh:43-56`

The generator does not stop/check the `jq` calls, public copy and manifest publication. With `jq` exiting 42, it still exits 0 and prints the public-transfer success message, while `request-manifest.json` is zero bytes. This contradicts the promised complete checked handoff and can send the owner to Windows with an unusable request.

Required: check prerequisites and every copy/serialization/write, validate the complete generated manifest and its bindings before announcing success, and refuse reuse/overwrite of an existing request. A failed operation must be nonzero and clearly leave only an incomplete attempt, not an advertised ready request. Preserve the already generated real VM key/CSR if their existing manifest and bindings validate; do not regenerate them just to exercise this fix.

**Evidence: actual generator, real OpenSSL key/CSR and a failing-jq boundary.** Observed exit 0, empty manifest and a success message.

## Executed checks and limits

| Check | Result / interpretation |
| --- | --- |
| Uploaded patch and reconstructed blobs | SHA-256 matches; 18/18 blob identities match |
| Submitted VM test cases | 20/20 with host adapters for Docker; actual Bash, pinned Step and retained Node TLS validation run |
| Valid returned packet | Accepted; real chain/key/binding checks pass |
| Wrong checksum control | Refused with nonzero exit |
| FIFO packet | Defect reproduced: blocks after reporting invalid inventory; timeout 124 |
| Validator prints OK then fails | Defect reproduced: validator exit 42 is accepted; checker exits 0 |
| jq fails while preparing manifest | Defect reproduced: generator exits 0, manifest is empty |
| Windows ACL and trust-record findings | Source-backed; Windows execution NOT RUN |
| Submitted PowerShell module suite (33 cases) | NOT independently run: verified PowerShell 7.4.7 Linux binary cannot start CoreCLR here (`0x8007000E`) |
| Actual Windows 5.1/7, NTFS, CurrentUser store, Authenticode | NOT RUN; do not replace with a Linux claim |
| VM/Docker/browser/live cutover | NOT RUN or changed by reviewer |

The host adapters run the test-only Step build script directly with its temporary mount path translated. Product checking imports the unchanged `tls.ts`/`proc.ts` through Node's type stripper. They do not emulate isolation or prove the actual r9 image identity. The private keys generated for these tests were disposable and removed; no owner material is in the evidence.

`verify-lan-pki-f5bd978.mjs` is a **reproducer of this reviewed revision**, not an acceptance suite for a fix. Exit zero means its controls passed and the recorded defect observations/source obligations matched. After fixes, use new desired-behavior regressions; do not describe a changed reproducer exit as full acceptance evidence.

## Recommended next step

Use the corrective prompt on this reference branch in the existing VM Claude Code session. Implement and test these focused tooling fixes without service downtime, issuer creation or trust enrollment. No data-image or r9 bundle rebuild is required by these off-host tooling paths. Return a new patch for review, then prepare the exact Windows transfer/run sequence from the corrected scripts. Keep feature push manual, main untouched and PR #1 draft.
