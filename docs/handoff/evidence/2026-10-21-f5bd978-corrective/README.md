# Corrections to the f5bd978 LAN PKI review (run `2026-10-21-f5bd978-corrective`)

This run corrects review `docs/reviews/LAN_PKI_F5BD978_REVIEW.md` and follows its corrective prompt `prompts/CLAUDE_LAN_PKI_F5BD978_CORRECTIVE.md` (reference branch `review/lan-pki-f5bd978` @ `e90ed62`, fetched and read with `git show`, not merged). It started from local head `f5bd978` (one commit on `d570074`, not pushed). Boundary throughout:
- source and tooling correction only;
- the preserved serving installation was not started, stopped, reconfigured or deployed to (it did go down once, from the VM reboot described in §6);
- no certificate import, edge publication, firewall/routing change, data rebuild or image rebuild (r9 retained);
- no Windows enrollment and no trust added anywhere: only disposable test PKI material was used;
- the VM's existing server key, CSR and request manifest are preserved: they re-validate with the new `new-server-csr.sh --check`;
- `main` is unchanged, PR #1 stays a draft, and nothing was pushed.

## 1. Commits (`f5bd978..HEAD`)

| Commit | Content |
| --- | --- |
| `0a91f32` | R3, R4: VM-side scripts fail closed, with regressions |
| `f35a90a` | R1, R2: Windows folder boundary and recoverable trust record, with controlled-boundary tests |
| `2b7981a` | Windows PowerShell 5.1 analysis script and a real-Windows acceptance script (not run) |
| this commit | this evidence and the plan status |

The recorded runs below used the frozen, clean head `2b7981a` ([`run-info.txt`](run-info.txt)): pinned step 0.31.0, OpenSSL 3.5.5, Node 24.21.0, PowerShell 7.4.7 image `sha256:663a1728…`, and the r9 OPS image `sha256:8cbabae5…` (the id in the r9 bundle manifest).

## 2. Reproduction and before/after

**Reviewer verifier** (`verify.mjs`, SHA-256 `5bbf4c5e5f49a6f5fbd37c9534795339f08212a692fb36b1b576f9922ebc2ea4`, unchanged):
- On an untouched `git archive` of `f5bd978` it exited 0, meaning every defect row was observed ([`verifier/verifier-before.json`](verifier/verifier-before.json)): FIFO hang (exit 124), validator exit 42 accepted, CSR manifest of size 0 reported as success, and the R1/R2 source patterns.
- On the fixed head it exits 1. R3's two rows are not observed. It then stops with a **harness error** at R4: the R4 row stats `to-windows/request-manifest.json` unconditionally, and that path is, by design, no longer published after a failure ([`verifier/verifier-after.json`](verifier/verifier-after.json)). That error is not counted as evidence for anything.
- A labelled copy changes only those three `statSync` calls to a missing-file-safe size ([`verifier/verify-guarded.diff`](verifier/verify-guarded.diff)). On `f5bd978` it reproduces the original result (all 8 rows observed). On the head ([`verifier/verifier-guarded-after.json`](verifier/verifier-guarded-after.json)):
  - the controls still hold: the reviewer's host adapter runs our VM suite with 59 checks and 0 failed, the valid packet is accepted, and the bad hash is refused;
  - R3 FIFO (exit 1, prompt), R3 validator exit 42 (refused), R4 (exit 2, manifest `missing`) and the R1/R2 source patterns are all **not observed**. The R1/R2 rows are source-pattern checks only, not Windows execution.

**Desired-behavior regressions.** The same frozen test sources were run against the `f5bd978` scripts and the fixed scripts:

| Finding | Regression (actual scripts) | `f5bd978` | Fixed |
| --- | --- | --- | --- |
| R4 CSR publication | `tests/tls/test-lan-pki-vm.sh`, 20 CSR checks (normal request with and without a DNS name; jq missing, jq exit 42, jq empty output, cp failure; `--check` on a good and a tampered request) | **10 of 20 FAIL** | 20/20 |
| R3 returned packet | same suite, 39 packet checks: 12 content cases, including one **real r9 validator run** (`--network none --read-only`), plus 27 against a recording docker stand-in | **21 of 39 FAIL** | 39/39 |
| R1 folder boundary | `tests/tls/lan-pki-windows-scripts.tests.ps1` (actual `New-PkiFolder.ps1`, `New-RootCa.ps1`), controlled boundary | structural, see below | part of 92/92 |
| R2 trust record | same file (actual `Add-RootTrust.ps1`, `Remove-RootTrust.ps1`), file-backed store with fault injection | structural, see below | part of 92/92 |
| unchanged module checks | `tests/tls/test-lan-pki-windows.sh` (verification module) | n/a | 33/33 |

