# Release the reviewed LAN PKI packet and begin Windows acceptance

Continue in the existing VM-connected Claude Code session. Read this entire prompt and `docs/reviews/LAN_PKI_352BD9A_REVIEW.md` from the same pinned reference commit. Do not merge or cherry-pick the review branch.

## Authorization and current state

The source follow-up at `352bd9ae95dcb3fe2c68d0722dac520de5aa1260` is accepted. The prior F1/F2/N1/N2 findings are closed for source review. Do not repeat a corrective implementation round unless an actual new defect appears. The next useful evidence is execution on the owner's real Windows PC.

The owner has already selected use of this VM and delegated the certificate approach. Continue the established two-tier, encrypted, off-VM Smallstep issuer workflow. No company CA is available. The private v3 packet is staged but has not been released. The VM's existing server key, CSR and request manifest must be preserved. No issuer keys or trust have been created on Windows, and no public return packet has arrived.

This turn is for packet release and precise operator instructions. Keep the current service running unchanged. Do not build images, export another operational bundle, reimport Iran, change the live certificates/settings, restart services or the outer host, start an edge, publish LAN access, change firewall rules or perform load testing. The verified r9 bundle remains the proposed cutover bundle.

## 1. Verify only what the handoff needs

- Check the working tree and HEAD. Expect the reviewed head above. If the owner has pushed it, that is fine. Do not push on the owner's behalf, force, merge, change `main` or change PR state.
- Read the previous private operator records and current packet instructions, but verify live readiness read-only rather than assuming the earlier report is current.
- Revalidate the existing VM request with the reviewed `new-server-csr.sh --check`. Do not regenerate, rotate or copy its server private key into a delivery folder.
- Verify the v3 delivered module, scripts, leaf template and acceptance driver against their reviewed source bytes. It was assembled from `bc5267b`; explain that later `352bd9a` changes only evidence/status if the comparison confirms it. No silent script edits in the delivery folder.
- Check the packet inventory and every hash. Preserve withdrawn v1/v2 material as superseded. Publish a fresh versioned delivery copy if the existing v3 draft cannot be released without modifying its sealed contents.
- The delivery may contain only the intended Windows tooling, public CSR/request manifest, templates, public pinned tool archives/checksums and operator instructions. Scan actual key headers and file contents; do not mistake a detector's literal text for key material. No VM private key, CA private key, secrets, live trust record or unrelated operator backup.

The reviewer's source acceptance is sufficient to release this corrected packet. Do not ask the owner to approve the same source again.

## 2. Give the owner exact Windows instructions

Use the real values only in the private operator instructions and the chat handoff, never public Git. Provide an exact SCP command from the owner's Git Bash, an exact destination folder and hash-verification instructions. Do not leave `<time>`, fingerprint, path or packet-version placeholders for the owner to guess. Values that can only come from a future action must be explicitly identified as future outputs.

Use the existing tested private instructions as the basis. Keep the commands copyable and short. Include the exact acceptance-driver location and `-ScriptDir` value for the delivered folder layout.

Execution order on the owner's PC:

1. Verify the downloaded delivery hashes against the value obtained from the VM/session, then open **Windows PowerShell 5.1 as the normal user**, without elevation. Record its version. Keep CA material under the validated local private folder; do not use Desktop, OneDrive, a share or a junction as the PKI base.
2. Run `Test-LanPkiOnWindows.ps1` **without** `-IncludeTrustStore` or `-TestModel`. This exercises W1–W7 without adding trust or creating production issuer keys. Ask for its complete summary, exit code and any FAIL/UNEXPECTED ERROR/CLEANUP output. If it fails, stop the sequence and retain the exact diagnostics; do not repair broad ACLs, bypass checks or claim Windows acceptance.
3. Only after a clean folder-only run, run the same driver with `-IncludeTrustStore`. Explain its actual prompts: decline W8's disposable-root import, accept W9's import and accept W10's removal. It uses a one-day throwaway root, not the Seyra issuer. The run must finish with no failed check and cleanup `ok`. If removal was declined or cleanup is incomplete, follow its exact retained `RECOVERY.txt`; never delete the record or certificate first or retry a declined removal automatically.
4. After successful Windows acceptance, the already authorized manual issuer steps may proceed using the corrected scripts: verify the pinned tool and its actual Authenticode result; create the encrypted root and issuing CA; record the root fingerprint independently; make the offline recovery copy; sign the existing VM CSR; export only the public return packet. Keep the issuer private keys on Windows and the leaf key on the VM. Do not auto-trust a root on any developer's device or contact either developer.
5. Provide the exact public-packet return command. Ask the owner for the actual return folder, independently recorded root SHA-256, Authenticode status, offline-root-copy confirmation and source address. Do not treat a reply containing template placeholders or an empty `from-windows` folder as completed work.

Do not require another source review merely because these native Windows paths are being exercised for the first time. A genuine failed check needs its own diagnosis. The Linux model results remain model results throughout.

## 3. While waiting for the owner

Finish all independently useful read-only preparation, then wait for the real Windows results and files. Never simulate them or substitute the Linux boundary. No service outage while a human signing step is pending.

When a public packet actually arrives, use the reviewed fail-closed checker with the staged r9 OPS image and its verified identity. Compare its root fingerprint with the owner's independently recorded value; validate the chain, exact SAN, purposes, lifetimes and binding to the preserved key/CSR. Perform this without replacing live files. Report the results before moving into live execution.

Keep the startup-persistence item visible. The earlier VM reboot required recovery of both the outer host and namespace instrumentation. Do not simply enable automatic restart without accounting for that isolation state. This handoff does not authorize a new startup implementation; prepare its concrete requirement for the later cutover readiness check.

## Deliverable

Return a concise Persian handoff with the released packet's exact version/path and digest, the transfer command, Windows test commands in their actual layout, the success/failure criteria and the actual outputs needed back. State clearly that no real Windows result or web/mobile SDK compatibility is claimed yet, and that the current service remains unchanged. Keep real operational values outside public Git. No new product commit is expected merely to release an already reviewed private packet.
