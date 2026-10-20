# Seyra: private PKI preparation and authorized r9 LAN cutover

## 1. Owner decisions are resolved

The owner has no company CA and explicitly delegated the best issuer and cutover timing to us. Use the selected two-tier private PKI and timing policy in `docs/planning/MAP_LAN_PRIVATE_PKI_DECISION.md` on this reference branch. Do not ask the owner again to choose a CA, supply another preparation VM or approve a generic cutover window.

Authorized scope: prepare VM-local server key/CSR and Windows issuer/trust instructions, obtain the public signed chain, deploy the reviewed r9 API/proxy/OPS and server certificate to the preserved installation, publish the HTTPS edge on the approved VM LAN address/port with the already approved corporate CIDR, verify actual Windows access and document handoff. The owner personally executes Windows steps if you have only VM controls. Do not fabricate that execution or collect their passwords/private keys.

Begin preparation now without disrupting service. Begin active cutover only when the certificate, Windows checks, resources and rollback prerequisites below are ready. A maximum 30-minute active window excludes human signing/transfer delays. No uptime promise is inferred from fixture timings. This authorization supersedes the earlier planning gate that reserved live certificate/access/image replacement for a later decision, only within this scope.

Not authorized: deleting data/source/volumes, Iran reimport, extra Iran stack, rebuilding data images, changing the global VM firewall or corporate routing, weakening TLS/source checks, installing trust for all Windows users/the company, contacting developers or merging/pushing Git. Keep the owner's manual-push workflow, main unchanged and PR #1 draft.

## 2. Read and verify before changing anything

Source baseline: `feat/map-services-v1` at `d5700749b68929d86f1f468cc61be41f7d741a64`, now pushed and source-approved. Fetch/verify remote and working tree; retain unexpected local/newer work, never reset or merge planning/review branches. Read `CLAUDE.md`, RUNBOOK, `docs/handoff/DEPLOYMENT_PLAN.md`, the selected PKI decision and `review/client-handoff-d570074` approval via `git show`.

Use the existing owner-private handoff/maintenance records to identify the current VM LAN IP, approved CIDR, preserved outer host, its nested Docker socket, original dataset, install/home, r3 recovery bundle and r9 transfer bundle. Observe actual values again; do not assume stale addresses or infer that a Docker gateway is an approved client. Populate the new `EDGE_INNER_DOCKER_HOST` and `EDGE_INNER_HOME` against the correct installation.

r9's expected SHA256SUMS digest is `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`. Verify it out of band using trusted existing tools, strict entry types/names, complete inventory/checksums and locked image identities before executing incoming content. Retain the current installed tree, runtime/settings/TLS, original images/bundle, verified control/state backup and protected secrets recovery material. Distinguish outer and nested daemons in every command. Keep operational values, private certificates/CSRs/keys and credentials outside Git.

No builds/imports or broad regression batch are needed: image inputs are unchanged and the corrected bundle/rehearsal passed. A small disposable test for a new operator procedure is allowed with exact ownership guards and resource supervision, not alongside another full stack/browser workload.

## 3. Prepare a server CSR while the original service keeps running

The old installed r3 CLI lacks the new TLS commands. Avoid upgrading it just to request a certificate. Generate a new server EC P-256 key and CSR with the VM's host OpenSSL in a fresh, operator-owned private directory outside Git/shares, under umask 0077. Use readable-to-owner mode 0400 for the server key and a protected parent directory; no other user's access. Refuse overwrite of existing material.

Match the reviewed CSR properties: exact observed VM LAN IP as IP SAN; add only a real already configured internal DNS name if one exists; CA false, digitalSignature, serverAuth. Do not invent a DNS domain, use a wildcard or put localhost/control names in the LAN certificate merely to simplify a check. Verify file existence, private-key parse/check, CSR signature, exact SANs and key/CSR public-key agreement independently of the generation command's exit status. The known OpenSSL output-file trap must not cause a false success.

