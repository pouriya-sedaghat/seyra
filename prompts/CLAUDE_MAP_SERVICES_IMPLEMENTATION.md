# Claude Code — implement Seyra Map Services phase 1

Task status: IMPLEMENTATION, after completed v0.2 review and owner clarification.
Expected repository: https://github.com/pouriya-sedaghat/seyra
Target development branch: feat/map-services-v1
Required document version: 1.0
The owner supplies the exact expected documentation-base SHA in the launch message. Do not infer it from a stale checkout.

## 1. Establish the checkout safely

Inspect status, branch and commit. Read applicable repository instructions including CLAUDE.md and any AGENTS.md that actually exist. Preserve all local/unrelated work. Verify that the supplied documentation-base commit exists and that the target remote branch contains it. Never reset, force checkout, force push, overwrite another session's branch, or start feature code on main.

Use feat/map-services-v1 for development. If your connected environment mandates a claude/* session branch, create an isolated worktree/check-out of the target branch when supported. If that is unavailable, use a fresh separate session feature branch based on the supplied commit, report its exact name, and target a draft PR to main; do not force-update the expected branch or modify main. Never discard work just to change branch.

Read docs/PROJECT_BRIEF.md, docs/MAP_SERVICES_REQUIREMENTS.md, docs/MAP_SERVICES_ARCHITECTURE.md, docs/MAP_SERVICES_ACCEPTANCE.md, docs/CLAUDE_REVIEW_RESOLUTION.md and docs/DEPENDENCY_BASELINE.md. The old prompts/CLAUDE_BRIEF_REVIEW.md is historical; do not repeat that review task. If version/base content is missing, report the mismatch before dependent work.

Product scope is stabilized. Give a concise execution plan, then proceed autonomously through the authorized engineering work; do not ask again about already resolved requirements or stop after scaffolding. Report actual capability blockers rather than silently changing required functionality.

## 2. Scope and boundaries

Implement the backend/infrastructure and usable web test client for all four mandatory map capabilities. Node.js/TypeScript, PostgreSQL/PostGIS, Docker images, owner-supplied Iran OSM, MVT light/dark, web/mobile integration contracts, fa/en free-text/reverse/autocomplete, all three explicit proximity metrics, three routing profiles, both objectives and waypoint-order modes.

Required map services are always deployed. No runtime disable flags/opt-in profiles. No Internet/outside-network dependency in operation/install/import/start/update. Preparation may acquire software/images outside the operational network. No download of the owner's Iran map file; accept a local file. Use clearly synthetic fixtures until the real file is supplied.

Do not implement Authentication/signup/recovery/CAPTCHA, Relation, private tracking, SOS or a mobile application now. No server-disconnected local routing/search/map packs, date_time/live traffic, multipoint alternatives, arbitrary Overpass QL or automatic dispatch. No public/customer deployment or automatic merge.

## 3. Milestone A — real preflight and locks

Record actual host/CPU/runtime/Docker/Compose availability. Reference linux/amd64 Ubuntu 24.04; a cloud environment difference must be explicit. Resolve exact compatible stable sources/packages/platform images from DEPENDENCY_BASELINE.md. Inspect the selected CLI/config versions, base/entrypoint behavior and licences. Write infra/dependencies.lock.json with real versions/commits/integrity, image origins/IDs/digests and archive checksums; no invented pins or latest tags.

Use Valhalla base plus explicit build/run commands; inspect timezone/speed/admin inputs and package any necessary data locally. Tegola uses the documented versioned catalog/SQL. Nominatim is build-time only → local export → Photon. Check actual Photon release flags, export compatibility, normalization and safe secret support; do not copy later master-only options. Overpass gets a pinned image/build and local Osmium XML conversion. Lock fonts/local asset tools, Nginx, Node 24/Fastify 5 and a native-RTL MapLibre release.

If access to registries/packages/Docker or source compatibility is genuinely blocked, report the concrete constraint, keep incomplete artifacts explicitly labeled, and continue independent contracts/code/tests where meaningful. Do not claim binaries/images/provider checks are verified merely from web docs. An unresolved required capability is not a reason to replace it with production mocks.

## 4. Milestone B — application and provider contracts

Create a maintainable npm-workspace TypeScript project: apps/api, apps/web, packages/contracts. Strict types, Fastify schema validation, parameterized pg queries, migrations for map/control metadata only, typed errors and OpenAPI. Add real provider adapters, deadlines/cancellation, bounded concurrency/queues and log redaction. Private provider URLs are configuration, never client input.

Implement capabilities, search, reverse, autocomplete, route, proximity and bounded POI endpoints. Binary tiles/TileJSON/styles/assets go through fixed Nginx proxy/static paths. Explicit units/WGS84/languages/dataset_id, real health probes and fail-closed readiness for all required providers/revision mismatch. Safe text rendering of OSM content. No hardcoded green readiness or fake empty success on a missing provider.

Routing: support every required table cell. Up to 25 ordered points; fixed endpoints; up to 2 additional routes only for ordered two-point requests. Typed rejection for multipoint/optimized alternatives/date_time. Keep route_optimality not guaranteed and static ETA semantics. Profile fixtures must check motorcycle=no and access/one-way differences.

Optimized order: up to 10 total points, fixed start/end, unique IDs with duplicate-coordinate handling. Build directed pair costs from selected-objective two-point routes and solve Held–Karp deterministically. Exactness only for the finite additive table, never global road optimality. Retain original indices, visit every stop once, distinguish provider failure from missing paths, and return modeled versus final-route totals. Do not assume native optimized-route or matrix shortest support for the entire profile/objective contract.

Proximity: at most 50 supplied candidates by default; require metric/direction and road profile. Geography distance for straight_line, distance-oriented route length for road_distance, static time-oriented duration for travel_time. Rank the supplied set only; no hidden shortlist, eligibility rules, SOS direction default or silent fallback. Normalize fa/en search consistently without rewriting display names; real quality evidence is required.

## 5. Milestone C — data, deployment and offline lifecycle

Versioned osm2pgsql flex rendering import/catalog/indexes and Tegola SQL; complete local styles, fonts/glyphs/sprites with light/dark and fa/en label fallback. Implement real local builds of Valhalla, temporary Nominatim→Photon, and Overpass XML data, all into separate staging stores. Inspect and disable every operational remote fetch. Preserve original input and unrelated paths.

Deliver schema-validated release manifests containing source/pipeline/catalog/component/asset identities. Dataset ID reflects derived version, not only the PBF. All four runtime providers run unconditionally; serving must not initiate imports. Allow required provider scratch/index writes without permitting active-data rebuilds.

Implement CLI-based staging validation, maintenance cutover with drained work, provider revision readiness gate, failed-activation recovery and complete rollback. Active plus one prior compatible release; measured staging/temporary space, no destructive in-place import and no unsupported atomicity claim. Provider update/admin endpoints are private and not proxied to clients.

Separate preparation/build compose from operation compose: operational images are preloaded, pull_policy=never, no build or dependency install. Offline archive export/load identity verification, checksum validation and documentation for host prerequisites, secrets/internal TLS, install/import/start/update/rollback/backup/restore. Default localhost:8443; explicit CIDR allowlist for LAN testing, blank fails closed. No global host firewall or production-network changes to test egress.

## 6. Milestone D — usable web test client

Build a Persian-friendly responsive test interface with the real local map, light/dark toggle, fa/en names/search, forward/reverse/autocomplete, route profile/objective, alternative display, ordered/optimized stops, proximity metric/direction and bounded POI presets. Show dataset/provider health, limits, real typed errors and server connection loss. User-entered or labeled fixture points only. Keep implementation internals in a diagnostics view when useful, not scattered into ordinary user flows. No cloud assets/fonts/scripts or RTL plugin.

Document mobile base URLs/TLS trust, schemas, coordinates/units/errors and asset/style compatibility fixtures. Do not claim an unassigned native SDK was run.

## 7. Milestone E — meaningful validation and handoff

Execute MAP_SERVICES_ACCEPTANCE.md with actual evidence. Include real-provider synthetic OSM fixtures: MVT decode/catalog checks, bilingual/Persian rendering and geocoder tests, routing restrictions/unsupported combinations, asymmetric/unreachable proximity, independent brute-force order verification, bounded Overpass rejection, service revision failures, interrupted imports, rollback and offline image-load checks. Unit mocks are allowed only to isolate adapter/error tests; they do not substitute for integration evidence.

Do not weaken tests to match a bug. No meaningless coverage quota. Avoid repeated broad testing after checks pass unless changes/failures justify it. If the environment cannot run a required check, record BLOCKED/NOT RUN, precise prerequisites and command; do not mark the feature delivery accepted. Real Iran dataset benchmarks/mobile/customer infrastructure stay pending, with reproducible runbooks.

Maintain docs/IMPLEMENTATION_STATUS.md and docs/TEST_RESULTS.md with scope completed, actual locks, provider checks, pending blockers and reproduction commands. Commit coherent changes only on the feature branch; push it if authorized repository tooling is available, never force push. Prepare a draft PR to main when available; if PR tooling is unavailable, provide a ready title/body and exact branch/commit. Never merge.

Return: actual branch and commits/PR, implementation outcomes, commands/checks with PASS/FAIL/NOT RUN/BLOCKED, unverified pins/capabilities and remaining Iran/mobile/production validation. Do not say the platform is ready for production from fixture-only evidence. Do not finish with only a plan while authorized implementable work remains.
