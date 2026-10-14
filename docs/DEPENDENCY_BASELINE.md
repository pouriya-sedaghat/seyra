# Seyra — Dependency Baseline and Locking Procedure

Version: 1.0
Verified-at date: 2026-10-14
Status: RELEASE OBSERVATIONS ONLY — binary/platform/image locks NOT YET EXECUTED.

A web release/manual observation is not a tested source pin or container digest. Do not present this table as a completed lockfile. Claude must fill a separate machine-readable infra/dependencies.lock.json during implementation, using real fetched/built artifact identities and the actual reference environment.

| Component | Baseline target / observation | Evidence state | Preflight action |
| --- | --- | --- | --- |
| Node | Supported 24 LTS line | Official release page observed | Exact patch/runtime/base image + integrity; compatible with selected Fastify/toolchain |
| Fastify | Stable 5 line | Official LTS docs observed | Exact patch and plugin/TypeScript compatibility; lock npm integrity |
| TypeScript/Vite/React/pg/test tools | Compatible stable releases | Not selected at patch level | Pin exact versions and transitive lock; no floating operational install |
| MapLibre GL JS | 6.14.0 candidate; native RTL established in 6.9.0 release notes | Both official release pages independently retrieved | Exact npm integrity, bundled worker/font/text fixtures; no RTL plugin |
| Valhalla | 3.9.1 candidate | Official release list independently retrieved; tag-specific file retrieval blocked | Resolve exact commit/platform base image or pinned custom build; inspect CLI/config/aux inputs; run profile fixtures |
| Tegola | 0.21.2 candidate | Owner's Claude review observed; direct release retrieval blocked here | Verify real upstream tag/commit; source-built noViewer option if used; exact image identity |
| Nominatim | Stable 5.3 line candidate | Current manual says 5.3.2; reviewer CHANGELOG said 5.3.0, not equivalent release evidence | Verify tag, source, PostgreSQL/osm2pgsql/Photon export compatibility |
| Photon | 1.3.0 candidate | Official latest-release page independently retrieved; usage master has later-only features | Verify exact release CLI/export schema, Java runtime, supported normalization and secret handling |
| Photon Java/search backend | Compatible Java 21+ runtime and embedded search backend | Current README/usage observed | Lock actual runtime and embedded dependency versions; no separately exposed search cluster |
| PostgreSQL/PostGIS | Compatible supported stable versions | Application technology required, patches not locked | Verify all provider/import dependencies; separate roles; lock platform images |
| Overpass/Osmium/osm2pgsql | Verified stable source builds/releases | Capability manuals observed; source pins not selected | Exact commits/binaries/tool images; XML pipeline and licences |
| Nginx/fonts/glyph/sprite tools | Supported stable software and properly licensed fa/en assets | Specific binaries/fonts not locked | Lock sources/licences/checksums; run exact asset/TLS tests |
| Ubuntu/Docker/Compose | Reference Ubuntu 24.04 linux/amd64, Engine + Compose v2 | Official install/Compose docs observed | Record tested host/tool versions and offline prerequisites; test pull_policy=never after image load |

## Lock schema requirements

For each component: role, version, source URL/revision (full commit if applicable), verified_at, platform, builder/base identities, licence/SPDX where verified, dependency/package integrity, image origin (upstream/community/custom), immutable reference and digest/image_id, offline archive filename+SHA-256, relevant CLI/config capability tests and validation status. Keep credentials/keys outside this file.

For exported images, actually test that the configured reference resolves after docker load. If a registry RepoDigest is not retained, do not invent one: use a verified content-addressed image ID, a unique local immutable tag and checksummed archive, with load-time ID verification. Custom images still require pinned bases/sources and reproducible inputs. Unknown identities fail offline packaging; developer templates may be explicit incomplete templates, never release-ready manifests.

Internet dependency acquisition is allowed only in preparation. Operational compose has no builds/download commands and fails if required loaded images/local files are absent. Include all host dependencies if the reference host is not already provisioned. Distribution obligations are inventoried for selected source/asset licences; report unresolved ones without inventing legal conclusions.

## Primary references

- https://nodejs.org/en/about/previous-releases
- https://fastify.dev/docs/latest/Reference/LTS/
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.14.0
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.9.0
- https://github.com/valhalla/valhalla/releases
- https://github.com/komoot/photon/releases/tag/1.3.0
- https://github.com/komoot/photon/blob/master/docs/usage.md
- https://nominatim.org/release-docs/latest/admin/Import/
- https://docs.docker.com/engine/install/ubuntu/
- https://docs.docker.com/reference/compose-file/services/