This is the server key only, not an issuer key. It remains on the VM. The existing reviewed `tls import --key` interface will accept it at cutover; no unlocked copying into active TLS state or bypass of product import validation is allowed.

Prepare an owner-private transfer directory containing only the CSR and a request manifest with exact SANs, CSR SHA-256 and public-key fingerprint. Give exact SCP instructions for those public files. Never ask the owner to copy a whole key directory or the server key to Windows. The original installation and its serving certificate remain unchanged in this phase.

## 4. Windows two-tier issuer and public trust handoff

Prepare concrete, parameterized PowerShell files/instructions for the owner. Use a current official stable Smallstep CLI Windows binary, resolve the actual architecture/version and verify its exact SHA-256 against official release metadata before preparing execution commands. Verify published signatures/attestations where available and record their presence/status accurately; do not invent a Windows signature if none is provided. Record the pin privately. Prefer portable user-local installation; no opaque download-and-execute pipeline and no installation on the serving VM. Consult the primary references in the decision, not obsolete mirrored pages or guessed flags.

Use only official standalone certificate commands; no new CA service, ACME server, accounts or online enrollment dependency. The owner runs issuer-key commands interactively on Windows, with passwords entered locally. Never put issuer passwords in CLI arguments, files delivered to the VM, chat, transcripts or environment values that you log. Do not request private key contents through Desktop/MCP/SSH. If you cannot execute Windows, prepare the complete commands and hand off this required local step, while continuing independent VM preparation. Waiting for real signed public files is legitimate; a further generic approval gate is not.

Issuer requirements:

- Separate encrypted EC P-256 Root and issuing-intermediate keys, protected by actual NTFS ACLs for the owner, not Unix-mode assumptions. Store outside repo, Desktop/OneDrive/synchronized folders and VM shared directories. Reuse an existing matching issuer only after identity/validity checks; never overwrite an unknown authority.
- Root: CA-signing usages, path length 1, 5 years. Intermediate: CA-signing usages, path length 0, 1 year. Validate actual generated extensions and dates, not only command success. Root is used only for intermediate issuance and then retained encrypted under protected archival/offline storage policy; document whether an offline backup actually exists. Do not claim an online Windows key file is air-gapped or HSM-backed.
- Leaf: sign the VM CSR using the intermediate, 90-day lifetime with bounded clock-skew allowance, CA false, digitalSignature and **serverAuth only**. Verify the CSR signature, exact expected SAN set, key algorithm and public-key fingerprint first. Use a verified server-only template if the generic profile would add clientAuth. Do not blindly copy arbitrary CSR extensions. Verify complete chain/purpose/names/lifetimes afterwards; no leaf may outlive its issuer.
- Do not use `infra/tls/dev-issuer.sh` to issue the real hierarchy: it is the older unencrypted direct-signing fixture helper. Keep that helper and historical fixtures unchanged.
- Public outputs only: separate leaf PEM, intermediate PEM and root PEM; a DER root `.cer` for Windows; public certificate fingerprints, request binding, validity and checksums. Never return root/intermediate private keys or server private keys. Bind returned leaf/manifest to the CSR and expected server identity; refuse wrong/missing/extra names, wrong root/chain or mismatched key.

Prepare trust/undo steps before importing the root. First use explicit root files for CLI/application checks. For the owner's browser choose **`Cert:\CurrentUser\Root`**, public root only, after independent SHA-256 fingerprint comparison; do not use LocalMachine, GPO or automatic developer-device installation. Root trust is not limited to one VM IP or one browser profile: state its account-wide implication plainly. Prefer a dedicated test account if already available, but do not require creating a new Windows account/machine.

Keep certificate fingerprints distinct from file digests: a certificate fingerprint is over DER. Prepare the DER root so `Get-FileHash -Algorithm SHA256` can be compared consistently. Record the exact Windows store thumbprint returned/observed, whether the root pre-existed and an undo operation that removes only this newly added root. Do not delete unrelated trust entries. If company policy blocks import, report it; do not disable certificate checking.

