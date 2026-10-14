> Historical v0.2 review prompt. The review is complete. For current development use prompts/CLAUDE_MAP_SERVICES_IMPLEMENTATION.md and the v1.0 documents. Do not execute this historical prompt against the current baseline.

# Claude Code prompt — review Seyra brief v0.2 and Map Services proposal

Use this prompt from the root of a local clone of https://github.com/pouriya-sedaghat/seyra containing the latest main documentation. Do not discard, reset, or overwrite local work to update the checkout.

---

You are the technical reviewer for Seyra. Perform a critical requirements, feasibility, and architecture review. This task is REVIEW ONLY; the brief is not finalized.

First inspect the repository status, current branch, and commit. Read any applicable repository instructions, including AGENTS.md files that actually exist. Then read, in order:

1. docs/PROJECT_BRIEF.md
2. docs/MAP_SERVICES_REQUIREMENTS.md
3. docs/MAP_SERVICES_ARCHITECTURE.md
4. prompts/CLAUDE_BRIEF_REVIEW.md

If the current checkout does not contain brief version 0.2 and its architecture document, report that mismatch and stop; do not review stale documents. Do not implement code, initialize scaffolding, install packages, pull/run containers, create branches, commit, push, or modify repository files. Do not read unrelated files, credentials, secrets, or private operational datasets. No delegation to additional agents is requested.

Confirmed constraints:

- Node.js and TypeScript application backend; PostgreSQL/PostGIS application database.
- Required Docker-deployed capabilities: vector tile server, routing engine, geocoder and Overpass. None of these map services may be disabled. Broader configurability does not override this requirement.
- Iran-wide raw OSM input is acquired by the owner and imported locally. Rendering uses vector tiles with light/dark styles and comprehensive source feature/POI coverage.
- Routing requires car, pedestrian and motorcycle profiles, time/distance preferences, alternatives and multiple destinations. Required combinations and optimality semantics remain open.
- Both web and mobile consume shared services. Assigned implementation deliverables are the backend and web test client; mobile implementation is not yet assigned.
- Operations, installation, imports and updates must not depend on Internet or outside-network access. Development/review tooling may operate outside that isolated operational environment and must not become a deployment dependency.
- Exact hardware/concurrency are unknown. No production capacity claim is allowed.
- Necessary service-specific storage outside PostgreSQL may be considered, not assumed approved.
- Authentication, Relation System and SOS require separate future requirements intake. Operators choose SOS responders manually; do not implement those workflows in Map Services.

Working interpretations requiring owner confirmation are explicitly labeled in the documents: all geocoder features and Persian/English search; three selectable proximity metrics; and removing guaranteed server-disconnected client functionality from the first phase based on the latest response. Do not turn these into confirmed requirements.

Evaluate the proposed Tegola/PostGIS import, Valhalla routing, Nominatim/Photon geocoding, private Overpass, shared Node.js gateway, and local MapLibre assets. These are candidate components, not final decisions. Cross-check the proposal's official references. If you cannot verify a statement, mark it unverified instead of guessing. Web research during this review is allowed if your environment supports it, but use primary sources and never confuse that with Internet dependence in the shipped platform.

Focus on:

- Complete source-data coverage versus an explicit import/layer/POI/style catalog; avoid impossible promises of all real-world detail.
- Required routing combinations, mathematical optimality, motorcycle behavior/restrictions, ordered versus optimized waypoints, matrix direction and objective semantics, and unsupported combinations.
- The geocoder interpretation, Persian search/text shaping and web/mobile asset compatibility; the necessity and overhead of both Nominatim and Photon.
- Every proposed non-PostgreSQL store and its necessity, scope, versions, backup/update behavior and resource implications.
- Keeping all four required map capabilities running while bounding Overpass access and preventing arbitrary end-user queries.
- External downloads hidden in image entrypoints, datasets, styles, fonts, glyphs, sprites, SDKs, import/update scripts, registries, telemetry, host prerequisites and internal HTTPS provisioning.
- Staged consistent dataset releases and honest limits of cross-service activation/rollback; no destructive import into active data.
- Private provider networks, scoped roles, input/resource limits and a viable test-access boundary before Authentication is implemented.
- What can be specified now versus what requires owner input, pinned-release verification, a real dataset, benchmark hardware, or later module intake.

Return feedback in English using:

1. Reviewed checkout: branch, commit, document versions, and any mismatch.
2. Confirmed requirements and proposal/assumption corrections.
3. Blocking questions: reference M01–M08 and Q1–Q6; group and prioritize genuinely architecture-changing decisions rather than repeating answered questions.
4. Capability matrix: requirement, candidate support, unsupported combinations, evidence URL, release/pin status, and validation needed.
5. Architecture critique: keep/change recommendation with reasons; distinguish facts from inference and unexecuted tests.
6. Security/offline/data consistency findings: affected behavior, practical impact, concrete amendment.
7. Suggested document amendments and measurable acceptance criteria.
8. Readiness verdict: ready or not ready for implementation, with exact blockers; list production-only measurement gaps separately.

Give review feedback only, then stop. The owner will return the review and resolve outstanding requirements. After stabilization, a separate English implementation prompt will name a verified base commit and a new feature branch; never start feature development on main from this review prompt.
