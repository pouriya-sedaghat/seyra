# Seyra — Project Brief

Version: 0.2 (requirements and architecture review draft)
Date: 2026-10-14
Repository: https://github.com/pouriya-sedaghat/seyra
Status: NOT FINALIZED — review and requirements clarification; no implementation yet.

## 1. Product and ownership

Seyra is a navigation, location monitoring, and management platform. Operators see users on a map, manage SOS requests, and manually select and dispatch a nearby user to assist a requesting user. Users establish relations and share live locations under relation-specific privacy permissions, including optional access to location history.

There are two consuming client types: web and mobile. This project's implementation responsibilities are the backend and a web client for observing and testing features. APIs and map assets must be usable by both client types. Building the mobile application itself is not currently assigned to this work; mobile platforms and SDK versions are unresolved.

## 2. Confirmed constraints

- Application backend: Node.js and TypeScript.
- Application database: PostgreSQL with PostGIS.
- Server and clients operate inside an internal network with no Internet or access outside it.
- Operations, installation, and updates must work without external-network access.
- No external runtime dependency: maps, styles, glyphs/fonts, sprites, scripts, authentication, CAPTCHA, recovery, notifications, telemetry, and supporting infrastructure must be local.
- Map Services must use Docker images; no specific image/vendor is mandated. Tegola was an example, not a selected product.
- Tile serving, routing, geocoding, and Overpass are required deployed capabilities. The user explicitly ruled out disabling individual map services. This overrides the earlier general preference for optional modules in this scope.
- Service-specific storage beyond the application PostgreSQL/PostGIS database may be considered only if necessary, documented, and reviewed.
- Security, clean code, maintainability, configurable behavior, and broad feature coverage remain priorities. Configurable behavior does not permit omitting required services.
- Use the existing GitHub repository. Claude Code on the user's computer performs brief review and development. All prompts sent to it must be English.
- Development occurs on a separate feature branch after the brief is stabilized. GitHub and Claude Code must not become operational deployment dependencies.

## 3. Map Services — first module

### Confirmed

- Coverage: Iran nationwide.
- Input: raw OSM data acquired and supplied by the user, then imported locally. The platform must not download it from public endpoints during installation, import, startup, or updates.
- Rendering: vector tiles, with light and dark styles. The map should provide comprehensive feature and POI coverage from the supplied data.
- Routing profiles: car, pedestrian, motorcycle.
- Routing capabilities: faster/time-oriented routes, shorter/distance-oriented routes, alternatives, and multiple destinations/waypoints.
- Required delivered/deployed services: tile server, routing engine, geocoder, Overpass.
- Clients: web and mobile use shared backend contracts and map assets.
- No specific Docker image is required. Hardware and capacity targets are not yet known.

### Working interpretations requiring confirmation

- Geocoding: the answer repeated the list without explicitly selecting items. Treat forward address/place search, reverse geocoding, autocomplete, and Persian/English search as a working interpretation, not a finalized requirement.
- Proximity: the answer repeated all three metrics. Propose explicit selectable metrics: straight-line distance, road-route distance, estimated travel time. No default metric or implicit fallback is selected.
- Disconnected clients: the latest answer says this probably is not needed, changing the earlier affirmative answer. Propose no guaranteed local map/search/routing capability during server disconnection in the first phase, while preserving fully Internet-independent operation inside the internal network. Await confirmation.
- Overpass: its application use cases are delegated for study. Propose controlled POI queries through the backend rather than unrestricted end-user query execution. The contractual requirement to deploy Overpass remains in place.

### Decisions still open

- Measurable meaning of comprehensive detail, layer/POI catalog, zoom range, and Persian label requirements.
- Whether alternatives must also work on routes containing more than two points.
- Whether multi-destination routing means ordered waypoints, optimized visit order, or both.
- Whether shorter/faster means a useful distance/time-oriented result or a strict mathematical optimality guarantee, and which performance tradeoffs are acceptable.
- Update cadence, allowed downtime, offline package transfer, target OS/CPU, capacity, and mobile platforms.
- Exact image versions, provenance, licenses, digests, and service-specific storage acceptance.

See docs/MAP_SERVICES_REQUIREMENTS.md for the decision register and docs/MAP_SERVICES_ARCHITECTURE.md for the research-backed proposal. The proposal is not finalized.

## 4. Later modules — separate intake required

### Authentication

Confirmed: sign-in, sign-up, password recovery, and locally generated text CAPTCHA. User provisioning, credentials, roles, sessions, recovery channels, additional workflows, and abuse controls require intake before implementation.

### Relation System

Confirmed: user relations govern live-location visibility and may grant history access. Directionality, consent, invitation/acceptance, revocation, permission granularity, operator access, retention, and disconnected behavior remain unresolved.

### SOS

Confirmed: operators manage requests and manually select/dispatch nearby users. Automatic dispatch is not required. Eligibility, delivery, acknowledgement, escalation, cancellation, lifecycle, and audit requirements remain unresolved. Map-distance capabilities must not implement the SOS workflow prematurely.

## 5. Acceptance categories

- Demonstrate installation, startup, restart, imports, agreed operations, updates, and rollback with outside-network access denied and only the supplied local bundle available. Record untested cases honestly.
- Validate all asset references and auxiliary datasets for hidden external fetches. Internally served assets must work for web and the agreed mobile SDKs.
- Define comprehensive map coverage using the input dataset, an explicit layer/tag catalog, and fixtures for urban, rural, border, and intercity cases. Data absent from OSM cannot be promised.
- Required service failures must be visible; expose health/readiness and typed errors without pretending complete functionality.
- Define routing support combinations, proximity direction/metric, unreachable cases, accuracy meaning, and no silent straight-line substitution for a road/time request.
- Define geocoding quality fixtures, languages and normalization, units, coordinates, bounded responses, and no-results behavior.
- Protect map infrastructure with private service networks, scoped credentials, validated input, and resource limits. General network presence and CORS are not authorization.
- Do not implement placeholder authentication or publish an unauthenticated management application while Authentication requirements are still pending. The initial test client has controlled local/internal access; detailed policy needs agreement.
- Keep location freshness visible. If queueing is later required, an SOS/dispatch is not delivered until acknowledged.
- Supply reproducible artifacts, configuration, data-import and rollback procedures, license/attribution inventory, backup/restore, observability, and appropriate tests.
- Production capacity and full-Iran performance claims require measurement on specified hardware. No numbers have been agreed.
- Keep secrets and private operational data out of source control.

## 6. Required workflow

1. Collect requirements before each module.
2. Study candidate implementations using official sources; distinguish verified capabilities, inference, and untested assumptions.
3. Record proposed architecture, limitations, questions, and acceptance criteria.
4. Claude Code reads the brief and provides critical feedback using an English review prompt.
5. Resolve feedback and stabilize requirements/architecture with the user.
6. Prepare a separate English implementation prompt tied to a finalized brief and a verified base commit.
7. Claude Code develops on a separate feature branch, preserving unrelated work.
8. Review and execute agreed checks; prepare changes for review without merging by default.

Current stage: documented research proposal and Claude Code review. The user has connected Claude Code to Seyra on main. prompts/CLAUDE_BRIEF_REVIEW.md is review-only. No application code, final implementation prompt, or development branch has been created in this collaboration.
