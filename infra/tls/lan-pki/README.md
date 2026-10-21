# Seyra LAN private PKI (two-tier, manual issuance)

Selected in `docs/planning/MAP_LAN_PRIVATE_PKI_DECISION.md` (planning branch): Smallstep CLI on the
operator's Windows PC, an encrypted **root** (EC P-256, path length 1, 5 years) used only to issue an
encrypted **issuing CA** (path length 0, 1 year), which signs the serving VM's **server certificate**
(90 days, CA false, digitalSignature, serverAuth only, SAN exactly the VM's LAN IP plus an already
existing internal DNS name if there is one). No CA service, ACME or online enrolment; no CRL/OCSP/AIA.

The issuer keys never leave the Windows PC; the server key never leaves the VM. Only public files move:
the CSR + request manifest (VM → Windows) and the public packet (Windows → VM). The older
`infra/tls/dev-issuer.sh` (unencrypted single-tier development root) is NOT used for this hierarchy.

| Where | Tool | Purpose |
| --- | --- | --- |
| VM | `new-server-csr.sh <new-private-dir> <ip> [<existing-dns>]` | server key (0400) + exact CSR + `request-manifest.json`, all checks independent of OpenSSL's exit status; every step checked, public files published as `to-windows` only after the whole request validates (a failure exits non-zero and leaves only `to-windows.incomplete`); `--check <dir>` re-validates an existing request without changes |
| Windows | `windows/New-PkiFolder.ps1` | `%LOCALAPPDATA%\SeyraPKI`; refuses synchronized, shared, temporary, roaming, system and too-broad locations and links/junctions/network paths before any change; sets an owner-only access list only on a folder it has just created (not recursive); checks the whole tree (owner, links, foreign explicit/inherited/deny entries, encrypted issuer keys) and never repairs an existing folder: it stops with a one-item remedy. The other Windows scripts repeat this read-only check before using the folder |
| Windows | `windows/Get-StepCli.ps1` | pinned step v0.31.0, SHA-256 checked before extraction |
| Windows | `windows/New-RootCa.ps1`, `New-IssuingCa.ps1` | encrypted CA keys (passwords typed at step's prompts), extensions/dates verified |
| Windows | `windows/Sign-ServerCsr.ps1` + `server-leaf.tpl` | verifies the CSR against its manifest, signs with a server-only template, verifies the result (every certificate time compared in UTC) and its actual chain for the IP with the root as the only trust anchor; `-CheckIssuedDir <Base>\issued\<stamp>` re-checks an existing, explicitly named attempt against the delivered request without signing, writing or deleting anything |
| Windows | `windows/Export-PublicPacket.ps1` | from an explicitly named attempt, after re-checking the leaf and its chain: the five public files + `issued-manifest.json` (UTC times; `renew_before` is a UTC date); refuses private keys; never overwrites an existing packet |
| VM | `check-returned-packet.sh` | structure first (real directories, exactly five regular files: FIFOs, devices, links, extra or nested entries abort before any read), then binding to the VM key/CSR, purposes, names, lifetimes, chain (tool or read errors abort), then, only for an otherwise valid packet, the importing bundle's own `tls import` validation (read-only, no network; must exit 0 with exactly the expected OK line) |
| VM | `seyra-maps tls import --cert server.crt --chain intermediate_ca.crt --ca root_ca.crt --key <vm key> --names <ip>` | the reviewed, journalled import; then `proxy restart` |
| Windows | `windows/Test-SeyraTls.ps1` | served chain verified with the explicit root file (no trust installed) |
| Windows | `windows/Add-RootTrust.ps1` / `Remove-RootTrust.ps1` | `Cert:\CurrentUser\Root` only, after an independent fingerprint comparison; one run at a time; a durable `pending` record (with whether the root already existed) is written before the store changes and reconciled after an interruption; the root file is read once and exactly those checked bytes are recorded and imported (never the file again); undo removes only the exact root this workflow added (thumbprint and SHA-256, same account) and refuses damaged or foreign records |
| Windows | `windows/Test-SeyraHttps.ps1`, `Test-SeyraSource.ps1` | service checks with normal validation; single fresh requests for source-boundary checks |

Run the Windows scripts with `powershell -NoProfile -ExecutionPolicy Bypass -File .\<script>.ps1` (process
scope only). They target Windows PowerShell 5.1 and PowerShell 7.

**Trust scope.** A root in `Cert:\CurrentUser\Root` is trusted by every program of that Windows account
that uses the Windows store, for any name the hierarchy signs, not only the VM. It does not reach other
accounts, LocalMachine, phones, emulators, containers or Node.js (which needs `NODE_EXTRA_CA_CERTS`).

**curl.exe on Windows** (Schannel) hard-fails revocation checking for certificates without CRL/OCSP
locations. The tests use step (Go TLS) with the explicit root and PowerShell's web client instead; never
use `--ssl-no-revoke`/`-k` as a substitute for a real check.

**Renewal.** Server: before the last 30 days (`renew_before` in `issued-manifest.json`), new VM key/CSR,
re-sign, re-import, `proxy restart`; trust unchanged. Issuing CA: yearly with the root key. Revocation is
manual: re-issue, or rotate the issuing CA/root and update every installed trust.

Tests (kept separate by what they actually exercise):
- `tests/tls/test-lan-pki-vm.sh`: VM scripts, including injected tool failures and a recording docker
  stand-in for the packet checker, plus one real read-only/no-network run of the bundle's validator.
  Special-file fixtures are type-checked (an unavailable one is NOT RUN, never PASS); with
  `OPENSSL_ALT_IMAGE` the scripts also run under another OpenSSL (e.g. 3.0).
- `tests/tls/test-lan-pki-windows.sh`: module checks and parsing under PowerShell 7 on Linux with the
  Linux step build, and the actual folder/trust scripts against a controlled boundary
  (`tests/tls/lan-pki-test-boundary.ps1`: fixture profile with an NTFS-like ACL model, a directory as the
  root store, fault injection). Not real NTFS or a real certificate store.
- `tests/tls/lan-pki-acceptance-model.tests.ps1` (run by the same script): the cleanup and recovery of the
  real-Windows acceptance driver itself, with a Linux model of its Windows operations. Not Windows evidence.
- `tests/tls/lan-pki-time.tests.ps1` (run by the same script): certificate times in UTC, Asia/Tehran and
  America/New_York, with PowerShell 7's DateTime values and Windows PowerShell 5.1's string form
  (`lan-pki-json51-shim.ps1`), including `Sign-ServerCsr -CheckIssuedDir` and `Export-PublicPacket`.
- `tests/tls/lint-lan-pki-windows.sh`: static Windows PowerShell 5.1 compatibility analysis.
- `tests/tls/windows/Test-LanPkiOnWindows.ps1`: real-Windows acceptance (NTFS ACLs, junctions, and with
  `-IncludeTrustStore` the real `Cert:\CurrentUser\Root` with a throw-away root). Run only on request. Its
  cleanup deletes the test certificate and record only after the store shows that root is gone; otherwise
  it keeps them with `RECOVERY.txt` and exits non-zero, and a later run refuses to start until recovered.
