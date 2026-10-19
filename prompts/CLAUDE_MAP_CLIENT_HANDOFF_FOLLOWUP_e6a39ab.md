# Seyra handoff: finish recovery and client-pack boundaries (R1/R2)

Continue in the existing VM-connected Claude Code session at `~/seyra`, branch `feat/map-services-v1`. Expected local head: `e6a39abbd311c08abcfdd044b8b30ed89c1956e3`. Check refs/working tree and preserve newer/local work. Do not reset, merge, push, change main or alter PR state.

The corrective patch SHA-256 is `971e8ee5c9682e3e4cb3b224c7a199a5fade1e37f44af2083ae733e9e6a8e326`. All 55 final changed blobs matched in review. H1/H3/H4/H5 and the original H2 lock/snapshot cases are accepted to the checked extent; the new `tls restore` is accepted as the documented full-chain rollback interface. Do not reopen or weaken those fixes.

Fetch origin and read, with `git show` from `origin/review/client-handoff-e6a39ab` (do not merge):

- `docs/reviews/CLIENT_HANDOFF_e6a39ab_REVIEW.md`;
- `docs/reviews/CLIENT_HANDOFF_e6a39ab_actual_code_evidence.json`;
- `docs/reviews/verify-client-handoff-e6a39ab.mjs`;
- `docs/reviews/CLIENT_HANDOFF_e6a39ab_regressions.json`.

The reviewer ran Node 24.19.0/OpenSSL 3.0.13 with a dependency-isolated actual TLS dispatcher/ownership adapter, not your full compiled CLI. Reproduce the two counterexamples on the pinned runtime through the real CLI/builder and add desired-behaviour regressions before applying the fixes. The verifier is an observation collector; its exit code alone is not acceptance evidence.

## R1: validate a complete recovery fallback

The actual new /2 import journal is used: a valid A-root import, an interrupted valid B-root import, damaged staged certificate, and a fallback backup whose leaf/key still match but whose `ca.crt` is replaced by unrelated root B. `tls recover` returns `restored`, removes the journal and installs a set that fails OpenSSL chain verification. Missing backup files can also be silently skipped/mixed with current files.

Before restoring any active file or removing a journal, establish that the complete fallback set is the intended/valid prior set, including trust material and required metadata. Bind and verify the backup using recorded integrity and/or appropriate certificate-chain verification, with an explicit safe compatibility policy for older backups/journals. Do not equate a matching leaf/key with a validated complete TLS set. Avoid partial copies before validation. If neither proposed nor backup set is valid, refuse and preserve the journal and current files.

Add deterministic tests for a wrong root, missing/corrupt trust, incomplete fallback, inconsistent metadata where relevant, valid fallback/completion, and neither set valid. Validate every affected active-file hash and journal state on refusal. Keep the existing lock, immutable snapshot, full-chain restore and valid legacy recovery tests passing. Use only temporary PKI and file fixtures, not the live host or its CA material.

## R2: client-pack output must match the sanitized manifest

The builder overlays a non-empty output and leaves an explicitly excluded stale `docs/handoff/DEPLOYMENT_PLAN.md` there while returning success; the file is absent from the manifest. The clean-output inventory test cannot detect that.

Require a fresh/empty valid destination before writes, or use an exact staged/published artifact. Refusing non-empty output with existing contents unchanged is sufficient; do not recursively delete unknown operator files. Ensure the final delivered inventory and manifest agree and hashes describe the copied bytes. Add tests for a clean output, a stale excluded operator file and an arbitrary unlisted file, proving refusal/preservation or your safe staged replacement policy. Keep the operator and developer packs separate and do not ship keys or operational values.

## Finish within the existing preparation boundary

This is a narrow two-fix turn. Run focused TLS/pack regressions and affected existing unit/schema/wrapper tests; retain before/after evidence and rebuild/typecheck the source in normal workspace order. The reviewer observed 258 standalone passes and 20 dispatcher TLS passes; your complete pinned-runtime suite remains authoritative for your environment. Do not claim unexecuted checks passed.

No Docker/browser/service workloads, image builds/relock/bundle, rehearsal, load, LAN publication, relay startup, serving-host restart/settings/TLS change, live Iran query or original PBF modification. Do not change readiness semantics or close the original incident. Safe resources and issuer/device trust remain pending operator decisions and do not block these two code fixes. Do not contact either client developer.

Commit logically on the existing feature branch, keep the tree clean and retain manual push. Return R1/R2 dispositions, failing-before/passing-after evidence, exact new head/commits, affected image/pack inputs and executed versus pending checks. Keep PR #1 draft and main unchanged. No new broad implementation prompt or repeated subnet/client-type questions are needed.
