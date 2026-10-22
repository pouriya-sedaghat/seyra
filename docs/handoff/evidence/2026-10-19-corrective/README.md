# Client handoff corrections H1–H5 (review of 6602199): evidence

Implements `prompts/CLAUDE_MAP_CLIENT_HANDOFF_CORRECTIVE_6602199.md` (commit `ffd7608`). The review is `docs/reviews/CLIENT_HANDOFF_6602199_REVIEW.md`, read with `git show`. Neither the review branch `origin/review/client-handoff-6602199` nor the planning branch was merged. Base `6602199`.

Runtime: Node **24.21.0** (pinned), OpenSSL 3.5.5, uid 1000. The reviewer used 24.19.0/3.0.13 with a `getuid` adapter; here the module's unprivileged path applies naturally.

**Boundary:**
- **Docker:** no workload, image build, bundle, rehearsal, LAN publication, relay or restart.
- **Live state untouched:** no live TLS or settings change, and nothing touched the original PBF, the serving host or its legacy CA copies.
- **Read-only checks:** Docker was used only for read-only identity checks of the serving host, recorded privately: unchanged container, start time, restarts, inner containers, egress counter 0 and PBF hash.

## Reproduction (pre-fix)

The reviewer's verifier was run unchanged on a disposable copy of `6602199`: **exit 0, all five defects reproduced** ([`reviewer-verifier-at-6602199.json`](reviewer-verifier-at-6602199.json)).

Against the corrected tree ([`reviewer-verifier-after-corrections.json`](reviewer-verifier-after-corrections.json)):
- H1, H2, H3 and H5 no longer reproduce.
- Its H4 step still runs the *old* rollback command (`tls import --cert previous/server.crt`, a leaf + intermediate file). `--cert` deliberately still takes exactly one leaf. The corrected rollback is `tls restore --from <backup>`, and backups now also carry split `leaf.crt`/`chain.pem`.

As the review says, the verifier is evidence of the old defects, not the acceptance suite. The desired-behaviour regressions below are.

## Dispositions and regressions (each run against `6602199` and against the corrected tree)

