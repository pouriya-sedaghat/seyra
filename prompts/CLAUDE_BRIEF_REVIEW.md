# Claude Code prompt — review the Seyra brief

Run this prompt in Claude Code from the root of a local clone of `https://github.com/pouriya-sedaghat/seyra` containing the current documentation commit. Do not reset, discard, or overwrite local changes to obtain it.

---

You are the technical reviewer for Seyra, a platform for navigation, location monitoring, relation-based location sharing, and operator-managed SOS dispatch.

This task is REQUIREMENTS AND BRIEF REVIEW ONLY. The brief is not finalized. Do not implement application code, initialize a project scaffold, select a final architecture, install packages, pull Docker images, commit changes, create branches, or modify repository files.

First inspect the repository status and read applicable repository instructions, including any AGENTS.md files that actually exist. Then read:

1. `docs/PROJECT_BRIEF.md`
2. `docs/MAP_SERVICES_REQUIREMENTS.md`
3. This prompt.

Do not access unrelated files outside this checkout. Do not read or print secrets, credentials, private user data, or operational location datasets.

Confirmed requirements:

- Node.js and TypeScript for the application backend.
- PostgreSQL with PostGIS for the application database.
- Docker-image-based deployment for Map Services.
- Required map capabilities: tile server, routing engine, geocoder, and Overpass.
- No Internet or external-network dependencies during operations, installation, or updates.
- The web client must provide an agreed subset of capabilities when disconnected from the server; that subset has not yet been specified.
- Features should be independently configurable where feasible without contradicting the required delivered scope.
- Map Services is the first implementation module. Authentication, Relation System, and SOS require separate requirements intake before implementation.
- Operators manually choose a nearby user for SOS dispatch; automatic dispatch is not confirmed.
- Relations control live-location visibility and can grant history access; the exact privacy model is unresolved.
- Claude Code prompts must be in English. Development happens on a separate feature branch only after the brief is finalized.

Review the actual documents critically. Identify ambiguities, contradictions, missing requirements, infeasible assumptions, hidden Internet dependencies, unsafe defaults, and cross-module constraints. Distinguish application database requirements from possible storage requirements of candidate map engines. Pay special attention to the difference between an isolated internal network and a browser disconnected from the server, including data provisioning, stale-location display, queued operations, acknowledgement, and privacy revocation.

Do not invent requirements or treat example products as selected components. Do not recommend technology as a final decision before the intake is complete. If you discuss candidates, label them as hypotheses requiring research, and distinguish remembered facts from facts verified in official documentation. The review may identify topics needing research without accessing the Internet.

Return your review in English with these sections:

1. Brief understanding: concise restatement of confirmed scope.
2. Blocking questions: only missing answers that affect the first Map Services architecture or feasibility; reference intake IDs M01–M07 and avoid duplicating already answered questions.
3. Contradictions and risks: include the affected requirement, practical impact, and a proposed clarification.
4. Suggested brief amendments: precise suggested wording, clearly labeled as proposals.
5. Architecture research agenda: what must be compared, verified, and measured after the intake is complete; do not select a final stack.
6. Acceptance gaps: missing measurable offline, security, functional, and capacity checks.
7. Readiness verdict: whether the brief is ready for implementation, with reasons and blockers.

Provide review feedback only, then stop. The project owner will return your review and answer the intake questions. A separate implementation prompt tied to a finalized brief and verified base commit will follow.