Outputs: [`suites/before-vm.txt`](suites/before-vm.txt), [`suites/after-vm.txt`](suites/after-vm.txt), [`suites/after-windows.txt`](suites/after-windows.txt).

Details on the VM rows:
- **Hangs no longer count as rejections.** The structural cases require the checker to exit non-zero by itself, with `ABORTED` as its last line. A 124/137 from the 20 s bound is reported as a hang. On `f5bd978`, both FIFO cases end with rc=124. Their "did not reach product validation" rows pass only because the hang never got that far.
- **Product validation reached or not.** A recording docker stand-in shows this for structural failures: a FIFO, socket, character device, symlinked file or root, nested directory, unreadable file, corrupt certificate or malformed manifest never reaches it. The device case is a `/dev/null` clone made with `mknod` in the test's container.
- **Validator output.** On `f5bd978`, these were accepted: exit 42 after `OK`, an extra output line, and an `OK` line carrying another certificate's fingerprint.
- **`--check` before the fix.** It did not exist in `f5bd978`, which took `--check` as the directory and refused the path as a non-canonical IP. So that one "before" failure is a missing feature, not a defect.

**R1/R2 "before" is structural.** The `f5bd978` Windows scripts call `icacls`, `Get-Acl` and `Cert:\CurrentUser\Root` directly, with no boundary to substitute. On Linux they fail on the missing Windows commands, which would say nothing about R1/R2. Their "before" state is therefore the review's source finding, as the verifier's source-pattern rows show. It was **not** reproduced on Windows here.

## 3. Corrections

