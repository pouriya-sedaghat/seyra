# R1/R2 follow-up (review of e6a39ab): evidence

Reviewer verifier on a copy of `e6a39ab`, pinned Node 24.21.0 / OpenSSL 3.5.5: both counterexamples reproduced ([`reviewer-verifier-at-e6a39ab.json`](reviewer-verifier-at-e6a39ab.json)).

| Finding | Fix | Regression | Before → after |
| --- | --- | --- | --- |
| R1 recovery fallback | Import journals (`seyra.tls-replace/3`) record the hash of every backup file. `tls recover` copies the backup into private staging and validates it as a complete set before any active file changes: all files present, hashes equal the record (older journals: no record, so full validation only), key matches, chain verifies to the set's own root for every served name (`-no_check_time`), metadata consistent. Otherwise it refuses, keeping the journal and active files. | `tests/ops/test-tls-recover.mjs` (real tlsImport interruption, real CLI recover) | 15 of 24 FAIL → 24/24 |
| R2 reused pack output | The builder refuses an output that is not absent or an empty plain directory, before writing anything, and never deletes. Manifest hashes come from the delivered bytes, and the final inventory must equal the manifest. Records `source_tree_clean`. | `tests/client/test-handoff-artifacts.mjs` | 4 of 19 FAIL → 19/19 |

Validation on the corrected tree:
- Build and typecheck pass.
- Unit 226 PASS (12/6/57/151).
- Standalone 424 PASS, including the accepted H1–H5 suites and the exact-image boundary 104.

Not run: images, Docker/browser suites, rehearsal, LAN/Windows/mobile/load.
