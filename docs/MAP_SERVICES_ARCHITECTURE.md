# Seyra — Map Services Research and Proposed Architecture

Date: 2026-10-14
Status: PROPOSAL FOR CLAUDE CODE AND USER REVIEW — not an implementation specification.

This is a documentation-based feasibility study. No selected image, full-Iran import, performance test, Persian search benchmark, or web/mobile interoperability test has been executed. The references below are official project documentation, repositories, and the OSM Foundation. Exact releases/image digests must be checked and recorded when the design is finalized; documentation on moving branches does not pin a release.

## 1. Candidate stack and reasoning

| Responsibility | Proposed component | Evidence / reason | Open validation |
| --- | --- | --- | --- |
| Application gateway | Node.js + TypeScript; a modular application with provider adapters | User-required stack; proposal for shared contracts and bounded provider access. | Framework choice, API schemas and later authentication boundary. |
| Vector tiles | Tegola with its PostGIS MVT provider | Official configuration supports PostGIS-backed MVT layers. Fits the required database stack. | Layer SQL/schema, cache behavior, image provenance, nationwide performance. |
| OSM rendering import | Containerized osm2pgsql flex pipeline into a dedicated PostGIS map database | Official flex interface defines tables and data mapping. | Layer/tag coverage, complete geometries, indexes and reproducible import. |
| Web map | Locally bundled MapLibre GL JS; local light/dark styles and assets | Official browser renderer supports vector tiles. | RTL/Persian rendering and the agreed mobile SDK's style compatibility. |
| Routing | Valhalla, provisionally | Documented vehicle costing and routing/matrix APIs match much of the requested scope. | Capability caveats in section 2; motorcycle behavior on Iran fixtures. |
| Geocoding | Nominatim for address/place search and reverse; Photon for autocomplete | Photon documents typeahead and multilingual search; Nominatim exposes search/reverse interfaces. | Need for both runtimes, Persian quality, index size and pinned import compatibility. |
| OSM feature queries | Private Overpass instance with bounded gateway POI presets | Official self-hosting instructions describe local data import and independent storage. | Approved queries, import/area handling and resource limits. |
| Deployment | Docker images plus Compose as a proposed initial deployment target | A simple reference topology, not a customer OS/hardware requirement. | Target host/CPU, image inventory, offline installer and resource settings. |