| # | Change | Where |
| --- | --- | --- |
| R3 | **Structure first, no payload read.** Packet and request roots must be real directories. The packet must be exactly the five names as regular files: a FIFO, socket, device, symlink, extra or nested entry aborts, and so does any listing error.<br>**Content.** Tool, read and parse errors abort; grep exit 2 is not "no private key". `abort` writes to stderr, and every helper result is assigned with `\|\| exit 1`. An abort inside `$(…)` therefore ends the run instead of becoming a value; this is a defect found and fixed during this round.<br>**Product validation**, only for an otherwise valid packet. `docker image inspect` must succeed and match the expected id. The validator container must exit 0 and print exactly one `OK <SANs> <days> <fingerprint>` line, matching the requested SANs, at most 90 days and the leaf's own fingerprint. Both steps are bounded by timeouts. | `infra/tls/lan-pki/check-returned-packet.sh` |
| R4 | **Every step checked.** Required tools are checked first. Every generation, chmod, copy, hash, jq serialization and write is checked.<br>**Publication.** Public files are assembled in `to-windows.incomplete`. The key (0400, P-256, valid), CSR (signature, subject, exact SANs and extensions) and manifest (schema, content, CSR hash, single-key binding) are validated. Only then is the folder renamed to `to-windows` and validated again.<br>**Failure.** It exits non-zero, never prints `READY`, and leaves the incomplete folder named as such.<br>**`--check <dir>`** validates an existing request without changing it. | `infra/tls/lan-pki/new-server-csr.sh` |
| R1 | **Before any change**, these `-Base` locations are refused: in, equal to or above a Desktop, Documents, OneDrive, roaming, temp, public or system folder; equal to or above the profile or `%LOCALAPPDATA%`; a network/device path; a sync-client name; a path through a link, junction or network drive.<br>**ACL changes.** The owner-only access list is set only on a folder this run has just created (`icacls` on that folder, no `/T`). An existing folder must hold only the SeyraPKI subfolders and is checked, never repaired.<br>**Tree check.** The whole tree is walked without following links. Every entry must be owned by the account, be no link or junction, and carry no allow or deny entry for anyone else, explicit or inherited. Existing issuer keys must still be encrypted.<br>**On a problem**, it stops with the item and a remedy that touches only that item: `icacls … /remove:g *SID`, `/inheritance:r` on that folder only, or removing just the link. It never takes ownership.<br>**Other scripts.** `New-RootCa`, `New-IssuingCa`, `Sign-ServerCsr`, `Export-PublicPacket` and `Get-StepCli` repeat this read-only check, again after creating keys or extracting tools. | `infra/tls/lan-pki/windows/New-PkiFolder.ps1`, `SeyraPki.psm1`, the other scripts |
| R2 | **Before any store change.** Only one run at a time (an OS lock on `trust\trust.lock`; a left-over file does not block). The record folder must pass a write/flush/rename/delete probe. A durable `pending` record is written, holding the exact SHA-256, thumbprint, account SID, store and the original "already trusted" observation.<br>**After the import**, the store is re-read. Present means `trusted`, including an import that took effect and then reported an error. Absent means nothing is trusted and the pending record is withdrawn.<br>**Re-run.** A re-run reconciles a pending record with the store and keeps the original observation, so a root this workflow added is never reclassified as pre-existing. "Trusted but absent" stops with the next step.<br>**Undo** removes only the exact root (thumbprint and SHA-256, same account), and only when it was not pre-existing.<br>**Bad records.** A damaged, foreign-account, other-store, other-root or malformed-timestamp record stops the run unchanged, with recovery steps.<br>**Writes** are atomic (temp file, flush to disk, read-back, replace). PowerShell 7's automatic JSON date parsing is normalized; without that, a re-run rewrote the original observation time in a locale format, which was found and fixed during this round. | `Add-RootTrust.ps1`, `Remove-RootTrust.ps1`, `SeyraPki.psm1` |
| Test boundary | **Boundary functions.** The Windows-only operations (account, ACL read, owner-only ACL on a new folder, CurrentUser\Root find/add/remove, protected-folder list) are small boundary functions in the module. `SEYRA_TEST_BOUNDARY` lets a Linux test substitute them; the module **refuses it on Windows**.<br>**Test-only stand-in.** `tests/tls/lan-pki-test-boundary.ps1` provides:<br>• an NTFS-like ACL model: explicit entries, plus the parent's inheritable entries unless protected;<br>• a directory standing in for the store;<br>• faults: import refused, import effective then error, import then crash, import then read-only record folder, slow import, removal refused. | `SeyraPki.psm1`, `tests/tls/` |

## 4. What each kind of test exercises (kept separate)

| Kind | What actually ran | Result |
| --- | --- | --- |
| Linux, real tools | `test-lan-pki-vm.sh`: real `openssl`, `jq`, pinned step 0.31.0, real r9 OPS validator (read-only, no network); recording stand-in for the failure modes | 59/59 |
| Linux PowerShell 7.4.7, module | `test-lan-pki-windows.sh` part 1: parse every script; verification module with step-built material | 33/33 |
| Linux PowerShell 7.4.7, actual scripts, controlled boundary | `test-lan-pki-windows.sh` part 2: 21 pure path/ACL policy checks, 35 R1 and 36 R2 assertions on actual script runs | 92/92 |
| Static Windows PowerShell 5.1 compatibility | `tests/tls/lint-lan-pki-windows.sh`: PSScriptAnalyzer 1.23.0, compatibility rules for syntax 5.1 and the `win-48_x64_10.0.17763.0_5.1.17763.316` profile | 0 findings (scripts and the acceptance script); `f5bd978` also 0 |
| Real Windows / NTFS / CurrentUser\Root | `tests/tls/windows/Test-LanPkiOnWindows.ps1` | **NOT RUN** (§5) |
| Client SDK tests | unchanged by this round | not run in this round |