Produce a protected public handoff packet and let the owner return only those public files to the VM. Validate them there with the reviewed TLS checks/OpenSSL before any active cutover. Do not put real certificate metadata or operational endpoints in public Git evidence. Include renewal before the leaf's last 30 days, protected issuer backup/recovery and emergency trust/issuer rotation instructions. No CRL/OCSP/AIA fetch becomes a runtime dependency; state the manual revocation limitation.

## 5. Choose the active window from actual conditions

While the owner handles Windows, finish the private cutover/rollback command sheet and trusted r9 staging. Do not begin an outage or mutate the active installation while waiting for signatures or manual trust steps.

Start the active phase at the first low-load opportunity after all these hold:

- valid bound leaf/intermediate/root and VM-local server key available, Windows owner can run the checks, and its actual source/route to the VM is identified;
- current service ready on the recorded dataset with all providers; no unfinished TLS/release journal, import or conflicting lifecycle command;
- verified recovery material and exact old images/lock still available;
- enough measured disk budget plus margin, at least 2 GiB available RAM and stable swap, with a bounded independent supervisor; no build/import/second stack;
- expected LAN port free and no contradictory route/network ownership; exact private configs verified.

Write a private `CUTOVER-IN-PROGRESS` marker with before-state, deadline, exact rollback commands and durable recovery instructions. Reserve up to 30 minutes of active work/verification; record actual outage separately. The deadline may be shortened for degraded readiness/resources. If the gates are not met, keep the existing service running and report the concrete blocker rather than asking the owner to choose the same issuer/window again.

During the active phase keep resource sampling bounded at 5 seconds; abort the current new work for available memory below 1.5 GiB, swap growth over 512 MiB from baseline or insufficient remaining disk budget. Mark each intentional API/proxy restart explicitly, allow at most 120 seconds for its readiness gate and keep resource supervision running during that grace. An expected restart is not the original readiness incident. Failure to regain verified readiness within its grace triggers rollback, not an indefinite wait.

## 6. Execute the rehearsed r9 change

Follow the current deployment plan with these resolved inputs:

1. Fresh coherent control/state backup; verified protected secrets/TLS recovery copy; before-state of both daemons, dataset/provider/container/image identities, network/volume identities, install/settings/runtime hashes, TLS public fingerprints and isolation. Record original PBF identity read-only; never reimport or rewrite it.
2. Strictly verify r9 with trusted already-installed tools, stage/verify the install copy and retain the original install/runtime and r3 recovery bundle. Install/load verified r9 and verify images; all seven data entries must match. Keep the r9 TLS tools available until any rollback of certificates completes.
3. Use `start` through the new installed CLI for the software cutover. Wait for real readiness and expected dataset/provider identities. Verify only the intended API/proxy recreation; preserve data containers/stores. Do not stop the outer nested host.
4. Import the already-issued certificate with the reviewed locked `tls import --cert <leaf> --chain <intermediate> --ca <root> --key <VM-private-server-key> --names <exact-LAN-SANs>`, then `proxy restart`. Record the validated previous-set path for `tls restore`. Verify served leaf/chain/fingerprint/purpose/name and root trust without disabling TLS checks. Control checks use the existing ordinary HTTP Host with the proper new TLS identity as rehearsed.
5. Validate and start the edge using the exact locked image, owner label, configured VM LAN address/port and **only the already approved corporate CIDR**. Its namespace guard must apply. Observe its actual lab IP and configure the exact peer in the inner relay, bound only to the nested lab address, then `access apply` and `proxy restart`. Verify `EDGE_INNER_DOCKER_HOST`/`EDGE_INNER_HOME` refer to this exact serving installation for safe stop. Do not broaden to Docker gateways or trust HTTP forwarding headers.
6. Verify host control, expected ports, all four provider identities and real namespace egress (including private controlled destinations and positive controls) with the existing corrected tests. No probes to unrelated company machines, no global firewall changes. Remove only the controlled sinks this operation created.

