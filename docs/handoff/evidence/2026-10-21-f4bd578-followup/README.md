# Follow-up to the f4bd578 LAN PKI review (run `2026-10-21-f4bd578-followup`)

This run addresses review `docs/reviews/LAN_PKI_F4BD578_REVIEW.md` (F1, F2, N1, N2) and follows `prompts/CLAUDE_LAN_PKI_F4BD578_FOLLOWUP.md`. Both are on reference branch `review/lan-pki-f4bd578` @ `9905650`, fetched and read with `git show`, not merged. The review accepted the earlier R1–R4 fixes in source. The run started from clean head `f4bd578`.

Boundary throughout:
- source and test corrections only; the preserved service was not touched (§5);
- the VM's existing key, CSR and manifest are unchanged and re-validated read-only;
- no Windows enrollment, no issuer, no trust anywhere; only disposable test PKI and file-backed store stand-ins were used;
- no image rebuild and no r9 re-export;
- `main` is unchanged, PR #1 stays a draft, and nothing was pushed.

## 1. Commits (`f4bd578..HEAD`)

| Commit | Content |
| --- | --- |
| `5cf500e` | N1: portable CSR subject check. N2: type-checked special-file fixtures, plus an optional alternate-OpenSSL pass |
| `7e14887` | F1: import exactly the checked root bytes |
| `bc5267b` | F2: acceptance driver cleanup and recovery, with its Linux model tests; README |
| this commit | this evidence and the plan status |

**Recorded runs.** These used the frozen, clean head `bc5267b` ([`run-info.txt`](run-info.txt)): pinned step 0.31.0, host OpenSSL 3.5.5, Node 24.21.0, PowerShell 7.4.7 image `sha256:663a1728…`, and the r9 OPS image `sha256:8cbabae5…`.

**Alternate OpenSSL.** The existing local image `seyra-test-runner:local` (`sha256:2e758660…`) supplies OpenSSL **3.0.13**, the reviewer's version, with no network.

**Review inputs used unchanged:**
- `reproduce-root-snapshot-f4bd578.sh`, `25df302b…`
- `verify-lan-pki-f4bd578.mjs`, `d553f738…`

## 2. Before and after

| Item | Evidence | `f4bd578` | `bc5267b` |
| --- | --- | --- | --- |
| **F1** unchecked root installed | Reviewer's prepared reproducer, run here for the first time (the reviewer could not start CoreCLR) | **Reproduced.** Exit 1. Root B **is in the store**, A's record was withdrawn, and the output said nothing was trusted. 2 of 94 FAIL ([`reproducer/reproducer-before.txt`](reproducer/reproducer-before.txt)) | Run as written, the reproducer stops in its own setup ([`reproducer-after-asis.txt`](reproducer/reproducer-after-asis.txt)): the boundary line it patches (`ReadAllBytes($CerPath)`) no longer exists, because the boundary now takes bytes. A labelled copy ([`reproduce-adapted.diff`](reproducer/reproduce-adapted.diff)) only checks that the corrected boundary already has the same `swap-root-input` fault with the same variables. Its two assertions pass: B not in the store, record present, exit 0. Suite 100/100 |
| F1 permanent regression | `tests/tls/lan-pki-windows-scripts.tests.ps1` (6 new checks) | n/a | Six checks pass:<br>• the file really was swapped at import time;<br>• B is absent;<br>• frozen A was imported and recorded as added by this workflow;<br>• the store bytes equal A;<br>• undo removes A;<br>• the boundary refuses bytes whose hash is not the checked one.<br>Suite 98/98 |
| **F2** acceptance cleanup | `tests/tls/lan-pki-acceptance-model.tests.ps1`: the actual driver as a process, with a Linux model of its Windows operations | Structural: the old driver had no replaceable operations, so it cannot run outside Windows. The "before" is the review's source finding: after a refused W10 it recursively deleted the folder holding the record. The reviewer verifier's F2 source row is observed | 26/26 across eight scenarios (§3). The verifier's F2 row is not observed |
| **N1** OpenSSL 3.0 subject | [`openssl30/`](openssl30/): `new-server-csr.sh` under OpenSSL 3.0.13 | **Reproduced.** A valid request is refused (`CSR subject is not CN=…`), exit 2 | Created, then `--check` passes. The VM suite's alt-OpenSSL section passes under 3.0.13: create, DNS variant, cross-version `--check` both ways, tampered manifest refused, checker accepts the good packet and refuses wrong IP, clientAuth and over-90-day leaves |
| **N2** fixture coverage | Both VM suites with `mknod`, `mkfifo` and Python socket creation denied ([`suites/nofixtures-wrappers.txt`](suites/nofixtures-wrappers.txt)) | **Reproduced and widened.** The missing **listed FIFO** and **character device** both print PASS. The unlisted FIFO and socket print FAIL as if they were product failures. 59 checks, 4 failed | Each unavailable fixture is **NOT RUN** with its reason: 4 fixtures, 8 assertions, plus 10 alt-OpenSSL assertions, which is 18 NOT RUN in total. 0 failed, 0 setup failures. Nothing is counted as PASS. In the reviewer's verifier, whose own adapter denies `mknod`, the device moves from 2 PASS on `f4bd578` to NOT RUN on the head |

