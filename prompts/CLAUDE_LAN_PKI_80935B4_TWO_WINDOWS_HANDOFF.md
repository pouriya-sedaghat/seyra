# Release the UTC-corrected tooling and inventory the retained issuer PC

**Respond in English throughout, including progress updates and the final handoff.** Continue in the existing VM-connected Claude Code session. Read `docs/reviews/LAN_PKI_80935B4_REVIEW.md` from this same pinned reference commit in full. Do not merge or cherry-pick the reference branch.

## Source acceptance and execution boundary

The implementation at `80935b42a9b5616c21df7483412c5fb2ccbc6df8` is accepted for a controlled Windows handoff. No additional implementation round, image rebuild or operational bundle export is requested. Check the actual head/tree first. If the owner has pushed these commits, that is expected. Do not push on the owner's behalf, force, merge, change `main`, or alter PR #1.

This turn is private packet preparation and read-only readiness preparation. Keep the preserved service, its TLS/settings, the VM server key/CSR and all data unchanged. No stack or outer-host restart, edge/LAN publication, trust enrollment, data import or load test. Do not enable automatic restart or change firewall rules as part of this handoff.

## Critical state correction: two different Windows PCs

The previous Windows transcripts came from **client B, the separate company PC**, not from **issuer candidate A, the Windows PC hosting the VM**. The owner had created independent PKIs on both PCs. The owner subsequently deleted `%LOCALAPPDATA%\SeyraPKI` only on B.

Consequences:

- The old company-PC issuance attempt and the private recovery procedure for it are obsolete. Do not give the owner those recovery/export commands again or assume those files still exist.
- The old company-PC root fingerprint is not A's selected issuer fingerprint. Do not reuse it as A's independent trust value.
- A's PKI folder is retained. Preserve it and inventory it before deciding what to reuse or create. No blanket cleanup or CA regeneration.
- The successful owner-run Windows acceptance (14/14 and 17/17), tool installation, CA creation and timezone diagnosis are evidence from B. Keep them attributed to B. The corrected UTC scripts have not run on real Windows yet.
- B should eventually be a client of one selected issuer hierarchy on A. It needs public CA material and a local trust record; it does not need another issuer hierarchy or any issuer private key.
- Offline backup status is still unknown. Do not report it as complete.

Record this correction in the private operator status. Keep historical test evidence and sealed packets intact. Add an external supersession note for the old draft recovery guidance; do not alter sealed contents merely to remove its stale path.

## 1. Prepare a fresh handoff from reviewed source bytes

Use a fresh private, versioned delivery folder rather than overwriting the sealed v3 packet or releasing the obsolete v3.1 README. Include the consistent reviewed Windows script/module/template set, the original public VM CSR/request manifest, clear current instructions, a version record and checksums. Reuse the pinned installed Step where present; unchanged public tool archives may be included if needed for a complete delivery. No issuer/server private keys, secrets, active trust records or unrelated backups.

Compare every delivered source file byte for byte with the reviewed commit. `f59318e..80935b4` should contain only evidence/status changes; verify that rather than assuming it. Check the inventory, hashes and actual absence of private key material. Hash the final checksum list and provide its value from the VM session. Do not silently edit a module in the sealed packet.

Corrected tooling can now be released without asking for another review of the same source. No new product commit is needed merely for packet release. Keep operational paths, endpoint values, fingerprints and machine identifiers in private instructions, not public Git.

## 2. First owner-run step: inventory A, without changing its PKI

Provide exact copyable transfer/hash commands and clearly identify the destination as **the Windows PC hosting the VM**. Resolve paths with that PC's own environment. Do not reuse the company PC's username or issuance-folder name.

Then provide a small, read-only PowerShell 5.1 inventory sequence using the corrected delivered module. It should report:

1. PowerShell version and local timezone/offset; whether `%LOCALAPPDATA%\SeyraPKI` exists.
2. Existing private-folder validation and file presence. Use the read-only module checks; do not call a folder-creation command or repair ACLs during inventory.
3. Whether the pinned Step and the four root/issuing certificate/key files are present. Inspect public certificates and test encrypted-key headers only; never print or upload key bytes or passwords. Do not call `New-RootCa` / `New-IssuingCa` merely to inspect: their check-existing options can still create files when the expected files are missing.
4. If files and tool exist, the existing root and issuing public properties, SHA-256 fingerprints, UTC validity and actual issuer chain. This is public certificate inspection, not proof of private-key recoverability unless the relevant operation was actually exercised.
5. Existing issuance attempt directories and which expected public files they hold. No deletion, age-based selection or signing. Existing public-packet destinations should also be listed.
6. Project-related root-store entries for the current account, read-only. Do not enumerate unrelated company trust material unnecessarily or remove any root. Matching by subject is an inventory filter, never a deletion criterion; any later removal must be bound to exact fingerprints and actual ownership evidence.
7. The owner's actual offline-backup status, explicitly reported as present or absent rather than inferred.

If a file or tool is missing, report that and stop the corresponding validation; do not install or generate it implicitly. The first handoff should end by asking the owner for actual inventory output. This is required environmental input, not another permission request.

## 3. Prepare the continuation, dependent on that inventory

After actual A inventory arrives, select one verified existing issuer hierarchy there, if available. Preserve its encrypted keys. If an existing leaf on A matches the original VM request and selected hierarchy, it may be validated using the reviewed explicit check mode. If no suitable leaf exists, prepare one signing operation against the unchanged VM CSR using the selected issuer. Do not assume that the deleted company-PC leaf can be recovered or that A's state matches B's old logs.

Only after successful current-time, signature-chain, exact-SAN, usage and request-binding validation should a new public packet be exported from an explicitly selected attempt. Never overwrite an existing packet or choose a directory solely by age. Provide the eventual return command with the actual public folder, independently recorded selected-root fingerprint and source-PC address. Do not request a private key or a template reply with unfilled values.

For B, prepare a later public-only client trust handoff. Do not send issuer-creation instructions there. A read-only project-root inventory on B may be needed because deleting AppData does not remove store trust. Do not undertake blanket cleanup. No CA enrollment on either PC is part of this first inventory step.

When a public packet returns, run the reviewed fail-closed checker with the staged r9 OPS identity and compare its root with the owner's independently recorded selected value. No live replacement while these inputs remain pending.

## Deliverable, in English

Return the exact released packet version/path and checksum-list digest, transfer/hash commands, and the first read-only Windows inventory commands. Explain clearly which PC executes them and what output is needed next. Confirm that the obsolete recovery instruction was withdrawn, the current service and VM request were unchanged, and no signing/trust/cleanup was performed. Preserve a separate public-client plan for B. Do not ask the owner to recreate or delete the retained PKI before its inventory is known.
