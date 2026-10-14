# Seyra — Map Services Architecture

Version: 1.0
Date: 2026-10-14
Status: PHASE-1 ENGINEERING BASELINE; implementation and validation pending.

## 1. Components and selection

| Component | Selected role | Decision rationale / condition |
| --- | --- | --- |
| Nginx | Single local TLS entry point; proxy binary tiles/assets; /api to application | Explicit ingress and access boundary; no cloud certificates/ACME |
| Node 24 LTS, TypeScript, Fastify 5 | Shared versioned API, provider adapters, validation, bounded execution | Required application stack, modular implementation; exact patches locked in preflight |
| PostgreSQL/PostGIS | Separate application/control and rendering DBs/roles; geography distance | Application constraint does not force a live-tile model |
| osm2pgsql flex + Tegola | Versioned OSM rendering schema and MVT layer SQL | Selected explicit SQL/tag catalog and small initial topology; Martin/archives are valid alternatives, not ruled out by PostgreSQL |
| Valhalla base image | Explicit local graph build; dedicated serving command | Avoid scripted defaults/rebuild-on-start; provider behavior must be tested |
| Nominatim + Photon | Nominatim is a temporary build DB; export to Photon runtime index | Removes an unnecessary always-running address DB; free-text/reverse/autocomplete scope, not structured category phrases |
| Overpass + Osmium | Local PBF→XML import and private bounded POI service | Mandatory Overpass capability; no remote cloning/replication |
| MapLibre GL JS | Locally bundled web map, light/dark, Persian/English | Use an exact verified release with native RTL support; no RTL plugin or CDN |
| Local tools/assets | Font/glyph/sprite generation, TLS helpers, packaged host prerequisites | Every operational dependency inventoried; no public DNS/NTP/asset fetch |

Use npm workspaces for apps/api, apps/web and packages/contracts. Web uses TypeScript with a small Vite/React interface; exact compatible releases pinned, no server-rendering/cloud framework requirement. Use node-postgres with parameterized SQL and versioned migrations. Runtime rendering roles are read-only; import jobs use scoped write roles. Future user tables/Authentication/Relation/SOS are not created now.

Reference environment: Ubuntu 24.04 LTS linux/amd64, Docker Engine and Compose v2; actual supported versions recorded by preflight. Separate preparation, transfer and operational zones. Dependency/image acquisition can use Internet in preparation, but the operational bundle, imports, startup and updates cannot. File archives are the initial transfer mechanism; internal registries are not required.

## 2. Contracts and ingress

Versioned APIs: /api/v1/map/capabilities, /api/v1/map/search, /reverse, /autocomplete, /route, /proximity and /pois. Deliver OpenAPI schemas and shared TypeScript types; all coordinates/units/errors explicit. GeoJSON is WGS84 longitude/latitude arrays; latitude/longitude objects have named fields. JSON geometry limits and typed errors prevent unbounded responses.

Versioned /maps/<dataset_id>/ paths serve TileJSON, MVT, light/dark style JSON, fonts/glyphs and sprites. Proxy performs fixed allowlisted routing, never accepts a client-provided provider URL. Expensive API requests have deadlines, cancellation, per-provider concurrency and bounded queues. No arbitrary provider actions, raw QL, SQL or URLs. Body/query size limits, safe text display, security headers and log redaction are required.

Metadata includes dataset_id, profile, objective and capability limits. Private providers do not need invented upstream dataset APIs: provision their revision markers and wrap real health probes. /health/live is process liveness; /health/ready fails if any of the four required map providers or their revision markers disagree. Healthy operations may still return per-provider responses during an outage, but platform readiness never pretends completeness. Reject unknown/mixed dataset requests. Mobile integration docs cover internal base URLs, TLS trust, coordinates, style/asset versions and test fixtures; mobile execution is pending its SDK owner.

Default access: loopback TLS proxy. Explicit LAN test mode requires an allowlist plus trusted internal certificates. Providers and DBs have no client-subnet host ports. Internal networking is not user authentication; no sensitive tracking/management data is exposed. No ACME, public telemetry, external NTP/DNS or unrequested network deployment. Document customer provisioning of internal CA/time/DNS; do not build an unsolicited PKI/NTP platform.

## 3. Routing and ordering

