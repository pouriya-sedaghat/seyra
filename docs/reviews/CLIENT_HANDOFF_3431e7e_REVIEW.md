# Client handoff final source review: 3431e7e

Date: 2026-10-19. Verdict: **APPROVED for normal feature-branch push and the next build/disposable-rehearsal stage, subject to agreed safe execution resources.** No further corrective implementation prompt is requested by this review. This is not approval to merge or to change the live serving host/device trust.

## Reviewed content

- Final incremental patch: `e6a39abbd311c08abcfdd044b8b30ed89c1956e3` → `3431e7e7330acb0e1184fd4d9c3204ab7f480ee7`, three mail commits.
- SHA-256: `32085226b1c0dfe703a82383941fd8730b6bef19857287b552c98b3364443729`, matching the owner's value.
- All **12 final changed-file blob hashes** in this incremental patch match the reconstructed checkout.
- Across all three handoff patches, the **17 mail commits and all 108 final changed-file blob hashes** match the reviewed content from the published `d63f1d9` baseline to this head. See the incremental and full-handoff blob-check JSON files. These are content/mail checks, not independently fetched signatures or unpublished Git commit objects.

## R1: complete TLS recovery fallback — resolved

The new journal version records the complete served backup set (certificate chain, key, public trust file and metadata presence/hashes). Recovery snapshots that set into private staging and validates completeness/integrity, leaf/key agreement, trust/chain/server purpose/names and metadata before modifying active files. Legacy journals without backup integrity records receive explicit complete-set validation. Refusal retains the active files and journal.

Independent before/after execution uses the same new regression against both revisions:

| Source | Checks | Failures | Result |
| --- | ---: | ---: | --- |
| `e6a39ab` | 24 | 15 | Reproduces the deficient fallback |
| `3431e7e` | 24 | 0 | PASS |

Covered: valid proposed completion, intact full-chain fallback, exact restoration of certificate/key/root/metadata, wrong/missing/corrupt trust file, incomplete backup, altered metadata and older-journal compatibility. The negative cases assert active-file hashes and journal bytes remain unchanged.

The recovery policy deliberately uses `-no_check_time` for a previously active fallback; it restores that prior set without claiming a renewed/unexpired certificate. New certificate imports keep their existing validity checks. Operators still inspect/renew certificates before a new LAN handoff.

## R2: fresh, exact client-pack output — resolved

The builder refuses reused/non-directory/symlink destinations before writes, preserves existing contents, hashes delivered bytes, and checks exact delivered inventory before writing its manifest. Clean-source/revision attribution is explicit. No recursive cleanup of arbitrary operator output is introduced.

| Source | Checks | Failures | Result |
| --- | ---: | ---: | --- |
| `e6a39ab` | 19 | 4 | Reproduces reused-output contamination |
| `3431e7e` | 19 | 0 | PASS |

Covered: ordinary pack/link/key/artifact inventory; stale excluded operator file and unrelated file refused with complete contents unchanged; fresh directory output; actual manifest/hash agreement; file-valued output refusal.

## Retained TLS behavior and verification limits

The previous **20 H2/H4 TLS scenarios also pass** on the final source: concurrent CSR/import and recover/import exclusion, immutable staged inputs, fallback/refusal, full-chain renewal, `tls restore`, exact chain/key/root restoration, split inputs and rejection of an invalid backup key. Total independent current-source checks in this final round: **63 PASS** (24 + 19 + 20).

Reviewer runtime: Node 24.19.0, OpenSSL 3.0.13 and real kernel `flock`, temporary PKI and real source functions. The TLS tests run through the actual `tlsCommand` dispatcher with a dependency-isolated minimal layout/entry adapter; they are not the full built `main.js` dependency graph. The ownership adapter selects the source's explicit unprivileged-test branch because this sandbox cannot chown to uid 101. No TLS result, file replacement, chain verification or lock decision is mocked. The source transformer is Node's built-in TypeScript transformer. See `verify-client-handoff-3431e7e.mjs` and `CLIENT_HANDOFF_3431e7e_regressions.json`.

The owner's pinned-runtime build/typecheck/226-unit/424-standalone claims are recorded in the patch's evidence; they were not all independently repeated here. Prior review coverage of the unchanged wrapper, API/proxy and other standalone suites remains in the earlier review records.

Not run by this reviewer: full workspace build/unit suite, image build/relock/export, exact-image Nginx/browser/Swagger, Docker integration/lifecycle/offline/restore/egress, real LAN/Windows/mobile/load, or live Iran queries. No connection to the owner's VM, serving host, private keys or original PBF was made. No product code was changed.

## Approved next work and remaining gates

1. A normal fast-forward push of `feat/map-services-v1` through `3431e7e` is acceptable. Keep PR #1 draft and main unchanged. If Git reports divergence, inspect it; no force push or automatic merge.
2. Freeze a named source revision for preparation. Rebuild/relock **API, proxy and OPS only**; assert data image/input identities unchanged. Generate actual bundle identities and the separate exact client pack. No Iran reimport for this handoff.
3. Execute affected suites and a labelled disposable fixture/relay/certificate cutover+rollback rehearsal on agreed safe resources, with controlled clients/destinations. Measure outage, source-address handling and egress rather than inferring them from this source review.
4. On the shared VM, an owner-approved monitored window remains necessary; previous co-located workloads degraded the service. A separate preparation machine is preferred. The prepared prompt does not itself authorize a shared-VM workload.
5. Live serving-host cutover, actual company/device trust, Windows/LAN/mobile checks and load remain pending. Rehearsal uses temporary certificates; the production issuer choice need not block image/fixture work. Keep the original readiness incident open.

The next-stage English prompt is `prompts/CLAUDE_MAP_CLIENT_HANDOFF_BUILD_REHEARSE_3431e7e.md`. Supply its private execution-location authorization before running workload-dependent steps. Existing corpus data, serving configuration and private operational values stay outside this review branch.
