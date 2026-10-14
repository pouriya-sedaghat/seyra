# Seyra — Map Services Acceptance Register

Version: 1.0
Date: 2026-10-14
Initial execution status: NOT RUN. Documentation verification alone is not a functional test.

Record test command, commit, locked versions, hardware, dataset checksum, result and evidence path. Use PASS / FAIL / NOT RUN / BLOCKED, with reason. Required engineering checks cannot be marked passed by mocks alone. Full-Iran and mobile/customer-network checks are separate pending release validation.

| ID | Engineering acceptance |
| --- | --- |
| AC01 | Typecheck/build and meaningful unit/contract tests pass. Serving modules never substitute fixture data or mock results for missing real providers. |
| AC02 | Runtime Compose starts all four capabilities without opt-in profiles/feature toggles; no build section or pulls. Missing images fail early. Record actual Docker/Compose/platform/image identities. |
| AC03 | Install, local import, start/restart, update and rollback with external egress denied. Capture product-controlled processes/network namespaces and browser traffic: zero outside-network attempts. Never alter the developer's global firewall to test this. |
| AC04 | Inventory/scan executable configurations, styles, assets and entrypoints for external fetches. Docs/licence attribution URLs are not falsely treated as runtime calls; investigate reachable SDK/image defaults. |
| AC05 | Same dataset_id throughout manifest/provider markers/responses. Mismatch or missing mandatory provider means not ready. Unknown/mixed version requests fail; expose real health, not hardcoded green markers. |
| AC06 | Corrupt input, interrupted import and failed stage checks leave active provider outputs and managed artifact checksums unchanged. Build jobs cannot write active map/control stores. |
| AC07 | Test maintenance cutover, provider-start failure, incomplete activation recovery and complete rollback. After restoration all providers report the previous release; do not claim zero downtime/atomic multi-service swap. |
| AC08 | Synthetic real-provider fixture produces decodable MVT for each catalog family/geometry; validate source IDs/tag mappings, POI generic fallback and documented exclusions independently. Don't sum cross-tile duplicates. |
| AC09 | Browser visually verifies light/dark, Persian/English label fallback, Yeh/Kaf, lam-alef, digits, ZWNJ and punctuation with local fonts/assets; zero external/RTL-plugin requests. Capture missing text/asset failures honestly. |
| AC10 | Exercise all supported routing-table cells on real fixture graph; reject multipoint/optimized alternatives, excess limits and date_time. Verify motorcycle=no, pedestrian-only/access and one-way behavior. |
| AC11 | Returned routing metadata distinguishes profile/objective, not-guaranteed road optimality, modeled order cost and actual returned totals. Duration is an estimate, never live traffic. |
| AC12 | Independently enumerate small directed waypoint permutations to validate Held–Karp modeled-cost optimum, stable ties, fixed endpoints, duplicates, disconnected cases and visit-once mapping. Test all profiles/objectives via fixture providers. No exact-road flag. |
| AC13 | Proximity requires explicit metric/direction; verify asymmetric roads, units, deterministic ties, all supplied candidates within cap, unreachable versus provider failure, and no straight-line fallback/hidden shortlist. |
| AC14 | Actual Photon forward/reverse/typeahead fa/en fixtures; normalization variants preserve correct original display text. Quantify quality; do not impose identical rankings unsupported by data or invent owner's real-address hit rate. |
| AC15 | Raw QL, arbitrary regex/URLs, invalid enum values, oversized bbox/results and injection-shaped input rejected. Overpass has time/memory/concurrency limits; truncation explicit. |
| AC16 | Client-side scan sees only intended loopback/TLS ingress; optional configured LAN mode fails closed without explicit allowlist/certificates. Providers/DBs/update actions are inaccessible directly. |
| AC17 | Runtime DB roles cannot import/write map/application data; secret files are scoped; query/coordinate/private data and secrets absent from default logs; map names are safely rendered as text. |
| AC18 | Loaded offline image references resolve to manifest identities; no mutable tags or invented digests; bundle checksum verification detects tampering/corruption. Rebuild/run instructions and locked source/licence inventory present. |
| AC19 | User's original datasets and unrelated local changes remain untouched; no public deployment/merge, no Auth/Relation/SOS workflow code. |
| AC20 | Document endpoints/schema/error/unit/asset/TLS contracts for mobile with sample fixtures; explicitly label actual mobile SDK execution as pending. |

Production validation still pending: owner Iran snapshot/completeness/search fixtures, import RAM/disk/time, full-country tile/routing/geocoder load, Overpass limits, storage/staging/rollback sizing, update cadence/downtime/SLA, target OS/CPU/internal CA/time/DNS, mobile SDK execution and distribution-specific licence obligations. No number in phase-1 defaults is a measured production capacity claim.

Default limits may be tightened through documented configuration, not by disabling required services. Changes to solver cap/objective semantics/support combinations require updated requirements and tests.