**VM suite on this host.** 69/69 with 0 NOT RUN and 0 setup failures ([`suites/after-vm.txt`](suites/after-vm.txt)). It includes the 10 OpenSSL 3.0.13 assertions and the real r9 validator run (read-only, no network). Every fixture really was created with the intended type here, because Docker `mknod` is permitted on this VM.

**Windows on Linux** ([`suites/after-windows.txt`](suites/after-windows.txt)):
- module checks: 33/33;
- actual scripts against the controlled boundary: 98/98;
- acceptance-driver cleanup model: 26/26.

**Reviewer verifier**, unchanged ([`verifier/`](verifier/)), exits 1 on both trees. That is because its `native-openssl-3.0-subject-format` row is "not observed" on this VM's OpenSSL 3.5.5. N1 was reproduced separately with 3.0.13 above.
- `f4bd578`: the F1 and F2 source rows are observed.
- Head:
  - the F1 and F2 source rows are not observed;
  - its submitted-suite row reports 57 checks with 0 failed and 12 NOT RUN (its denied `mknod`, and no alternate OpenSSL set);
  - `--check` and the jq-failure controls still hold.

The source rows are pattern checks, not Windows execution.

**Windows PowerShell 5.1 static compatibility:** 0 findings for the scripts and 0 for the rewritten driver ([`lint/`](lint/)).
- The scripts' style warnings are unchanged at 61.
- The driver's warnings went from 7 to 21:
  - 11 more `Write-Host` (its output idiom);
  - the model-interface parameters `Step`/`Name`, flagged as unused;
  - one `ShouldProcess` warning on its internal `Remove-TestLink`.

## 3. Corrections

**F1 (`Add-RootTrust.ps1`, `SeyraPki.psm1`).**
- The root file is read **once**. Those bytes are hashed, compared with the independently obtained fingerprint, parsed (the result must be exactly one DER certificate), recorded and imported.
- `Add-SeyraRootStoreEntry` now takes the bytes and their SHA-256, never a path. It re-checks the hash immediately before the store call, for both the real and the test boundary.
- A file changed after the check therefore cannot change what is trusted. The failure message names the exact thumbprint and says only its checked bytes were offered to the store.
- Unchanged: the lock, the pending record before the import, the original pre-existing observation, the account scope and the exact undo. All earlier interruption, declined, pre-existing and wrong-fingerprint regressions still pass.

**F2 (`tests/tls/windows/Test-LanPkiOnWindows.ps1`, still NOT RUN on Windows).**
- **Tracking.** Every item the run creates is tracked.
- **Disposable targets.** Junction targets are in a test-owned work folder, no longer TEMP. Desktop and TEMP are only read.
- **Checked native commands.** Links are removed with `cmd /c rmdir`, with the exit status checked and the link verified gone. `icacls` statuses are checked, and the W3 remedy is verified on the resulting ACL.
- **Cleanup always runs.** `try`/`catch`/`finally` covers an unexpected error or Ctrl+C.
- **Root-gated deletion.** The test certificate, its record and `RECOVERY.txt` are deleted only after the store shows that exact root (thumbprint and SHA-256) is absent. Otherwise they are kept, the account- and thumbprint-bound commands are printed, and the run exits non-zero.
- **No forced retry.** A removal already attempted, for example one the owner declined, is never retried. An error before W10 gets exactly one normal undo.
- **Interruptions.** `RECOVERY.txt` is written before the first import, so a killed run still leaves exact recovery steps. A later run refuses to start until they are done.
- **Links block deletion.** While a link this run created remains, neither test folder is deleted.
- **Model hook.** The driver's Windows operations are a table that a Linux model may replace (`-TestModel`); the driver refuses this on Windows.

Model scenarios:

