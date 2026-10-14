# Seyra — Project Brief

Version: 1.0
Date: 2026-10-14
Status: MAP SERVICES PHASE-1 IMPLEMENTATION BASELINE
Repository: https://github.com/pouriya-sedaghat/seyra

This baseline incorporates the owner's answers and the Claude Code review of commit 411d6add56f99166b70f9e5941aacdc3c1878770. Product scope is stabilized for phase 1. Dependency locking and provider validation are the first development tasks, not claims that validation has already passed. This document does not declare production readiness.

## Product and responsibilities

Seyra supports navigation, location monitoring, relations with privacy permissions, and operator-managed SOS. Operators will view users, manage SOS requests, and manually select/dispatch a nearby user. Relations can grant live tracking and location-history access. Authentication, Relation System and SOS require separate intake before their implementations.

Deliver now: Map Services backend/infrastructure and a web test client. Web and mobile consume shared APIs/assets. Building a mobile application is unassigned; deliver its integration contract and fixtures, without claiming unknown mobile SDKs were tested. Claude Code performs development in the connected repository environment, whether local or cloud. The earlier local-computer-only wording is superseded by the observed cloud review session.

## Hard constraints

- Node.js and TypeScript application backend; PostgreSQL/PostGIS application database.
- Iran-wide source coverage; owner acquires and supplies raw OSM input for local import. No platform download of the Iran dataset.
- Vector tiles, comprehensive source feature/POI coverage, light/dark styles.
- Required runtime capabilities: tile server, routing, geocoder, Overpass. None may be disabled through feature flags or deployment profiles.
- Operations, installation, imports and updates work without Internet or access outside the internal network. Development dependency acquisition may occur in a separate preparation environment.
- Docker images for map infrastructure. Specific vendors/images are not mandated.
- Necessary service-specific files/indexes are permitted for this engineering baseline under the full storage inventory in the architecture; this is a documented technical decision, not an owner requirement that every service use PostgreSQL.
- Security, clean code, configurable behavior and broad feature coverage. Configuration must not remove a required runtime capability.
- GitHub stores the project. All Claude Code prompts are English. Feature development occurs on a separate branch; no main-branch development or automatic merge.

## Phase-1 scope decisions

- All geocoding capabilities confirmed: free-text address/place search, reverse, autocomplete, Persian and English. Structured field-based address search and natural-language category phrases are not required for this phase; controlled category queries belong to the POI API.
- Three proximity metrics confirmed: straight-line distance, distance-oriented road route, estimated road travel time. Metric and direction are explicit; rank only the supplied candidate set, with no silent fallback.
- Clients require the internal server. No guaranteed on-device map/search/routing or queued user operations during server disconnection. The owner allowed these to be omitted. Internet independence remains mandatory.
- Car, pedestrian and motorcycle profiles; time/distance-oriented routing. Prefer predictable documented costing over unqualified global-optimality promises. There is no live traffic feed or date/time-dependent request support in phase 1; temporal restrictions must not be claimed evaluated.
- Two-point alternatives supported. Multipoint alternatives excluded under the owner's explicit complexity exception. Return a typed unsupported-combination error rather than silently ignoring them.
- Both supplied and optimized waypoint order supported. Fixed start/end, visit intermediate stops once, bounded exact order optimization against explicitly modeled pair costs; this does not guarantee globally shortest/fastest road paths. Initial optimized limit: 10 total points. See requirements for limits/semantics.
- Overpass retained, with bounded POI presets and bbox queries. No arbitrary client QL, contributor metadata, attic history or admin-area processing in phase 1.
- OSM-only import in phase 1. Future proprietary additions require intake; do not invent extra source data.

## Selected engineering design

Node.js 24 LTS, strict TypeScript and Fastify 5 gateway; Tegola plus a versioned osm2pgsql-flex/PostGIS basemap catalog; Valhalla base image with explicit offline build jobs; Photon runtime built from a temporary Nominatim database; private Overpass plus local Osmium conversion; Nginx TLS proxy; locally bundled MapLibre GL JS. Exact compatible patch versions, source commits, assets and image identities are locked by Claude in the preflight milestone.

Tegola is selected for explicit inspectable layer SQL and a modest initial serving topology. PostgreSQL/PostGIS is not a mandate to generate tiles dynamically. Martin and pre-generated archives remain valid future alternatives if measurements justify switching; a switch must be documented and checked against this baseline.

Reference development target: Ubuntu 24.04 LTS, linux/amd64, Docker Engine plus Compose v2, file-based offline transfer. This is an engineering reference, not confirmed customer hardware. Record actual tested versions; customer OS/architecture, capacity, latency and SLA are pending. Default test access is localhost; explicit LAN mode requires a CIDR allowlist and internally trusted TLS. No user-data/management/authentication features are implemented in the map test client.

## Delivery and readiness

Deliver real provider adapters, import/update/rollback tooling, local assets, shared OpenAPI/TypeScript contracts, web test client, dependency/image locks, meaningful fixtures/tests and offline packaging/runbooks. Mocks are only for unit/contract tests; serving endpoints must fail honestly if providers/data are unavailable.

Before finalizing this engineering delivery, execute the acceptance register where the environment permits and record every unavailable check. Iran data quality/coverage, full-country performance, production infrastructure, mobile SDK execution and distribution-specific licensing checks remain release validation tasks. A small fixture cannot establish Iran-wide readiness.

Normative supporting documents: MAP_SERVICES_REQUIREMENTS.md, MAP_SERVICES_ARCHITECTURE.md and MAP_SERVICES_ACCEPTANCE.md. CLAUDE_REVIEW_RESOLUTION.md records review dispositions. DEPENDENCY_BASELINE.md separates observed releases from actual locks. The current development instruction is prompts/CLAUDE_MAP_SERVICES_IMPLEMENTATION.md; the old v0.2 review prompt is historical.