| Finding | Correction | Regression | Before → after |
| --- | --- | --- | --- |
| **H1** wrapper mounts | `bin/seyra-maps` checks each input argument (`--pbf`, `--cert`, `--key`, `--ca`, `--chain`) before Docker: present, existing, readable, regular file. It resolves relative paths and mounts each file read-only at its own path (CSV-quoted `--mount`, so spaces, commas and colons are safe). Inputs inside `SEYRA_HOME` get no shadowing mount, and duplicates are mounted once. | `tests/wrapper/test-wrapper-inputs.mjs`: the actual wrapper with a Docker argv recorder; separate and same directories, relative paths with spaces, service-local inputs, comma/colon paths, the same file twice, PBF, missing file/dir/argument | **13 FAIL → 59/59** ([before](regressions/h1-before.txt), [after](regressions/h1-after.txt)) |
| **H2** TLS serialization, staged validation, recovery | `tls-cli.ts`: every TLS mutation (`csr`, `import`, `restore`, `recover`, test-only `init`) runs under the lifecycle lock, with preconditions checked after acquiring it. Activation checks the served pair inside its lock, and lifecycle unit fixtures now carry real TLS material. Import snapshots every input once into a private staging directory and validates and installs only those bytes. Recovery completes only a matching certificate/key set, otherwise restores a verified backup, otherwise refuses and keeps the journal and files. | `tests/ops/test-tls-cli.mjs`: the real CLI in separate processes, the real kernel lock, real OpenSSL paused at import's final check, and a temporary root → intermediate → leaf. Cases: CSR during import, recover during import, an unlocked writer changing the pending key, the review's journal-matching incompatible set, and no valid candidate. Plus unit tests for activation under the lock and interrupted restore. | **12 of 20 FAIL → 20/20** ([before](regressions/h2h4-before.txt), [after](regressions/h2h4-after.txt)) |
| **H3** egress exit status | `namespace-egress.sh` keeps a cumulative failure count and exits 1 on any failed assertion, in both modes. Docker/exec errors, missing tools and probes without a result marker are failures, never denials. Blocking must be confirmed by the namespace drop counter. Only this run's sinks are removed. | `tests/offline/test-namespace-egress.mjs`: the actual script with a controlled Docker stand-in. Cases: routable host, exec failure, forbidden connect succeeds, counter missing or unchanged, upstream down, `nc` missing, probe container fails, plus valid host-only and host + edge runs. | **8 of 13 FAIL → 13/13** ([before](regressions/h3-before.txt), [after](regressions/h3-after.txt)) |
| **H4** rollback with the full-chain backup | `tls restore --from <backup>` validates a saved set (key, recorded names or its own SAN, purpose, saved chain to its saved root) and installs it through the journalled replacement. Backups add `leaf.crt`, `chain.pem` and `served.json`. The documented rollback is updated (RUNBOOK, DEPLOYMENT_PLAN). | In `tests/ops/test-tls-cli.mjs`: import → renewal → documented rollback restores chain, key and trust **byte for byte**; the split files also import; a tampered backup is refused. Unit test: interrupted restore → `tls recover` → backup set in place. | included above |
| **H5** 413 response vs schema | Every ingress-generated JSON error now carries `request_id` (nginx `$request_id`, also written to the redacted access log), so API- and ingress-generated bodies satisfy the same strict `ErrorBody` schema. The schema was not weakened. | `tests/security/test-error-contract.mjs` (template literals vs exported schema); `apps/api/src/docs.test.ts` (API-generated provider 413 for route, proximity, search and POIs against the served schema; an old-style body without `request_id` is still rejected); `test-proxy-boundary.mjs` (the real nginx 413 and map/diagnostics error bodies validate, with a 32-hex `request_id`) | **7 of 10 FAIL → 10/10**; boundary **104/104** ([before](regressions/h5-before.txt), [after](regressions/h5-after.txt)) |
| Packaging and links | The client guide leaves the operational bundle (`INSTALL_PATHS`). A separate, declared client handoff pack (`infra/handoff/build-client-pack.mjs`) is built from a list, refuses outside links, operator material and PEM keys, and writes `PACK-MANIFEST.json`. | `tests/client/test-handoff-artifacts.mjs` | **2 of 5 FAIL → 11/11** ([before](regressions/pack-before.txt), [after](regressions/pack-after.txt)) |
| Wording | Proximity uses one Valhalla route per pair (`routing.pair`), not a matrix. `dataset_id` is described per response kind. | `docs.test.ts` (export = runtime) | — |

## Full validation on the corrected tree

| Check | Result |
| --- | --- |
| `npm run build` (contracts → map-assets → api, ops, web) | rc 0 ([`build.txt`](build.txt)); OpenAPI export identical to the runtime document |
| `npm run typecheck` | rc 0 ([`typecheck.txt`](typecheck.txt)) |
| `npm test` | **226 PASS**: contracts 12, map-assets 6, API 57, OPS 151 ([`unit-summary.txt`](unit-summary.txt)) |
| Seven existing standalone suites | **175/175**: reclaim 4, update gate 74, host guard 26, navigation 9, verdict 9, seeds 18, dev proxy 35 ([`standalone/`](standalone/)) |
| Exact-image proxy boundary (locked proxy image's nginx, extracted without a container) | **104/104** |
| New focused regressions | wrapper 59, TLS CLI 20, egress 13, error contract 10, artifacts 11: all PASS |

**Not run (no PASS claimed):**
- image builds, relock, bundle export;
- full-stack security, lifecycle, offline host and restore drill;
- browser and Swagger UI checks;
- the real Docker namespace egress run;
- the cutover rehearsal;
- live Iran seed queries;
- LAN, Windows, mobile and load.