Use Valhalla for two-point and ordered routes with documented profile/objective adapters. Multipoint alternatives and date_time are explicitly unsupported. Never advertise global shortest/fastest road guarantees or reuse unverified matrix shortest semantics. Required support/limits are defined in the requirements document.

Implement bounded fixed-endpoint Held–Karp ordering in the application over independently routed directed pair costs, covering all three profiles and both objectives uniformly. This avoids pretending the native optimized endpoint supports all required combinations. Exactness is limited to the finite additive pair-cost table. Keep actual returned multi-stop route totals separate; stopping/snapping/turn-state choices can affect them. At most 10 points, deterministic tie breaking, explicit unreachable/provider-error distinction, full visit permutation and cancellation. Test against independent brute-force permutations on small directed fixtures. No road-optimality exact flag.

Proximity is stateless ranking of a supplied set. Direction is an explicit parameter, not a baked-in SOS rule. Straight-line geography distance is separate from direction-sensitive road route/time values. No automatic dispatcher, user eligibility, location retention or spatial shortlist approximation.

## 4. Imports, stores and assets

Input: validated local Iran .osm.pbf, checksum and snapshot metadata. Owner data is never downloaded, overwritten or deleted by development tooling. For tests, create a distinctly labeled synthetic small OSM fixture; do not present fictional fixture objects as real Iranian roads/addresses.

Every build writes a new staging release. Rendering import preserves source identities/tags and uses catalog v1, indexes and zoom generalization. Valhalla runs explicit build commands; serving never watches PBFs or runs its build entrypoint. Package local speed/admin inputs and any timezone/elevation data actually required by the pinned build; rejecting date_time does not by itself prove every auxiliary file is unnecessary. No remote timezone/speed/wikipedia/phrase fetch. Optional unneeded elevation/traffic/transit data is omitted.

Nominatim uses locally provisioned software and a temporary dedicated DB; evaluate --reverse-only and --no-updates for snapshot export against the pinned Photon compatibility. Export local JSON; apply reproducible Persian normalization while retaining original display names; import into a fresh Photon directory with fa/en explicitly selected. Normalization changes require a new index. Do not assume a master-only pgpass feature exists in the chosen release. Secret credentials must not be logged or passed visibly on command lines. No Nominatim runtime server or Photon update endpoint in v1.

Overpass consumes a locally converted XML stream in a new data directory; no public clone URL, periodic fetcher, attic/contributor import or area dispatcher in v1. Bbox POI presets suffice. Serving data is immutable to import tooling, but provider scratch/lock/OpenSearch working state may need writes: mount only necessary local writable paths. Do not force read-only filesystem flags that break an actual provider, and do not describe Photon/Overpass mounts as wholly read-only without testing.

### Full storage inventory

| Store/artifact | Owner | Rebuildable? | Retention / recovery |
| --- | --- | --- | --- |
| Original PBF + source manifest | Operator | Only from supplied source | Preserve owner original; managed copies checksummed |
| Rendering DB + catalog/indexes | Import pipeline | Yes from source + pipeline | Active + one prior compatible release; DB export/runbook |
| Application/control DB | Seyra API | Control metadata only now; future user data differs | Real backup/restore, never treat as disposable map data |
| Temporary Nominatim DB / flatnodes | Build job | Yes | Scoped job workspace; clean only owned temporary output after verified export |
| Photon export JSON + index | Geocoder build | Yes | Active + prior compatible index; versioned JSON as needed for rebuild |
| Valhalla graph / tar / admin SQLite / required timezone or speed assets | Routing build | Yes with complete inputs | Active + prior; checked local auxiliary sources |
| Overpass base data / dispatcher scratch | OSM feature build/service | Base yes; scratch transient | Active + prior base; runtime write/lock requirements documented |
| Tegola file cache | Tile service | Yes | Dataset-versioned, bounded; no cloud cache; discard only managed cache |
| Styles / fonts / glyphs / sprites / web bundle | Asset build | Yes if sources/licenses retained | Versioned immutable assets; source/licence/checksum inventory |
| Docker image archives / OCI metadata | Preparation pipeline | Yes with locked dependencies | Checksummed offline bundle; verify loaded image identity/platform |
| TLS/CA public material, server keys and local trust config | Operator | Keys are not map rebuild outputs | Keys outside Git/bundle defaults, restricted permissions and recovery procedure |
| Release manifests, locks, test evidence | Release tooling | Preserve audit trail | Versioned, checksummed; no private keys or user datasets in Git |
| Overpass area data / pre-generated tile archives | Not selected in v1 | N/A | Any later addition updates this inventory and architecture |

