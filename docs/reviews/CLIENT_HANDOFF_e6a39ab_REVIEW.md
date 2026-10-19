# Client handoff corrective review: e6a39ab

Date: 2026-10-19. Verdict: **narrow follow-up requested for R1/R2 before build/rehearsal**.

Reviewed patch `66021999bb8ca2268327ed872b1744e94df43da9` → `e6a39abbd311c08abcfdd044b8b30ed89c1956e3`, seven commits. The earlier architecture remains accepted. H1, H3, H4 and H5 are resolved to the extent checked below; the original H2 concurrency/snapshot cases pass, with one incomplete-backup boundary still requiring correction. This review does not reopen those accepted fixes.

## Identity and independent validation

- Patch SHA-256: `971e8ee5c9682e3e4cb3b224c7a199a5fade1e37f44af2083ae733e9e6a8e326`, exactly the owner's value.
- All seven mail headers match the reported sequence, and all **55 final changed-file Git blob hashes** match the full-index patch after reconstruction. See `CLIENT_HANDOFF_e6a39ab_blob_checks.json`.
- **258 standalone checks pass:** existing seven suites 175; wrapper 59; namespace-egress recorder suite 13; real artifact inventory/client-pack build 11.
- **20 TLS scenarios pass** through the actual `tlsCommand`, `tls`, `proc` and kernel-lock code, including separate processes and real temporary certificate hierarchies: import/CSR exclusion, import/recover exclusion, immutable snapshot, pair fallback/refusal, full-chain renewal/`tls restore`, byte-for-byte restore, split input and invalid-key rejection.
- All five configured ingress JSON error literals now contain the fields required by the exported schema and a substituted 32-hex `request_id`. This is a structural check, not an independent execution of the Ajv or exact-Nginx suite.
- Two additional counterexamples below reproduced. Source and results: `verify-client-handoff-e6a39ab.mjs`, `CLIENT_HANDOFF_e6a39ab_actual_code_evidence.json`.

Reviewer environment/limits: Node 24.19.0, OpenSSL 3.0.13, not the pinned Node 24.21.0/OpenSSL 3.5.5. The dependency-free TLS adapter uses Node's official TS transform, the actual dispatcher/source and a minimal three-field layout; it is not the complete built `main.js` dependency graph. Its ownership adapter selects the module's explicit non-root test branch because this sandbox cannot chown to uid 101. TLS/chain/lock/file decisions and OpenSSL results are not stubbed. The legacy initializer's source is retained but not exercised. No real Docker daemon, VM, corporate endpoint or owner PBF was accessed.

Initial artifact-test failures were missing old baseline files in this partial review checkout, not product findings. Those files were fetched at the exact baseline, then the inventory passed. The first reviewer counterexample attempt could not overwrite a read-only synthetic CA file; the test setup now changes its mode explicitly before corrupting it. Only the final successful reproduction is evidence of R1.

## Accepted dispositions from H1–H5

| Item | Disposition |
| --- | --- |
| H1 | The wrapper resolves/checks all input flags, mounts separate files, avoids service-state shadowing and passes 59 checks. Actual Docker mount behavior remains for rehearsal. |
| H2 concurrency/snapshot | TLS mutations share the lifecycle lock, activation checks occur inside it, and the validated staged key is installed despite external pending-path changes. Those original races no longer reproduce through the actual dispatcher. Recovery's backup trust completeness remains R1 below. |
| H3 | Both egress modes now accumulate failures and reject the tested command/connection/counter failures; 13 checks pass. This does not establish real namespace isolation yet. |
| H4 | The new documented `tls restore --from` works on a real saved leaf+intermediate set, including byte-identical key/chain/root restoration. The old strict `--cert` command rejecting a full-chain file is not a remaining H4 defect. |
| H5 | Configured ingress error bodies now include `request_id`, matching the required-field shape. Dynamic browser/Nginx/served-contract execution remains pending independently. |
| Packaging direction | Separate operator and developer packs and link inventory are appropriate. Clean-output construction passes; reused-output handling remains R2. |