No provider/database/admin port is made public. Same-origin paths remain web `/`, Swagger `/api/docs/`, spec `/api/docs/json` and assets `/maps/`.

## 7. Windows and actual source-boundary checks

Run real Windows checks with hostname/certificate verification enabled, never `-k`, ignored certificate errors, forced insecure revocation flags or browser warning bypass. Use the verified public root explicitly for CLI tests and the selected CurrentUser trust for the browser. Confirm chain/name/fingerprint, readiness/dataset, Swagger and hosted map assets/labels without external requests or CSP errors. Use a small high-zoom map view, a few representative searches and one simple route; no load/benchmark or broad POI query.

Prove the inner proxy sees the actual Windows source: temporarily narrow its allowed client set to a different /32 **inside the approved CIDR**, expect 403 for a fresh Windows request; then its actual /32 must work, followed by restoration of the approved CIDR. Keep exact peer trust unchanged. If the observed Windows source is outside the approved range, do not widen policy or grant a gateway; report it and retain/recover the bounded prior state.

Use a real outside-subnet client for an edge refusal if available. **Do not require another physical machine as a hard prerequisite.** If unavailable, record that physical case as NOT RUN and test actual edge refusal/restoration from the owner device through a temporary stricter allowlist, keeping the same edge container/address:

- Rehearse a small isolated instance of the procedure before using it on the live edge; no second Seyra stack. Prepare validated staged config, a byte-for-byte original config and guaranteed restore handling. New temporary grants must be subsets of the approved CIDR, e.g. the VM's own /32 excluding the Windows device.
- Validate with the exact nginx image, overwrite the existing bind-mounted config inode safely, revalidate and perform a graceful nginx reload. Do not replace a file-bound inode via rename, stop/recreate/disconnect the edge or release its lab address. Assert edge container ID/IP and guard namespace remain unchanged.
- Use a fresh Windows curl process/connection for each check. Require positive TLS success first, then an actual edge access-denied record for that Windows source with no HTTP response under the restricted policy, then successful validated TLS/HTTP after restoring and reloading the original config. A generic TLS error or absent request alone is not proof of a denial.
- Restore the exact approved policy in a finally/recovery path. If this reload cannot be safely validated, do not improvise a recreation or claim the edge negative passed; retain the rehearsed boundary evidence and report the missing physical test accurately.

Do not fake source IPs, assign corporate interface aliases or scan devices. Real H-01 results and the unavailable outside-subnet physical check must remain distinguishable. The two client developers' SDKs are untested until actually run.

## 8. Developer onboarding is an explicit handoff requirement

The owner specifically asks whether both developers can use the services and whether CA installation is needed. Explain the distinction accurately: a private CA is a supported approach with initial trust configuration, not a guarantee that an unknown framework or map SDK has already passed. Trust installed on the owner's Windows account does not propagate to developers, phones, simulators or containers. Do not declare either developer onboarded without their actual client results.

Prepare one private client packet containing the actual HTTPS base URL, public root in PEM/DER, independently verifiable root SHA-256 fingerprint, public validity/renewal information, Swagger/spec links, the existing client pack and short trust installation/removal instructions. Include only public certificates; no issuer/server private keys, issuer CLI, operator recovery material or automatic installer. Public intermediates may accompany troubleshooting material, but the server must serve the intermediate chain correctly. Neither developer needs to operate a CA or sign certificates. The owner distributes the packet; do not contact them or install anything on their devices.

