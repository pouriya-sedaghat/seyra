# Seyra — Map Services Requirements

Version: 1.0
Date: 2026-10-14
Status: PHASE-1 BASELINE; provider verification and production measurements remain pending.

## Requirements and decisions

| ID | Baseline | Origin |
| --- | --- | --- |
| M01 | Iran raw OSM file supplied by owner; local .osm.pbf input contract; OSM-only phase 1. | Owner coverage/source answers; format is an engineering choice. |
| M02 | MVT vector tiles; light/dark; catalog below; fa/en label switch. | Owner vector/detail/style requirement; language/catalog/zoom defaults are engineering choices. |
| M03 | Car, pedestrian, motorcycle; time/distance-oriented routes; ordered and optimized stops. | Owner confirms profiles/features/both order modes; objective implementation delegated. |
| M03-P | Explicit straight_line, road_distance, travel_time metrics; explicit origin_to_candidate/candidate_to_origin direction. | All metrics confirmed; direction API is an engineering choice, not an SOS rule. |
| M04 | Free-text address/place search, reverse, autocomplete, fa/en; Photon runtime, Nominatim build-time. | Owner confirms all geocoder features; topology is an engineering choice. |
| M05 | Overpass always deployed; controlled bbox POI queries. | Contract/owner mandatory-service answer; query scope delegated. |
| M06 | No guaranteed server-disconnected local map/search/routing or queued operations. | Latest owner confirms exclusion unless necessary; none is necessary to deliver LAN map services. |
| M07 | Required map services cannot be disabled. Reference linux/amd64 Ubuntu 24.04 + Compose v2; fully inventoried service storage. | Owner confirms no disable and storage review; environment/storage selections are engineering choices. |
| M08 | Shared web/mobile integration contracts; implement backend and web test client only. | Owner confirms both consumers; mobile implementation remains unassigned. |

Q1–Q6 from v0.2 are resolved by the owner's latest answers and the technical decisions below. Unknown production hardware is not converted into a fictitious customer specification. Geographic/update/SLA fixtures still need real data before production sign-off.

## Map catalog v1

Retain the original file, provenance and source identifiers. The rendering pipeline preserves relevant original tags/names in a canonical inspection representation; a fixture-tested mapping defines geometries and layer attributes. Preserve unrendered/unknown tags for inspection/re-import and report exclusions. Do not claim to display all real-world objects or every OSM relation merely from an import.

| Layer family | Content | Native minimum zoom defaults |
| --- | --- | --- |
| Boundaries / places | Available administrative boundaries, country/region/city/town/village/place labels | 0; progressively detailed classes |
| Water / waterways | Water polygons, rivers, streams, canals | 0 / 8 / 12 by class |
| Land cover / land use | Available natural and landuse geometries | 0 / 8 by class |
| Transport | Roads, paths, rail; bridge/tunnel/access attributes where present | 4 for major classes; detail through 14 |
| Buildings | Buildings and documented multipart handling | 14 |
| POIs | All values under amenity, shop, tourism, leisure, office, healthcare, craft, historic, emergency and public_transport; generic fallback icon | 12 for selected major features; all catalog POIs eligible at 16 |

Tile range: native z0–16; client overzoom to 22. Above native range, do not invent extra geometry. Generalization, class-specific visibility and collision rules are documented, not silent data loss. Count source objects using stable type/id identifiers, not sums across duplicated/clipped tiles. Uncatalogued tagged objects remain inspectable through the rendering canonical data/tooling; generic runtime POI exposure is bounded by the catalog. Terrain/satellite imagery and arbitrary new custom layers are outside phase 1.

Label fallback: Persian mode name:fa → name → name:en; English mode name:en → name → name:fa. No invented translations. Preserve display spelling. Search normalization is separate from display text. Web UI is Persian-friendly with explicit language/units; mobile SDK compatibility is documented, not declared tested.

## Routing support table

Every supported cell below applies to car, pedestrian and motorcycle after provider fixtures pass. Unsupported cells return UNSUPPORTED_COMBINATION and appear in capabilities metadata.