Tegola is proposed because it aligns with the supplied PostGIS constraint and allows explicit layer queries; its name being mentioned by the user alone was not a selection. Its configuration does not automatically provide a complete nationwide basemap. A versioned import schema, layer catalog, style rules, POI mapping and local assets are separate deliverables. See [Tegola configuration](https://tegola.io/documentation/configuration/) and [osm2pgsql manual](https://osm2pgsql.org/doc/manual.html).

Proposal: start with dedicated databases/roles for Seyra application data, rendering data and Nominatim. They may share a reviewed PostgreSQL installation, but import/write-heavy map work must not receive application-data privileges. Separate instances remain an option after measurements; this is not yet a production sizing decision.

## 2. Routing evidence, caveats, and alternatives

[Valhalla route documentation](https://valhalla.github.io/valhalla/api/route/api-reference/) documents auto, pedestrian and motorcycle costing, ordered waypoints, and alternatives; motorcycle costing is labeled beta. Alternatives do not support more than two locations or time-dependent routes and may return fewer results than requested. Its distance-oriented option does not alone guarantee global shortest paths because of hierarchy pruning; changing pruning trades performance for stronger optimality within documented limits. Default time-oriented costing also includes preferences/penalties. These limitations require a clarified contract, not misleading shortest/fastest labels.

[Valhalla matrices](https://valhalla.github.io/valhalla/api/matrix/) return travel times/distances between locations. Verify profile, objective, direction, limits, and whether matrix distance measures the desired route objective in the pinned release. Do not call a distance measured along a time-oriented route the globally shortest road distance.

Comparison: [OSRM's API](https://project-osrm.org/docs/v5.24.0/api/) offers routes, alternatives and tables, but its table distances describe fastest routes, not independently shortest-distance routes. This reference is versioned documentation, not a claim that v5.24.0 is the current release. [GraphHopper's upstream project](https://github.com/graphhopper/graphhopper) offers a self-hostable engine, but hosted Directions API features must not be assumed to exist in the self-hosted edition. Neither alternative has been validated against the requested combinations; Valhalla remains provisional.

Proposed public profiles: car, pedestrian, motorcycle. Objectives: time and distance, with documented semantics and supported-combination metadata. Road distance/time must be directional (candidate-to-incident for an eventual assistance scenario). Off-graph/unreachable results are explicit, not silently replaced by straight-line estimates. A spatial shortlist can improve efficiency but is an approximation unless completeness of the ranking is demonstrated; exact top-K claims require examining all eligible candidates or a valid bound. Eligibility and real-user data remain future SOS/Relation requirements.

Multi-destination ordered routing and visit-order optimization are different features. Do not promise the latter based on support for the former. Do not manufacture complete alternative routes by merely combining per-leg alternatives without a reviewed algorithm and acceptance tests.

## 3. Geocoding and Persian handling

[Photon upstream](https://github.com/komoot/photon) documents search-as-you-type, multilingual search, typo tolerance, spatial filters and reverse geocoding. [Its usage guide](https://github.com/komoot/photon/blob/master/docs/usage.md) describes importing from Nominatim, language selection, and embedded or external OpenSearch storage. Imports replace an existing Photon index; build into staging, not the active data directory. Keep Nominatim updates stopped during Photon import. Persian/English translations depend on the input names and import configuration; multilingual capability is not proof of Iran search quality.

[Nominatim import documentation](https://nominatim.org/release-docs/latest/admin/Import/) permits regional imports and identifies auxiliary importance data; source-extract completeness can affect administrative areas. Proposed approach: import the local Iran file into a dedicated Nominatim database, then build a staged Photon index with fa/en coverage. Evaluate the need for optional auxiliary data; any accepted auxiliary source is supplied locally. [The public Nominatim service policy](https://operations.osmfoundation.org/policies/nominatim/) says autocomplete is unsupported there and explicitly distinguishes the public service from self-hosted instances; its public rate policy is not Seyra's self-hosted capacity specification.

Proposal: preserve original display strings; use consistent Persian/Arabic character and digit normalization for search indexing and query handling, agreed through fixtures. Test partial names, addresses, POIs, mixed scripts and missing translations. Do not transliterate or silently rewrite authoritative display names.

Storage outside PostgreSQL is proposed for the Photon index, Valhalla graph and Overpass database. Photon can use an embedded search backend, avoiding a separate exposed search cluster initially. Necessity, resource use, licenses, backup/update strategy and access controls must be reviewed before accepting this exception.

## 4. Overpass scope

Keep Overpass deployed because it is in the contractual scope and map services must not be disableable. Proposal: gateway-owned POI presets for categories such as hospitals or pharmacies, with bounded geographic filters. End-user raw query execution is not proposed. Categories are suggestions, not agreed product functionality.

[Official Overpass setup](https://dev.overpass-api.de/overpass-doc/en/more_info/setup.html) describes an independent data directory and local XML import, with separate area-processing configuration. The supplied PBF may require local format conversion using a packaged tool; [Osmium](https://osmcode.org/osmium-tool/manual.html) supports reading/writing OSM formats. Propose current geographic data without contributor metadata or historical attic data, since neither is requested. If polygon/area queries are accepted, include their required build processes and fixtures.

No public clone URL, periodic Internet replication fetcher, or unbounded interpreter access belongs in the operational configuration. Apply private networking, query time/memory/result limits, bounded request sizes and gateway input validation. Overpass is for base-map OSM objects; do not store live user locations in it.

## 5. Shared web/mobile interface and assets

Proposal: a single internal HTTPS entry point for versioned application APIs and local map assets. Web uses same-origin endpoints. Mobile uses documented absolute internal URLs, certificate trust/provisioning and the agreed SDK's supported style features. Internal DNS/PKI/time must also work without outside access; specific provisioning choices remain open.

Separate routing/geocoding/POI adapters from transport details. Specify units, coordinates, languages, dataset revision, request limits, pagination/geometry size and typed errors. Propose GeoJSON/WGS84 for geometry with explicit longitude/latitude array order; provider latitude/longitude objects are adapted consistently. Binary tile delivery should not depend on rebuilding application JSON handlers for every tile.

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) is a browser renderer; MapLibre Native is its related mobile renderer. [The style specification](https://maplibre.org/maplibre-style-spec/root/) defines sources, sprites, glyphs and fonts, with SDK-specific support. Self-host all resources, including font/glyph ranges and any text-shaping resources required by the pinned SDK. Do not copy documentation examples containing CDN/demo tile or font URLs into Seyra. Validate light/dark styles on actual agreed SDKs; shared vector tiles alone do not prove cross-platform text compatibility.

Latest working scope: clients need a connection to the internal server for map services; no guaranteed server-disconnected local search/routing/map pack is proposed for the first phase. This still fully excludes Internet dependencies. Confirm this change before finalizing the brief.

## 6. Offline import, packaging, updates and rollback

Proposal for the pipeline:

1. Receive the user-supplied Iran dataset and a version/checksum manifest in a local input directory. Validate the file and retain the original artifact.
2. Build service-specific rendering data, routing graph, Nominatim database, Photon index and Overpass database from that same source revision. Supply any approved auxiliary data locally.
3. Build in isolated staging resources; collect feature/coverage validation and import RAM/time/storage measurements.
4. Make a coordinated dataset release available after all required service checks pass. Version map styles/schema/cache with the data; report component revisions during health checks.
5. Activate according to an agreed maintenance-window/cutover procedure. Retain a compatible previous release and test rollback; do not promise atomic cross-service switching until demonstrated.

The deployment bundle should contain pinned loadable Docker images, packaged application/web artifacts, local fonts/styles/sprites, necessary tools and auxiliary data, a manifest with checksums/provenance/license information, configuration templates without secrets, and offline install/import/update/restore instructions. If Docker itself is not preinstalled, host prerequisites/installers must also be provided for the agreed OS. No deployment-time npm/apt/pip fetches, cloud registries, external telemetry, public DNS checks, or Internet license checks.

[Valhalla's upstream Docker guide](https://github.com/valhalla/valhalla/blob/master/docker/README.md) provides base/scripted images and local volume input. Its scripted configuration also includes remote inputs, such as a default speed-configuration URL, and optional downloading elevation. Audit the pinned entrypoint and prefer a controlled local build/run flow rather than relying on default startup behavior. Upstream/community/self-built image provenance must be recorded for every component. Custom Docker images are acceptable candidates, subject to pinned sources and repeatable builds; no specific image vendor is mandated.

Map updates initially propose local snapshot rebuilds; cadence, downtime, free staging/rollback space and later diff support are unresolved. Do not enable online replication by default.

## 7. Security and validation proposals

Expose only the internal entry point; provider services/databases are on private service networks. Use read-only serving roles, separate privileged import roles, secret-file injection, bounded queries and timeouts, cancellation, restricted CORS, and logs that avoid location/query/credential disclosure. Apply least privilege supported by each actual container; do not assert every upstream image already supports non-root/read-only execution. Map health needs all four required capabilities, with clear per-provider errors. The authentication module is deferred; do not replace it with insecure ad hoc authentication or a public management deployment.

Maintain [OSM attribution and license information](https://www.openstreetmap.org/copyright) and a separate inventory for software, styles, fonts and assets. Exact distribution obligations and license compatibility must be checked for selected artifacts.

Meaningful later checks: real small OSM fixtures covering profile/restriction differences; MVT layer decode; known address/POI and Persian text cases; bounded Overpass queries; import error handling; all assets requested inside the network; install/restart/update/rollback with external egress denied; measurement of full-Iran import and service workloads. Small fixtures do not prove nationwide completeness. Hardware/concurrency are unknown, so no production minimum/SLA is claimed and all unexecuted checks remain recorded.

## 8. Review blockers and next action

Resolve the geocoder interpretation, disconnected-client scope, routing objective/alternative/multipoint combinations, and proximity metric interpretation. Review non-PostgreSQL storage needs, explicit map-detail catalog, and reference environment before issuing an implementation prompt. Unknown production capacity can be measured later, but must prevent production-readiness claims.

Claude Code should critique this proposal with the updated review prompt. It must not implement until the brief and architecture are stabilized with the owner.