| Scenario | Result |
| --- | --- |
| A success | W8 declined, W9/W10 accepted. Exit 0, nothing left, one removal |
| B W10 removal refused | Exit non-zero, and no retry: exactly one removal attempt. Kept: the root, the record for exactly that root, the byte-identical certificate, and `RECOVERY.txt` with account SID, thumbprint, SHA-256 and both commands. The next run refuses to start. The documented recovery removes exactly that root |
| C error after import | One cleanup removal; folders deleted; exit non-zero |
| D error after import, cleanup removal refused | State kept, no retry |
| E link cannot be removed | W5/W6 FAIL. Neither folder is deleted, link targets stay intact, and the trust part is still cleaned exactly |
| F `icacls /remove:g` fails, or `/grant` fails | Reported as FAIL or as a setup failure; no claim made |
| G process killed after import | Root, record and the pre-written `RECOVERY.txt` remain; the next run refuses to start |
| H folder-only self-test | No trust step; nothing left |

In every scenario, an unrelated pre-existing root and the Desktop stay untouched.

**N1 (`new-server-csr.sh`).** The subject is compared with `-nameopt RFC2253`, which gives `subject=CN=<ip>` on both OpenSSL 3.0 and 3.5. The display format affects only validation, so the existing VM request is not regenerated or rotated.

**N2 (`tests/tls/test-lan-pki-vm.sh`).**
- A failed fixture mutator is a **setup failure**, and the run fails.
- Special files must have exactly the intended type (`p`, `s`, `c`, `l`, `d`, and unreadable `f`). Otherwise their assertions are **NOT RUN** with the reason.
- The summary reports checks, failed, NOT RUN assertions and setup failures separately.
- The bounded FIFO assertions and the mandatory-validator failure checks are kept.

**Defects found during this round** (all fixed before the commits above, kept here for honesty):
- the driver deleted the work folder holding a junction's target while that junction could not be removed. It never deleted through the link, but it left a dangling junction. Model scenario E caught it;
- in the model test, `$d` and `$D` (Desktop) are the same PowerShell variable, which made LocalAppData look protected. That was a test-only defect;
- pwsh's error view can wrap inside a word, so that assertion matches the driver's own unwrapped lines.

## 4. What each kind of test exercises

| Kind | What ran | Result |
| --- | --- | --- |
| Linux, real tools | VM suite: real openssl/jq/step, real r9 validator (read-only, no network), recording stand-in, OpenSSL 3.0.13 pass | 69/69, 0 NOT RUN |
| Linux, fixtures denied (emulated) | Same suite with `mknod`/`mkfifo`/socket creation failing | 51/51 run, 18 NOT RUN, 0 PASS claimed for missing fixtures |
| Linux PowerShell 7.4.7 | Module 33; actual scripts against the controlled boundary 98; acceptance-driver cleanup model 26 | all pass |
| Static Windows PowerShell 5.1 | PSScriptAnalyzer 1.23.0 compatibility rules | 0 findings |
| Real Windows / NTFS / CurrentUser\Root | `Test-LanPkiOnWindows.ps1` W1–W10 | **NOT RUN** |
| Client SDK tests | unchanged by this round | not run in this round |

**Still NOT RUN on Windows:**
- every W1–W10 case;
- the real `Get-Acl`/`icacls`/`cmd rmdir`/junction/`X509Store` paths and the confirmation dialogs;
- execution under Windows PowerShell 5.1 or PowerShell 7 on Windows;
- Authenticode and the step.exe download.

The Linux models are not Windows evidence.

## 5. Preserved service, request and packet

**Service.** A read-only check at 09:01:42Z showed:
- the same host container, started 07:16:49Z, 0 restarts, restart policy unchanged;
- the same seven inner containers;
- `ready` with all providers OK;
- a baseline identical to the 08:01Z record apart from uptime text.

Startup persistence after a reboot remains a separate operational item. Identities and the dataset binding are kept in the private record.

**Request.** The VM request re-validates with the head's `--check`. Nothing has arrived from Windows.

**Packet.** The private v2 draft stays unchanged and marked superseded; it was never released. A v3 draft (scripts from `bc5267b`, the corrected driver, versioned instructions and a hash list) is staged privately, marked not for use, and has not been given to the owner. No issuer key and no trust before review.

## 6. Reproduce

The paths and the alternate image are placeholders.

```bash
STEP_LINUX=<step-0.31.0-linux> DOCKER_RUN_IMAGE=docker:29.8.2-dind OPS_IMAGE=seyra/ops:1.0.0-seyra1 OPS_IMAGE_ID=<id> OPENSSL_ALT_IMAGE=<image with bash, jq, OpenSSL 3.0> tests/tls/test-lan-pki-vm.sh
STEP_LINUX=<step-0.31.0-linux> PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 DOCKER_RUN_IMAGE=docker:29.8.2-dind tests/tls/test-lan-pki-windows.sh
PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 tests/tls/lint-lan-pki-windows.sh [tests/tls/windows]
```