Style warnings, informational ([`lint/`](lint/)): 49 before and 61 after. The 61 are 53 `Write-Host` (the scripts' output idiom), 2 `ShouldProcess` on internal boundary helpers (`Set-SeyraOwnerOnlyAcl`, `Remove-SeyraRootStoreEntry`), and the 6 pre-existing ones. Earlier ad-hoc runs had passed only rule options, so the default style rules were counted as "compatibility" findings. The script now restricts that pass to the three compatibility rules.

## 5. Windows cases NOT RUN

Nothing in this round executed on Windows. These are prepared, and their status stays NOT RUN until actually executed:
- **W1–W7 (`Test-LanPkiOnWindows.ps1`):** real NTFS, in a disposable `%LOCALAPPDATA%` folder:
  - W1 fresh folder (protected, one entry, owner);
  - W2 reuse with unchanged SDDL;
  - W3 a foreign explicit ACE on a key file, refused with the one-entry remedy, then accepted after applying it;
  - W4 Desktop itself, refused with its SDDL unchanged;
  - W5 a junction child;
  - W6 a Base reached through a junction;
  - W7 `SEYRA_TEST_BOUNDARY` refused on Windows.
- **W8–W10 (`-IncludeTrustStore`):** real `Cert:\CurrentUser\Root` with a one-day throw-away root whose key is never written:
  - W8 declined import;
  - W9 accepted import (record `trusted`, not pre-existing);
  - W10 exact undo.

  This adds real trust briefly, so it runs only on explicit request.
- **Untested Windows behavior:**
  - the real Windows code paths of the boundary functions (`Get-Acl` with SIDs, `icacls`, `X509Store` add/find/remove, the confirmation dialogs, `File.Replace` and `FileShare.None` locking on NTFS);
  - runtime execution under Windows PowerShell 5.1 (only static analysis was done);
  - PowerShell 7 on Windows;
  - Authenticode and the step.exe download (unchanged).
- **Not reproduced on Windows:** the interruption and pre-existing-root cases of R2 were tested only through the controlled boundary.

## 6. Preserved service and the 2026-10-21 VM reboot

**VM reboot.** The VM rebooted at about 06:38Z, outside this work. The preserved host container has restart policy `no`, so it stopped.
- PostgreSQL logged a clean fast shutdown.
- It was restored with its own installation:
  - the same container was started;
  - the inner services started by themselves;
  - the lab harness's non-persistent sink route and egress chain were re-created exactly as at host creation.
- It reported `ready` at 07:17:30Z, an outage of about 39 minutes.
- The restart policy was left unchanged; that remains the owner's decision.
- **Tooling loss.** Scratch storage (tmpfs) lost the pinned Linux step build. It was downloaded again, checked against the pin (`a7e13726…`), and kept in a persistent preparation path.

**Read-only check after this round (08:01:00Z).** Nothing was restarted or reconfigured after the recovery.
- The host container is the same one, started at 07:16:49Z, with 0 restarts.
- The seven inner containers have the same IDs as the post-recovery baseline.
- Readiness is `ready` for the active dataset with all four providers.
- The baseline is otherwise identical, apart from uptime text.

Identities, addresses and the dataset binding are kept in the private record.

## 7. Operator packet and next steps

- The private Windows packet prepared from `f5bd978` (v1) is **withdrawn**. Its scripts and instructions were moved aside unchanged and marked superseded. The VM's transfer folder now holds only the request and a withdrawal notice.
- A v2 draft is staged privately: the scripts from `2b7981a`, the acceptance script, and exact download, transfer and step-by-step instructions with a self-test step. It is marked not for use and has not been given to the owner.
- After review of the corrected scripts, the next steps are:
  1. release v2;
  2. the owner's Windows steps;
  3. packet validation on the VM;
  4. the edge reload rehearsal;
  5. the authorized r9 cutover (prompt `7cf8107`).
- No issuer key is to be created and no trust added before that review.

Reproduce (placeholders for local paths):
```bash
STEP_LINUX=<step-0.31.0-linux> DOCKER_RUN_IMAGE=docker:29.8.2-dind OPS_IMAGE=seyra/ops:1.0.0-seyra1 OPS_IMAGE_ID=<id> tests/tls/test-lan-pki-vm.sh
STEP_LINUX=<step-0.31.0-linux> PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 DOCKER_RUN_IMAGE=docker:29.8.2-dind tests/tls/test-lan-pki-windows.sh
PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 tests/tls/lint-lan-pki-windows.sh
```
