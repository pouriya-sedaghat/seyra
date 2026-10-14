# Seyra — Project Brief

Version: 0.1 (requirements draft)
Date: 2026-10-14
Repository: https://github.com/pouriya-sedaghat/seyra
Status: NOT FINALIZED — requirements intake and Claude Code review only.

## 1. Product and responsibilities

Seyra is a navigation, location monitoring, and management platform. The work covers the backend, a web client for observing and exercising backend features, requirements analysis, technical research, and architecture design.

Operators must be able to see users on a map, manage their SOS requests, and manually select and dispatch a nearby user to assist the requesting user. Users can establish relations with other users and track their locations according to relation-specific privacy permissions. Access to location history is one example of a permission that a relation may grant.

This draft records confirmed requirements and explicitly unresolved decisions. It is not authorization to choose a final architecture or implement a module.

## 2. Confirmed platform constraints

- Application backend: Node.js and TypeScript.
- Application database: PostgreSQL with PostGIS.
- The operational environment has no Internet or access outside the internal network. Server and clients communicate inside that network.
- The web client must retain useful functionality when disconnected from the server. The exact offline feature set and provisioned data extent are unresolved; do not equate cached assets with full offline functionality.
- Installation and updates must also be possible without Internet access.
- No operational dependency may require external services: this includes map resources, authentication, password recovery, CAPTCHA, notifications, assets, telemetry, and supporting infrastructure.
- Map services must run from Docker images. The user cited Tegola as an example, not as a selected implementation.
- Security, clean code, maintainability, configurable features, and broad feature coverage are priorities.
- Features/modules should be independently configurable where feasible. The exact toggle boundaries and dependencies must be defined rather than assumed.
- Use the existing GitHub repository for project work.
- Development and brief review must be performed using Claude Code, with English prompts. Claude Code runs on the user's computer.
- GitHub and Claude Code belong to the development workflow; they must not become product runtime, installation, or update dependencies inside the isolated operational network.

## 3. Module scope

### 3.1 Map Services — first module

The contractual capabilities are:

1. Tile server.
2. Routing engine (the user's wording was "route machine").
3. Geocoder.
4. Overpass service.

All four capabilities must be supported by the delivered map-services scope. No implementation product, image version, deployment topology, client map library, or import pipeline has been selected. How optional deployment relates to these contractual capabilities must be clarified.

Detailed intake questions are in `docs/MAP_SERVICES_REQUIREMENTS.md`. Research and architecture selection follow the answers.

### 3.2 Authentication — later intake

Confirmed capabilities include sign-in, sign-up, password recovery, and a locally generated text CAPTCHA. Additional authentication workflows, user provisioning rules, roles, credentials, recovery channels, session policy, and abuse controls require separate intake before this module starts.

### 3.3 Relation System — later intake

Users can create relations that allow live location tracking subject to specific privacy permissions. Location-history access can be granted through a relation.

Relation directionality, consent, invitation/acceptance, revocation, permission granularity, operator access, retention, and offline behavior remain unresolved.

### 3.4 SOS — later intake

Operators manage users' SOS requests and manually choose a nearby user to dispatch. Automatic dispatch is not a confirmed requirement.

The meaning of "nearest", eligibility, dispatch delivery, acknowledgement, incident lifecycle, escalation, cancellation, disconnected-client behavior, and audit requirements remain unresolved.

## 4. Architecture decision status

No final architecture has been selected. The following must be established from requirements and evidence:

- Geographic coverage, map data availability and licensing, map rendering format, and update strategy.
- Routing profiles, restrictions, alternatives, route-distance/time calculations, and service coverage.
- Forward/reverse geocoding, languages, autocomplete, and search quality targets.
- The required Overpass API/query surface and access boundaries.
- Server versus client responsibilities during network loss.
- Hardware, operating system, CPU architecture, storage, concurrency, and measurable performance targets.
- Docker image acquisition, pinned versions/digests, offline transport, installation, updates, and rollback.
- Service-specific storage requirements and their compatibility with the confirmed PostgreSQL/PostGIS application database constraint.
- Security boundaries, authorization, location privacy, resource limits, logs, backup/recovery, and module dependencies.

Any candidate technology is a proposal until reviewed against the completed requirements. Do not silently turn a proposal or an unknown into a confirmed requirement.

## 5. Acceptance expectations to make measurable

These are platform-level acceptance categories, not finalized module specifications:

- Validate installation, restart, supported operation, updates, and rollback in the agreed network-isolated environment using a locally supplied artifact bundle.
- Verify that product behavior does not rely on Internet access or hidden external fetches, including frontend assets and map styles/resources.
- Define and exercise the selected client behavior when its server connection is lost and restored. Show last-known data and its freshness; do not label cached locations as live.
- Do not show a queued SOS or dispatch as delivered until the server has acknowledged the relevant operation. Detailed synchronization and conflict rules will be agreed during module intake.
- Enforce privacy and authorization at the backend; a frontend-only control is insufficient. Clarify cache behavior after permission revocation and the limits of revocation while a device is disconnected.
- Supply documented configuration, reproducible builds, deployment and data-import procedures, health checks, backup/restore instructions, and meaningful tests appropriate to the agreed scope.
- Define enabled/disabled behavior and dependencies for optional capabilities. Mandatory delivered capabilities must not silently disappear because a configuration option is off.
- Keep credentials and private operational location/user data out of source control.

## 6. Required development workflow

For each module:

1. Collect the user's requirements before starting that module.
2. Review them and research candidate implementations against official documentation and licensing.
3. Record the proposed architecture, tradeoffs, unresolved questions, and acceptance criteria in this brief and supporting documents.
4. Ask Claude Code to read the brief and give critical feedback using an English review prompt.
5. Resolve feedback and stabilize the brief with the user. User clarification is required for unresolved product requirements.
6. Prepare an English implementation prompt tied to the finalized brief and a verified base commit.
7. Ask Claude Code to develop on a separate feature branch, preserving unrelated work and existing repository instructions.
8. Review code and perform the agreed functional, security, and offline checks. Prepare changes for review; do not merge by default.

Current stage: steps 1 and 4 for the draft only. `prompts/CLAUDE_BRIEF_REVIEW.md` is a review prompt, not an implementation prompt. A final implementation prompt and feature branch will be prepared after requirements and architecture are stabilized.

## 7. Ownership and handoff

- Requirements, technical analysis, architecture proposal, prompt preparation, and review: this collaboration with the user.
- Brief review and implementation execution: Claude Code on the user's computer.
- Pending external input: Map Services intake answers and actual Claude Code review output.
- No Claude Code review or implementation has been executed from this environment.
