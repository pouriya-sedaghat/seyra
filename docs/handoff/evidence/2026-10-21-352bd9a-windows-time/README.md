# Windows certificate-time correction (run `2026-10-21-352bd9a-windows-time`)

This run addresses review `docs/reviews/LAN_PKI_352BD9A_WINDOWS_TIME_REVIEW.md` and follows `prompts/CLAUDE_LAN_PKI_352BD9A_UTC_CORRECTIVE.md`. Both are on reference branch `review/lan-pki-352bd9a-windows-time` @ `45dde5d`, read with `git show`, not merged. The run started from the pushed head `352bd9a`.

Boundary throughout:
- an off-host Windows-tooling correction only;
- no service restart or reconfiguration, no TLS change, no edge/LAN publication, no image rebuild, bundle export or data import;
- the VM's server key, CSR and manifest are unchanged and re-validate (§6);
- the owner's issuer keys and certificates were not touched; nothing was re-signed;
- `main` is unchanged, PR #1 stays a draft, and the new commits are local.

## 1. Owner-run Windows evidence (real Windows PowerShell 5.1)

As supplied through the review. Endpoint, account, folder names and certificate metadata are kept in the private operator record.

| Observation | Result |
| --- | --- |
| Folder acceptance W1–W7 (`Test-LanPkiOnWindows.ps1`) | 14 checks, 0 failed, cleanup ok, exit 0 |
| Full acceptance W1–W10 (`-IncludeTrustStore`) | 17 checks, 0 failed, cleanup ok, exit 0. A first attempt failed at W8 only because Yes was clicked instead of No; the rerun passed |
| Pinned step 0.31.0 for Windows | Archive SHA-256 matched the pin; Authenticode **NotSigned** (recorded as observed) |
| Root and issuing CA | Created with encrypted keys; extension checks passed; issuing CA verified against the root |
| Server certificate signing | The certificate was written. Every check up to `already valid` passed. It stopped with `CHECK FAILED: already valid` |
| Diagnosis on the PC | Zone UTC+03:30. NotBefore parsed as `DateTimeKind.Local`. The original comparison was False; the same value normalized to UTC compared True |
| Issuance attempt folders | Three; exactly one contains `server.crt` |
| Offline copy of the root key | **Not confirmed** |

## 2. Cause

Step writes certificate times as ISO 8601 strings with a zone (`…Z`), and the two PowerShell versions read them differently:
- **Windows PowerShell 5.1** keeps them as strings. The module's `[datetime]` cast turns such a string into **local** wall-clock time.
- **PowerShell 7** parses them into UTC `DateTime` values.

`Test-SeyraLeafCert` compared that local NotBefore with a UTC "now". `DateTime` comparison ignores `Kind`, so this compares wall clocks of different zones:
- at +03:30 a valid back-dated leaf was refused;
- at a negative offset, a NotBefore hours in the future passed that check. The chain verification by step, which uses real instants, still rejects such a leaf.

`Export-PublicPacket.ps1` formatted `renew_before` from the same local value, so the date was the **local** calendar date, and `not_before`/`not_after` were serialized differently by 5.1 and 7. The CA "does not outlive" comparisons put the same kind on both sides, so they were consistent, but they now use the same explicit UTC path.

## 3. Correction (`d2cc904`)