Retain active plus one previous compatible release, with separate staging space. This is not a claim that exactly twice the input size suffices. Measure every store and temporary peak; refuse an import on missing prerequisites/space according to configurable checks. Never delete unrelated paths, original inputs or application data.

## 5. Activation and offline packaging

Manifest schema: dataset_id, source_sha256, source snapshot timestamp/provenance, catalog/pipeline versions, component source releases/commits, image platform/identity, asset/artifact checksums and validation result paths. Unknown snapshot timestamp is explicit, not synthesized from import time. dataset_id identifies the source plus derived pipeline/catalog/assets version; do not key releases on PBF checksum alone.

Chosen initial cutover: documented maintenance window. CLI verifies all staged checks, enters maintenance, drains/cancels admitted work, stops serving providers, changes the complete release configuration, starts/probes all providers and enables traffic only after same-revision readiness. Mixed/stale /maps URLs fail explicitly instead of being served from a new dataset. Retain the previous complete configuration for rollback. No cross-provider atomicity claim; test restart failure and reversal. A failed build leaves active data unchanged. Future blue/green is not required while RAM is unknown.

Package prebuilt application and all provider/tool images, local SDK/assets/fonts, host prerequisites for the reference OS if needed, manifests, checksums, licence inventory, install/import/update/rollback/backup tools and runbooks. Runtime Compose has no build sections, uses pull_policy: never and all four providers unconditionally. Separate build-job definitions do not make runtime providers optional. A missing image/artifact fails before operation; no npm/apt/pip/wget fallback. Validate Docker save/load identity resolution rather than inventing RepoDigests: registry digests where verifiable; custom image IDs and immutable local tags plus archive SHA-256 where appropriate.

## 6. Evidence and verification boundaries

Official sources reviewed 2026-10-14; moving manuals are capability evidence, not image locks:

- [Tegola](https://tegola.io/documentation/configuration/): PostGIS/MVT provider configuration; schema/style is a separate deliverable.
- [osm2pgsql](https://osm2pgsql.org/doc/manual.html): flex table/tag mapping and incomplete-extract handling.
- [Valhalla route API](https://valhalla.github.io/valhalla/api/route/api-reference/): costing, waypoints and alternate constraints. Motorcycle is beta; exact-road claims are not adopted.
- [Valhalla optimized API](https://valhalla.github.io/valhalla/api/optimized/): documented profiles differ from our full profile/objective contract, so it is not our sole order solver.
- [Valhalla Docker](https://github.com/valhalla/valhalla/blob/master/docker/README.md): base versus scripted deployment and default timezone/speed inputs; audit exact scripts at the locked commit.
- [Nominatim import](https://nominatim.org/release-docs/latest/admin/Import/) and [local phrases](https://nominatim.org/release-docs/latest/customize/Special-Phrases/): local export setup and auxiliary-download pitfalls.
- [Photon usage](https://github.com/komoot/photon/blob/master/docs/usage.md): Nominatim export/import, private search storage and destructive same-directory import; [README](https://github.com/komoot/photon) identifies the Java requirement.
- [MapLibre 6.9.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.9.0): native Arabic/Hebrew shaping; [style spec](https://maplibre.org/maplibre-style-spec/root/): resources and SDK-specific support. Persian fixtures remain necessary.
- [Overpass setup](https://dev.overpass-api.de/overpass-doc/en/more_info/setup.html), [Osmium](https://osmcode.org/osmium-tool/manual.html), [PostGIS distance](https://postgis.net/docs/ST_Distance.html).
- [Docker Compose](https://docs.docker.com/reference/compose-file/services/), [Ubuntu install](https://docs.docker.com/engine/install/ubuntu/), [Node releases](https://nodejs.org/en/about/previous-releases), [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/).

No real Iran import, binary image audit, benchmark or mobile run has been completed here. Tagged/raw source retrieval was blocked for several requests; Claude's release observations are labeled separately in DEPENDENCY_BASELINE.md. Register exact validation evidence during development and retain failed/unexecuted checks honestly.