## R1 — P2: recovery accepts a backup whose trust anchor does not verify its certificate

Location: `apps/ops/src/tls.ts`, `tlsRecover()` backup branch (around lines 383–399).

The backup candidate is accepted solely because `pairOk(server.crt, server.key)` succeeds. `ca.crt` can be unrelated, missing or corrupt and is not validated/bound to a recorded complete previous set. The copy loop skips missing files, and the journal is removed after another pair-only check.

Independent reproduction uses the **actual new `seyra.tls-replace/2` journal and backup**, produced by a real `tlsImport(..., crashAfter: 'key')`, not a hand-invented old journal:

1. Import a valid temporary leaf/key under root A.
2. Begin a valid root-B import with the existing interruption hook.
3. Remove its staged served certificate, so recovery must consider the backup (the existing tests already exercise damaged staging/fallback).
4. Replace only the backup's public trust file with unrelated root B; its old leaf/key still match.
5. Call the actual recovery function.

Observed: recovery returns **`restored`**, restores the old matching leaf/key, installs the wrong root, and deletes the journal. OpenSSL verification of that restored leaf against the restored `ca.crt` exits **2**. The result is not the original complete TLS set, nor a chain-valid proposed set.

Scope of impact: tooling/clients using this restored trust file fail verification, and recovery misleadingly reports completion. This is not evidence of immediate failure for an already-running Nginx or a client that already trusts the correct original root; its leaf/key may still serve normally.

Required correction: establish and verify the complete fallback set, including trust material and necessary metadata, before changing active files/removing the journal. Require missing or altered required files to be rejected; do not mix retained current files with an incomplete backup. Use recorded integrity and/or chain validation consistent with the documented recovery policy, with a deliberate compatibility policy for older backups/journals. Preserve the valid old-state recovery cases. If neither complete set is valid, keep the journal and files unchanged and return failure.

Regression coverage: valid fallback; wrong/missing/corrupt backup root; incomplete backup; inconsistent saved metadata where applicable; valid proposed completion; neither set valid. Show refusal is before active-file changes and journal deletion. No new issuer or live certificate operation is needed.

## R2 — P2: reusing the client-pack output retains excluded, unmanifested operator files

Location: `infra/handoff/build-client-pack.mjs`, `buildClientPack()` (around lines 44–70).

The builder checks declared source files and overlays them onto `out`, but never requires an empty output or checks the final delivered directory for extras. A previous output's excluded files survive even though the builder returns success and the manifest omits them.

Independent reproduction: create an output directory containing only a synthetic stale `docs/handoff/DEPLOYMENT_PLAN.md`, then invoke the actual builder on the current checkout. It successfully builds the client pack, leaves that explicitly excluded operator file in place, and does not list it in `PACK-MANIFEST.json`. No real private values or keys are used. Sharing/archiving the directory would include the stale operator material even though the declared-source tests passed.

Required correction: use a fresh/empty validated destination, or a staged construction/publish scheme with an exact final inventory. Refusing a non-empty destination before writes is sufficient and safer than deleting unknown files. Preserve existing output on refusal; do not clean arbitrary operator directories automatically. Ensure the manifest describes the actual delivered files and copied bytes. Test clean construction and a stale excluded/unlisted file, verifying refusal/preservation or exact safely staged output as designed.

## Next step and unexecuted checks

Correct only R1/R2 and their regressions, retaining the accepted changes. No new requirements intake, routing/geocoding work, Iran import, readiness change or PKI redesign is needed. Image builds/relock/bundle, real Docker namespace/relay tests, full unit/workspace build, exact-image Nginx, browser/Swagger, LAN/Windows/mobile/load and live Iran tests were not performed by this reviewer.

The owner's reported 226-unit/build/proxy results are distinct from the independent tests here. The full build/rehearsal milestone still depends on safe-resource arrangements; live activation/trust installation remains separately pending. Keep main and PR #1 unchanged, the original readiness incident open, and the owner's manual-push workflow. No product code, serving host or input file was changed by this review.