- Web browser: provide per-user trust instructions for the actual OS/browser, including company-policy limitations and exact removal. Test the hosted client and Swagger on the owner's real browser with normal certificate verification. Do not assume all browsers use the same trust store.
- Local web development: include the reviewed loopback dev-proxy quickstart with an explicit CA file for its HTTPS upstream. Browser trust alone is not evidence of Node/runtime trust. Keep the same-origin API and map-resource path; test style, TileJSON, tiles, sprites and fonts, not just one JSON endpoint. Treat origin/CORS failures separately from TLS failures; do not add wildcard origins to bypass integration work.
- Android: document trusting the specific public root in the development app's network configuration, preferably development-only resources/configuration where appropriate. Installing a user CA on the device alone is not sufficient for many modern app targets. Check the actual networking library and map SDK; framework-specific network stacks may need their own trust configuration.
- iOS: document the manual public-root profile and explicit SSL full-trust steps for a test device if that route is selected, including removal. Alternatively document a correctly validated app-specific trust approach only when supported by the actual stack. Never replace normal chain/name validation with unconditional acceptance.
- Both mobile platforms: a phone/simulator must reach the VM with an actual allowed source address; emulator routing, platform permissions and CA trust are separate checks. Use current official platform and SDK documentation when preparing exact snippets. If the framework, OS versions or devices are unknown, give clearly labelled platform guidance and a short checklist for the developer; do not invent a tested Flutter/React Native/native configuration or block VM preparation waiting for it.

Never use disabled TLS verification, permissive certificate callbacks or browser warning bypass as onboarding instructions. Trust the root rather than pinning the short-lived server leaf by default, and explain that leaf renewal normally needs no trust reinstall while the root is unchanged. Keep any development-specific trust out of an unrelated public production release.

The handoff checklist must distinguish: (a) VM service/TLS boundary verified; (b) owner's Windows browser and CLI verified; (c) local web dev-proxy end-to-end status; (d) each mobile SDK/device status. For a real client check, cover verified TLS, readiness/capabilities, one search and actual map resources/rendering with the expected dataset. Mark unavailable developer/SDK checks NOT RUN with the exact remaining step. Their absence does not prevent a safe VM cutover after its own gates pass, but it prevents a claim that web/mobile integration is complete. No additional generic approval question is needed.

Primary platform references: https://developer.android.com/privacy-and-security/security-config and https://support.apple.com/en-us/102390. Verify the documentation for the actual pinned Node runtime and selected SDK before supplying runtime-specific commands.

## 9. Rollback and completion

On a failed safety boundary, persistent readiness/resource issue or active-window expiry without verified completion, prioritize the rehearsed rollback: remove inner relay trust, apply and restart/verify the proxy **before** stopping/removing the edge. Use r9's positive-evidence stop; do not turn emergency force into a workaround. If trust removal cannot be verified, preserve the edge's address and close access without releasing that reservation while diagnosing.

Restore the prior certificate via r9 `tls restore` and restart/verify the proxy before restoring the old install/images; the old r3 tools cannot perform that certificate restore. Then restore the verified original install/image refs and `start`; verify original readiness, dataset/provider identities, access/TLS and isolation. Keep volume/data identities intact. Provide the owner's exact Windows trust undo only for the root newly added here. No reset, data rebuild or arbitrary certificate rotation to hide a failure.

On success, verify final policy restored to the approved CIDR, TLS state consistent, all providers ready and namespace boundaries intact; only then clear the marker. Record actual timing/container recreations and public checks privately. A script/exec failure or missing manual check is never PASS. Keep the original readiness observation and Overpass shutdown finding separate.

Prepare the owner's private developer handoff: actual base URL, public CA files/fingerprint/expiry, tested web/Swagger/spec URLs, verified dataset/API version, same-origin/dev-proxy quickstart, mobile trust guidance clearly marked by validation status and the existing client pack. No issuer tooling, key, secrets or operator recovery paths in that client packet, and no automatic messages to either developer.

Commit generic operator tooling/docs and sanitized evidence logically on the feature branch; do not edit executed frozen scripts or historical results. Preserve the current image/data pins, rebuild only if actual image inputs changed, and keep pushing manual. Return final state (live verified or rolled back), local head, safe public artifacts, actual tests/limits, renewal/trust undo and remaining mobile/load/quality items.
