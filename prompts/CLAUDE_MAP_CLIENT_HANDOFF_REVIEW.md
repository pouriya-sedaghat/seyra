# Superseded: use the complete v0.2 review prompt

Do not execute the old prompt below. Read `prompts/CLAUDE_MAP_CLIENT_HANDOFF_REVIEW_V02.md` on this planning branch instead, together with brief v0.2 and the owner's private `APPROVED_CLIENT_CIDR` session input.

The following v0.1 text is historical:

Run in the existing VM-connected Claude Code session and `~/seyra`. Expected implementation baseline is `d63f1d9310c4a3c51abee3dde832eb36e51b267f` on `feat/map-services-v1`, now pushed. Verify local state/refs and preserve all newer/local changes. Keep PR #1 draft and main unchanged.

This is the owner's requirements → brief → Claude feedback step. **Do not implement, install packages/build images, activate access, run load tests, restart hosts, or change application/deployment configuration in this turn.** Return a concrete review and a safe implementation/deployment plan. Network inputs remain unresolved; do not ask for a blanket approval to ignore them.

Fetch origin and read the following from `origin/plan/map-services-client-handoff-d63f1d9` with git show (do not merge the planning branch):

- `docs/planning/MAP_CLIENT_HANDOFF_BRIEF.md`
- `docs/planning/MAP_CLIENT_HANDOFF_SEARCH_SEEDS.json`

Also read CLAUDE.md, current phase-1 documents, RUNBOOK, MOBILE_INTEGRATION, generated OpenAPI/app/generator, proxy routing/CSP, and the latest Iran boundary run. From `origin/review/map-services-vm2-d63f1d9`, read `docs/reviews/VM2_d63f1d9_REVIEW.md`. F1-F4 are accepted; preserve their fixes. This new scope is Map Services client delivery, not Auth/Relations/SOS/mobile implementation.

Owner-confirmed additions:

- Owner initially tests the web client from Windows.
- The client technical lead needs private map-service access; sharing the test client helps.
- Interactive offline Swagger is needed.
- Target concurrency is unknown; measure capacity without inventing an SLA.
- We select Persian test queries. Five proposed seeds and their provenance are provided.

Review tasks:

1. Inventory what exists versus what is missing. Confirm runtime Swagger/spec availability, schema completeness, current proxy routing/CSP and client integration docs from the actual baseline.
2. Evaluate a minimal local Swagger implementation using compatible pinned packages: same-origin UI/spec/Try-it-out, local assets, offline/validator/config-override behavior, proxy prefixes and CSP. Identify exact schema/examples work and appropriate acceptance tests. Do not add a second divergent API specification or expose providers/admin/CLI controls.
3. Perform a **read-only, project-scoped topology/resource preflight** if needed: current VM IP/routes, Docker host/namespace/network/port bindings, certificates' public SAN/validity metadata, available RAM/disk and the preserved host's identities/health. Do not print private key/password values, scan unrelated LAN hosts, enumerate unrelated repos/accounts or alter firewall/DNS/bindings.
4. Explain the real Windows/technical-lead access path. Inspect for nested Docker/network namespaces: VM loopback and service loopback may differ. Do not issue an untested ssh -L recipe or assume the VM LAN IP can be bound inside an inner daemon. Identify the private endpoint/TLS/allowlist and any separate-origin CORS inputs still needed. An existing same-origin development proxy may avoid CORS; assess rather than assume. Keep concrete operator addresses, host names, dataset identities and topology details in local/private preflight output; public repository templates use placeholders.
5. Separate independent implementation work from activation blockers. Swagger/docs can be prepared without guessing client IPs/origins. Shared-network activation and any change to the preserved serving host wait for a concrete reviewed plan plus the necessary owner settings/window. Do not relabel/restart/recreate it or co-locate another full test stack and degrade it.
6. Review the five Persian seed cases, their feature identities and the proposed top-5 assertion. Flag any unexecuted/ambiguous case (Persian Shiraz is newly proposed). Recommend bounded engineering quality checks without overclaiming address completeness or production relevance.
7. Review a staged 1→2→5 capacity characterization, including realistic per-operation/browser work, sampling/stop conditions and resource isolation. Do not execute it now. The previous shared-VM degradation and original unexplained readiness 503 remain separate observations.

Return:

- checkout/read-only preflight summary;
- confirmed [C], proposed [P], verified [V] and unresolved [U] decisions;
- brief corrections, concrete technical tradeoffs and any proposed path/interface changes;
- a concise table of what is ready for implementation versus blocked for deployment/measurement;
- minimum remaining owner inputs (private reachability/approved clients, exact browser origins or proxy choice, endpoint/trust/window);
- affected files/images/bundle/tests and why a full Iran import should be unnecessary;
- explicit status for the preserved host/PBF and any checks not executed.

Do not contact the technical lead, publish endpoints, modify the PR, commit implementation changes, merge or force push. A separate implementation prompt will follow once the brief and critical inputs are stabilized.