**`SeyraPki.psm1`:**
- `ConvertTo-SeyraUtc` produces one UTC instant from:
  - an ISO 8601 string with `Z` or an explicit `±hh:mm` offset;
  - a `DateTime` of kind Utc or Local (PowerShell 7's JSON values; Local converts back exactly);
  - a `DateTimeOffset`.
- It **refuses** unzoned or malformed strings and `DateTime` values of kind Unspecified, so they are never read in the PC's zone.
- `Format-SeyraUtc` formats in invariant culture.
- `Get-SeyraUtcNow` returns the current UTC time; only the Linux test boundary can fix it, and Windows refuses that hook.
- `Get-SeyraValidity` gives NotBefore/NotAfter in UTC, cross-checked against step's stated length.
- `Test-SeyraCaCert` and `Test-SeyraLeafCert` compare every instant in UTC. Unchanged: the 1-minute not-yet-valid allowance, the 89–90.01-day lifetime window and the issuer bounds.

**Chain verification.** `Test-SeyraIssuedChain` checks the actual leaf chain for the IP with the pinned step: `step certificate verify <leaf+issuing bundle> --roots <root> --host <ip>`. The pinned tool's semantics were established before use:
- intermediates are read only from the certificate file, so the leaf alone fails;
- trust anchors come only from `--roots`;
- `--issuing-ca` is for OCSP/CRL, not an intermediate;
- passing the intermediate as `--roots` would wrongly succeed, so it is never done;
- validity is enforced at the current time.

The temporary bundle lives in its own temporary folder. Previously signing wrote `server-chain.pem` into the issued folder.

**`Sign-ServerCsr.ps1 -CheckIssuedDir <Base>\issued\<stamp>`** is the recovery path. It re-checks an existing, explicitly named attempt and is never chosen by age:
- `server.crt`, `server.csr` and `request-manifest.json` must be present;
- `server.csr` and `request-manifest.json` must be byte-identical to the delivered request;
- then the same leaf checks and the chain verification run.

It signs, writes and deletes nothing.

**`Export-PublicPacket.ps1`:**
- Takes an explicit attempt only.
- Re-checks the leaf and its chain before writing.
- Writes all times as UTC `yyyy-MM-ddTHH:mm:ssZ`; `renew_before` is the UTC calendar date 30 days before NotAfter.
- Never overwrites an existing packet.
- Its Windows-only path literals (`'root\root_ca.crt'`) are replaced by nested `Join-Path`, so the actual script runs under the Linux tests.

## 4. Regression evidence (`f59318e`; recorded on frozen head `f59318e`, [`run-info.txt`](run-info.txt))

**Where the time suite runs.** `tests/tls/lan-pki-time.tests.ps1` runs in the PowerShell 7.4.7 container. TZ is set to UTC, `Asia/Tehran` (+03:30) or `America/New_York` (-04:00 on this date). The host's zone database is mounted read-only, and each run first **asserts that its offset took effect**. A first attempt without the zone database silently ran in UTC; it was discarded and is why this assertion exists.

**JSON forms.** Each zone runs with:
- PowerShell 7's native `DateTime` form;
- **Windows PowerShell 5.1's string form**, emulated by `lan-pki-json51-shim.ps1`, a global `ConvertFrom-Json` that keeps dates as strings. The module's own `Get-SeyraCertInfo` uses it, so the actual helpers see the 5.1 form.

**Reference times.** Deterministic reference times are computed in UTC by the harness, and a fixed clock is set through the test boundary.

| Check | `352bd9a` (5.1 form) | Fixed (every zone, both forms) |
| --- | --- | --- |
| Valid back-dated leaf (NotBefore now−5m) accepted | **FAIL at +03:30** (`CHECK FAILED: already valid`: the owner's failure); passes in UTC and -04:00 | pass |
| NotBefore 2 h in the future refused | **FAIL at -04:00** (accepted); refused in UTC and +03:30 | pass |
| `renew_before` for a leaf ending 22:45Z / 01:15Z | Comparator demo of 352bd9a's expression: **+1 day at +03:30** (22:45Z leaf) and **−1 day at -04:00** (01:15Z leaf). The script itself cannot run on Linux at 352bd9a (Windows-only paths) | The actual `Export-PublicPacket` writes the exact UTC instants and the UTC date in every zone |
| Same checks, PowerShell 7 native form | pass everywhere: the defect needs the 5.1 string form and a non-UTC zone | pass |
| Allowance edges (NotBefore +30 s accepted, +2 min refused) | not testable (no fixed clock) | pass |
| Z / +03:30 / −04:00 forms of one instant equal; PS7 JSON `DateTime`, a Local-kind cast and `DateTimeOffset` keep the instant | – | pass |
| Unzoned, malformed or invalid strings, Unspecified-kind `DateTime`, `$null` and numbers refused | – | pass |
| Leaf outliving its issuing CA refused | pass | pass |
| Recovery: `Sign-ServerCsr -CheckIssuedDir` | not present | See below |
| Export | – | See below |

Recovery, `Sign-ServerCsr -CheckIssuedDir` on the fixed head:
- accepts the named complete attempt, with a trailing separator too;
- refuses an empty attempt, a partial attempt, a folder outside `issued`, an attempt whose `server.csr` is not the delivered request, a leaf for another key and a future NotBefore;
- leaves every attempt **byte-identical** afterwards.

Export on the fixed head:
- exports only the named attempt, with five files and the chain verified;
- refuses to overwrite an existing packet, and refuses an empty attempt and a future leaf;
- changes no attempt.

**Suite totals at the fixed head** ([`suites/`](suites/)):

| Suite | Result |
| --- | --- |
| Module | 33/33 |
| Actual scripts against the controlled boundary (ACL, trust record, snapshot import) | 98/98 |
| Acceptance-driver cleanup model | 26/26 |
| Time checks | 6 × 51/51 |
| Windows PowerShell 5.1 static compatibility ([`lint/`](lint/)) | 0 findings, both before and after. Style warnings 61 → 63: two `Write-Host` lines |

**What these are.**
- Linux PowerShell executions of the actual module and scripts.
- One comparator demonstration, labelled as such.
- The 5.1 form is emulated; it is not Windows PowerShell 5.1.
- No Windows run was made for this correction. The only real-Windows evidence is the owner's (§1).

## 5. Recovery of the existing Windows certificate (prepared; NOT RUN)

A versioned, hashed **update v3.1 draft** is staged privately. Its scripts are byte-identical to `f59318e`; only `SeyraPki.psm1`, `Sign-ServerCsr.ps1` and `Export-PublicPacket.ps1` differ from packet v3. It contains no keys, certificates or tool archives and reuses the installed step. It is **not released**, pending review. The sealed v3 packet and the owner's PKI folder are unchanged.

Owner-run sequence, with the real paths in the private instructions:

1. List `issued\*` and their files, read-only. Exactly one attempt has `server.crt`; `public\<attempt>` must not exist. Nothing is deleted or moved.
2. Check the received request's SHA-256 against the VM's CSR hash.
3. Run `Sign-ServerCsr.ps1 -RequestDir <received v3 folder> -CheckIssuedDir <Base>\issued\<attempt>`. This verifies:
   - the root and issuing CA;
   - byte-identity with the delivered request;
   - every leaf property with UTC times;
   - the actual chain for the IP against the root only.

   It needs no password and signs nothing.
4. Run `Export-PublicPacket.ps1 -IssuedDir <Base>\issued\<attempt>`. It refuses if the packet already exists. The printed root fingerprint must equal the owner's paper note.
5. Copy `public\<attempt>` back with an explicit `scp` path.

**The existing leaf is not claimed valid until the owner runs steps 3 and 4.** If it fails a cryptographic or request-binding check, that failure is reported before any new issuance is proposed.

## 6. Preserved service and request

A read-only check at 15:28:46Z showed:
- the same host container, started 07:16:49Z, 0 restarts;
- `ready` with all providers OK;
- egress counter 0;
- a baseline identical to the 13:36Z record apart from uptime text.

The VM request still validates, and the key is unchanged at mode 0400. Nothing has arrived from Windows.

## 7. Reproduce

```bash
STEP_LINUX=<step-0.31.0-linux> PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 DOCKER_RUN_IMAGE=docker:29.8.2-dind \
  [LAN_PKI_BEFORE_WINDOWS_DIR=<an export of 352bd9a infra/tls/lan-pki/windows>] tests/tls/test-lan-pki-windows.sh
PWSH_IMAGE=mcr.microsoft.com/powershell:lts-ubuntu-22.04 tests/tls/lint-lan-pki-windows.sh
```
