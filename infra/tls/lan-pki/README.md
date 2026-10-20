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
| VM | `new-server-csr.sh <new-private-dir> <ip> [<existing-dns>]` | server key (0400) + exact CSR + `request-manifest.json`, all checks independent of OpenSSL's exit status |
| Windows | `windows/New-PkiFolder.ps1` | `%LOCALAPPDATA%\SeyraPKI`, owner-only NTFS ACL, refuses synchronized folders |
| Windows | `windows/Get-StepCli.ps1` | pinned step v0.31.0, SHA-256 checked before extraction |
| Windows | `windows/New-RootCa.ps1`, `New-IssuingCa.ps1` | encrypted CA keys (passwords typed at step's prompts), extensions/dates verified |
| Windows | `windows/Sign-ServerCsr.ps1` + `server-leaf.tpl` | verifies the CSR against its manifest, signs with a server-only template, verifies the result and chain |
| Windows | `windows/Export-PublicPacket.ps1` | the five public files + `issued-manifest.json`; refuses private keys |
| VM | `check-returned-packet.sh` | binding to the VM key/CSR, purposes, names, lifetimes, chain, and the importing bundle's own `tls import` validation (read-only, no network) |
| VM | `seyra-maps tls import --cert server.crt --chain intermediate_ca.crt --ca root_ca.crt --key <vm key> --names <ip>` | the reviewed, journalled import; then `proxy restart` |
| Windows | `windows/Test-SeyraTls.ps1` | served chain verified with the explicit root file (no trust installed) |
| Windows | `windows/Add-RootTrust.ps1` / `Remove-RootTrust.ps1` | `Cert:\CurrentUser\Root` only, after an independent fingerprint comparison; undo removes only the root it added |
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

Tests: `tests/tls/test-lan-pki-vm.sh` (VM scripts) and `tests/tls/test-lan-pki-windows.sh` (module checks
and parsing under PowerShell 7 with the Linux step build; Windows-only cmdlets need a real PC).
