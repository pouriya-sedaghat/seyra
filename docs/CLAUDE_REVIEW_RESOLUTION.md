# Seyra — Claude Review Resolution

Version: 1.0
Date: 2026-10-14
Input: owner-provided critical review of brief v0.2 at 411d6add56f99166b70f9e5941aacdc3c1878770. This is a disposition summary, not a claim that every upstream observation or binary was independently verified.

## Owner answers and delegated decisions

All four geocoder capabilities/fa/en and all three proximity metrics confirmed. Server-disconnected client capabilities excluded. Multipoint alternatives desired only without substantial complexity, so excluded in phase 1 with explicit errors. Ordered and optimized visits both required. Best routing method delegated: use documented distance/time preferences without absolute road optimality promises. Bounded exact optimization applies only to modeled waypoint pair costs.

## Review dispositions

| Finding | Disposition |
| --- | --- |
| K1: PostGIS does not mandate live tile serving | Accepted. Tegola selected on explicit SQL/catalog/topology grounds; Martin/archives remain valid alternatives. No mandatory evaluation-only phase introduced. |
| K2/K13: incomplete storage/components | Accepted. Architecture has full stores, Nginx, Java/tools/assets, transfer archives and operator CA/time/DNS responsibilities. Do not add unrequested infrastructure services. |
| K3/S1/S2: scripted routing downloads/rebuilds | Accepted. Base image + explicit staging builds; audit pinned timezone/speed behavior. No startup import. |
| K4: Nominatim auxiliary fetches | Accepted. Local inputs only; unneeded auxiliary data omitted. No wiki/importance fallback downloads. |
| K5: Nominatim runtime not justified | Accepted. Temporary build DB → local Photon export/index; no Nominatim runtime server. Test actual free-text quality; failures block claimed completion rather than silently adding another topology. |
| K6: Photon languages/normalization/reimport | Accepted. fa/en explicit, fresh indexes, original names preserved, fixtures. Master docs mention features newer than observed release: exact CLI/secret support must be checked. |
| K7: MapLibre RTL/font versions | Partly independently verified: 6.9.0 release notes native Arabic/Hebrew shaping. Select verified native-RTL release without plugin; test Persian and distinguish web from unassigned mobile SDK. |
| K8/Semantics/AC9: exact route flags | Road global-optimality requirement not adopted; no exact-road flag. Document preference/pruning limits. Exact visit-order claim narrowly scoped to complete pair-cost model. |
| K9: native optimized endpoint | Considered. Public optimized docs list auto/bicycle/pedestrian; use uniform bounded application ordering for requested motorcycle and both objectives instead of assuming full native support. |
| K10: matrix objective gaps | Accepted. Use objective-specific two-point routes for proximity/order cost tables; no unverified shortest-matrix dependency. |
| K11: Overpass format/areas/licence | Accepted. Local XML conversion, bbox-only presets, no area/attic data. Record actual selected source licences; do not impose an extra conversational approval gate merely to begin coding. |
| K12: SOS direction prematurely fixed | Accepted. Required API parameter, no SOS business rules now. |
| K14: mobile acceptance unexecutable | Accepted. Deliver compatibility contract/fixtures; actual mobile execution remains assigned-owner/SDK validation. |
| K15: Iran detail/legal rule expectations | Accepted. Preserve/report source gaps. Validate mapped access fixtures, obtain additional domain rules before real dispatch acceptance. |
| S4/S8/S9/S14: imports/cutover/storage | Accepted. Dedicated staging stores, maintenance cutover/readiness gate, active + previous retention, measure peaks. No atomicity or exact double-space claim. |
| S5/S6/S7/S10/S11/S12/S13 | Accepted through local assets, enum POI allowlists, private provider networks, log redaction, localhost/CIDR test boundary, internal TLS provisioning and dependency identity checks. |

The review's cloud session is accepted as the observed development environment. No assumption that Claude is necessarily running on the owner's physical computer remains.

## Version-verification corrections

Observed current manuals can differ from a CHANGELOG or source master. Independent retrieval saw Valhalla 3.9.1 release notes dated 2026-10-06, while the review cited 2026-10-01, and Nominatim's current manual identifies 5.3.2 while the review cited a 5.3.0 CHANGELOG. These are reasons to lock actual releases/commits, not copy dates or fabricate image digests. See DEPENDENCY_BASELINE.md.

## Readiness

Owner product questions are resolved for phase-1 engineering. Coding is authorized by the project workflow on a separate feature branch after reading this baseline. Preflight pin validation and real provider fixtures are execution tasks; provider incompatibility must be reported and dependent feature claims stopped. Production data/hardware/mobile/network validation remains pending. Do not repeat resolved questions or mark unexecuted checks as passed.