| Order / point count | time objective | distance objective | Alternatives |
| --- | --- | --- | --- |
| Ordered, 2 points | Supported | Supported | Up to 2 additional routes, possibly fewer/none |
| Ordered, 3–25 points | Supported | Supported | Unsupported |
| Optimized, 3–10 points | Supported | Supported | Unsupported |
| Optimized, 2 points | Same order as input; no reorder needed | Same order as input | No optimization/alternative combination |
| Above limits or supplied date_time / live traffic | Rejected | Rejected | Rejected |

Ordered visits are stopping/break locations. Fixed first/last locations, each intermediate input ID visited once. Retain original-index mapping. Duplicate coordinates may represent separate stops and must be handled deterministically; IDs must be unique. Loops can use distinct start/end IDs at the same coordinates.

Time and distance are routing preferences. Expose route_optimality=not_guaranteed, objective, profile, provider and dataset_id; do not return an exact-road-route flag. Duration is a static estimate. Respect the pinned engine's mapped access restrictions; validate motorcycle=no and profile differences. Extra jurisdiction-specific or time-dependent motorcycle rules are not silently fabricated from absent OSM tags; obtain them before later real-world dispatch acceptance.

Optimization baseline: construct a directed pair-cost table using bounded two-point routes for the selected profile/objective, not an unverified distance matrix option. Minimize summed duration_s for time or distance_m for distance. Use deterministic Held–Karp dynamic programming with fixed endpoints, at most 10 total points (8 reordered intermediates). Mark visit_order_optimal_for_pair_costs=true only after a complete successful table/solver run; route_optimality stays not_guaranteed. This is exact for that additive table, not for all possible road paths, changing turn state or live traffic. Return the modeled cost and actual final-route totals separately. If no finite visit order exists, return NO_ROUTE; never omit a stop. Do not silently raise the exponential solver cap; higher limits require a deliberate algorithm/resource review. Valhalla's native optimized endpoint is not assumed to support every required profile/objective.

Limits are versioned configurable operational limits, not feature switches. Defaults: ordered points 25, optimized points 10, additional routes 2; provider per-operation concurrency 4 and bounded queue. Standard route deadline 30s; optimization deadline 120s. Reject over-limit requests; cancellation releases outstanding work. Tighten resource defaults after measurement; do not promise an SLA.

## Proximity

Request explicitly names metric, direction, profile for road metrics, origin and uniquely identified supplied candidates. Initial cap 50 candidates; rank only this set. Return distance_m/duration_s as relevant, dataset_id, metric/direction/profile, and an explicit unreachable status. Straight-line distance uses PostGIS geography meters. Road distance uses the selected distance-oriented two-point route; estimated time uses time-oriented two-point routing. Avoid relying on unverified matrix shortest semantics. No global nearest-among-all-users claim, hidden spatial shortlist, temporal location freshness rule or eligibility logic. Those belong to future modules. Provider failures are distinguished from genuinely unreachable routes.

## Geocoder and POI queries

Forward/reverse/autocomplete: fa/en, explicit coordinates/bias/bbox, typed no-results, bounded 1–20 results, query length cap 256 Unicode code points. Preserve original names. Fixture-test Unicode normalization, Arabic/Persian Yeh/Kaf, digit variants, diacritics and ZWNJ handling consistently at import/query time; do not claim identical rankings unless demonstrated.

POI presets initially: hospitals, pharmacies, police, fire stations, fuel, parking, schools, food and a catalog-key/value selector generated from a finite allowlist. Key/value validation must not accept raw QL. Bbox-only, at most 100 km², up to 200 returned features, Overpass query timeout 10s and explicit server memory/concurrency limits. Limits are reference defaults, not measured production settings. Return truncation explicitly. No full-country raw query, arbitrary regex, area query, attic/contributor data or provider update endpoint exposed to clients.

## Test access and remaining validation

Default proxy bind is 127.0.0.1:8443 with locally generated/imported TLS. An explicit shared-test LAN configuration requires an operator-supplied CIDR allowlist and certificate trust; blank allowlists fail closed. This is temporary network control, not Seyra Authentication. Test UI uses user-entered/demo coordinates and OSM features, not private user tracking or SOS. Never change host firewalls, expose publicly or deploy to a customer network as part of code generation.

Pending production inputs: actual Iran file/quality examples, update cadence/downtime, machine/load/SLA, customer CPU/OS, internal CA/DNS/time policies, real mobile SDK owner/versions, additional motorcycle rules, distribution conditions. Continue engineering with clearly synthetic fixtures; do not mark pending acceptance as passed.
