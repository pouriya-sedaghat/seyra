# Seyra LAN certificate and cutover decision

Implementation baseline: `d5700749b68929d86f1f468cc61be41f7d741a64`, pushed on `feat/map-services-v1` and source-approved in `review/client-handoff-d570074`. Operational bundle: r9, SHA256SUMS digest `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`.

The owner has no company CA and has delegated the issuer and timing choice. This decision resolves those two pending choices. There is one serving VM and an operator Windows PC; another VM is not required.

## Selected PKI

Use the open-source **Smallstep CLI** on Windows for a private two-tier PKI and manual certificate issuance. It does not require running a CA service on the map VM or relying on an online enrollment service.

| Object | Policy | Location |
| --- | --- | --- |
| Root CA | EC P-256; CA signing usage; path length 1; 5-year validity | Encrypted key on the operator Windows PC, used only for intermediate issuance; protected archival/offline backup as available |
| Issuing intermediate | EC P-256; CA signing usage; path length 0; 1-year validity | Separate encrypted Windows key; manual server-CSR signing |
| Server leaf | EC P-256; CA false; digitalSignature and serverAuth only; 90-day validity; SAN exactly the verified VM LAN IP and any already established internal DNS name | Key generated and retained on the VM; only the CSR leaves it |
| Trust anchor | Public root certificate and independently checked SHA-256 fingerprint | Explicit application trust; owner browser uses CurrentUser Root only |

Use password-protected issuer keys and Windows NTFS ACLs outside Git, synchronized desktop folders and VM shares. Passwords are typed locally, never put in prompts, command-line arguments, transcripts or delivered files. Root signing is a separate operation from day-to-day leaf signing. Keep and verify protected recovery material; record what offline storage actually exists. An encrypted file on an online Windows PC is not an air-gapped CA or an HSM, and must not be described as one.

The root is not cryptographically restricted to the VM address. CurrentUser trust affects applications using that account's certificate store; it is not trust limited to one browser profile or one IP. Import only the verified public root, retain its exact store thumbprint and provide removal steps. Do not use LocalMachine trust or install anything on developers' devices automatically. Web development and native mobile clients can use explicit CA files/configuration through their owners.

Do not use the existing direct-signing development issuer to mint the live hierarchy: that helper creates an unencrypted, single-tier development root. Keep it for the already recorded fixtures. The new hierarchy fits the existing validated `tls import --cert --chain --ca --key --names` interface; no runtime/provider redesign or image rebuild is needed.

The legacy on-VM fixture CA key and its protected recovery copies remain part of the retained r3 rollback state during this operation. They are not the new issuing authority and must not be distributed or trusted on Windows. Their later retirement is distinct from introducing the new off-host hierarchy; do not claim that all historical CA keys have already been removed from the VM.

Root/intermediate expiry, renewal of the leaf before its last 30 days, encrypted key backup/recovery and emergency trust removal/rotation must be recorded privately. No OCSP/CRL/AIA download is made an operational dependency; record the manual revocation/rotation limitation rather than claiming online revocation exists.

## Timing and service boundary

Start preparation now while the original service continues to run. Create the server key/CSR in a new operator-private VM directory with host OpenSSL; this avoids upgrading the old installation merely to request a certificate. The reviewed import accepts this VM-local key explicitly. The server key never reaches Windows.

Claude connected only to the VM prepares exact Windows commands/files and public transfer instructions. The owner runs the Windows key/signing/trust steps locally. Wait for the actual signed public files and check results; that handoff is required work, not a repeat approval question.

Only after certificate validation and Windows readiness, start the authorized active cutover. Choose the first healthy low-load opportunity in the same session. Reserve up to 30 minutes for the active cutover/verification, excluding human signing delays. Measure actual downtime; synthetic timings are not a guarantee for Iran data. If safe completion cannot be verified within the window, close LAN access safely and roll back to the verified original installation.

Use the rehearsed r9 install/software/TLS/edge sequence, observe the exact source-address allowlist and preserve data/provider identities. Do not reimport Iran, rebuild data images, stop the outer nested-Docker host or alter the VM's global firewall.

The already approved corporate CIDR comes from private operator records/session inputs. Public documents use placeholders. If an outside-subnet physical test device is unavailable, do not require another machine or change corporate interfaces. A tightly bounded same-edge allowlist reload may verify actual owner-device refusal and restoration without releasing the relay address, after a disposable light rehearsal. Record an external-subnet physical check as NOT RUN when unavailable. Do not claim it was executed.

## Primary references checked for this decision

- [Smallstep key separation and production considerations](https://smallstep.com/docs/step-ca/certificate-authority-server-production/)
- [Standalone certificate/key/CSR creation and encryption](https://smallstep.com/docs/step-cli/reference/certificate/create/)
- [Signing an existing server CSR](https://smallstep.com/docs/step-cli/reference/certificate/sign/)
- [Windows CLI installation and release verification](https://smallstep.com/docs/step-cli/installation/)
- [Microsoft CurrentUser certificate import](https://learn.microsoft.com/en-us/powershell/module/pki/import-certificate?view=windowsserver2025-ps)
- [Microsoft Edge locally installed roots](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-cert-verification)

This is an engineering choice for the current constrained LAN pilot, not certification of a production PKI or evidence that Windows or the live cutover has already passed.
