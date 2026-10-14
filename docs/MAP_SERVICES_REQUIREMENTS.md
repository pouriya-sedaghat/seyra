# Seyra — Map Services Requirements Register

Version: 0.2
Date: 2026-10-14
Status: ANSWERS RECORDED — remaining decisions and Claude Code review pending.
Related: docs/PROJECT_BRIEF.md and docs/MAP_SERVICES_ARCHITECTURE.md.

Status labels: CONFIRMED = explicit user requirement; PROPOSED = working interpretation or design choice awaiting acceptance; UNRESOLVED = missing product or operational decision. Do not silently promote a proposal to a requirement.

## Recorded answers

| ID | Status | Requirement / answer | Remaining decision |
| --- | --- | --- | --- |
| M01 | CONFIRMED | Nationwide Iran; user acquires raw OSM data and supplies it for local import. | Input snapshot/format, integrity metadata, update cadence, border completeness, proprietary additions. Propose Iran .osm.pbf as the input contract. |
| M02 | CONFIRMED | Vector tiles; comprehensive details/features/POIs; light and dark styles. | Explicit layer/POI catalog, zoom range, label language and test fixtures. Satellite imagery and terrain elevation are not separately requested. |
| M03 | CONFIRMED | Car, pedestrian, motorcycle; faster and shorter routes; alternatives and multiple destinations. | Combined alternatives + multipoint, visit-order optimization, optimality guarantees, direction and route metric semantics. |
| M03-P | PROPOSED | Proximity supports explicit selectable straight-line, road-distance, and estimated-time metrics. | User repeated the metric list; confirm all three and define the default later. No implicit fallback. |
| M04 | PROPOSED | Forward address/place search, reverse geocoding, autocomplete, Persian/English search. | User repeated the question; confirm all capabilities. Typos, Persian normalization and label behavior need examples and acceptance targets. |
| M05 | CONFIRMED | Overpass is part of the earlier contractual scope; individual map services must not be disableable. Application use-case design is delegated for study. | Propose bounded POI presets through the gateway; do not expose unrestricted interpreter queries to clients. |
| M06 | PROPOSED | No guaranteed local map/search/routing during server disconnection in the first phase. | Latest answer says this probably is not necessary, superseding the direction of the earlier affirmative answer; confirm scope reduction. Internet-independent LAN operation/install/update remains mandatory. |
| M07 | CONFIRMED | No mandated image; services cannot be disabled. Necessary non-PostgreSQL map-service storage may be reviewed. | Exact images/storage not yet accepted. OS, architecture, CPU, RAM, SSD, concurrency and SLA are unknown. |
| M08 | CONFIRMED | Both web and mobile consume the platform. Current assigned deliverables are backend and web test client. | Mobile OS/framework/SDK and ownership of the mobile application are unknown. |

## Focused user decisions

- Q1: Confirm that M04 includes all four geocoding capabilities and both languages.
- Q2: Confirm whether server-disconnected local map/search/routing may be excluded from the first phase. This is different from operating without Internet inside the internal network.
- Q3: Are alternatives required only for origin/destination routes, or also for multipoint routes?
- Q4: Does multi-destination mean following the user's supplied order, optimizing that order, or both? Propose ordered waypoints initially; do not imply optimization.
- Q5: Must shortest/fastest be guaranteed global optima under a defined cost model, or are explicitly documented engine preferences acceptable? No live-traffic source has been requested.
- Q6: Confirm selectable proximity metrics or specify one. Road distance must identify whether it measures the chosen recommended route or a separately distance-optimized route.

Hardware is not a reason to invent production sizing. A reference development environment may be proposed, labeled and measured; production sizing/readiness remain pending. Unresolved required routing combinations or privacy behavior must not be papered over with mock behavior.

## Proposed definition of comprehensive detail

Coverage is bounded by the supplied Iran OSM snapshot and an agreed versioned layer/POI catalog. Retain the original input and appropriate tags/provenance for re-import and inspection. Proposal for the catalog: administrative boundaries, places/labels, roads and paths, railway features, buildings, waterways/water, land use/land cover, and POI categories available in the input.

Rendering may use documented zoom thresholds and generalization for readability/performance. A feature hidden at one zoom must not be described as absent from the source. Rare/unmapped tags and relations require explicit policy; a default importer/style does not prove complete OSM coverage. Satellite photos and missing addresses cannot be derived merely by importing OSM.

## Acceptance register to finalize

| Area | Proposed check | Missing target/input |
| --- | --- | --- |
| Data | Same source checksum/version feeds all service-specific imports; useful failure on malformed/incomplete input. | User-provided snapshot and geographic validation fixtures. |
| Tiles | Decode representative MVTs; verify agreed layers, names, identifiers and POIs; test light/dark styles and Persian text where agreed. | Layer catalog, zoom range and language policy. |
| Assets | Load all styles, glyphs/fonts, sprites, SDK bundles and map resources from the internal network with external access denied. | Pinned web/mobile SDKs and asset inventory. |
| Routing | Exercise each agreed profile/objective/waypoint/alternative combination against real graph fixtures; unsupported combinations return explicit errors. | Q3–Q5; engine/image pin. |
| Proximity | Metric, direction, profile, units and dataset revision are explicit; unreachable candidates are handled; no hidden approximation. | Q6; limits and accuracy target. |
| Search | Test forward/reverse/autocomplete and Persian/English fixtures, including no-result cases. | Q1 and sample searches. |
| Overpass | Run bounded POI presets; reject unsafe/oversized inputs and enforce time/memory/result limits. | Accepted presets and limit values. |
| Updates | Import/build into staging; validate coordinated dataset activation and test rollback. | Update cadence, downtime and available storage. |
| Capacity | Measure imports, peak RAM, disk, latency and concurrency with reproducible settings. | Target hardware/load/SLA. |
| Client loss | Show connection loss and do not claim a live/delivered operation without a server acknowledgement. | Q2; later location/SOS requirements. |

Authentication, Relation System, and SOS will receive separate intake before their implementations. Map Services must provide shared contracts without prematurely defining those modules' business rules.
