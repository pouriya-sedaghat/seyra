# Review-only: Seyra client handoff and offline Swagger — v0.2

**REVIEW COMPLETED — HISTORICAL PROMPT.** Read the stabilized brief v0.3 and `prompts/CLAUDE_MAP_CLIENT_HANDOFF_IMPLEMENT_V03.md` for the next authorized implementation-preparation turn. The instructions below describe the completed review and must not restart it.

Use the existing VM-connected session at `~/seyra`, branch `feat/map-services-v1`. Expected baseline: `d63f1d9310c4a3c51abee3dde832eb36e51b267f`. Verify refs/working tree, preserve newer/local work, keep PR #1 draft and main unchanged.

This replaces the unsent v0.1 prompt. This turn is brief review and read-only preflight: do not implement, install packages/build images, change configuration/access, restart hosts or run load tests. Review feedback comes before a separate implementation prompt.

## Private input

The session message accompanying this prompt provides `APPROVED_CLIENT_CIDR`. The owner has authorized that exact subnet for LAN clients. Use it for the design; do not ask the owner to repeat it or broaden it. Keep actual CIDRs/addresses, host names and operational identities in local/private operator output, not public Git templates.

## Read

Fetch origin. From `origin/plan/map-services-client-handoff-d63f1d9`, use git show to read `docs/planning/MAP_CLIENT_HANDOFF_BRIEF.md` (**v0.2**) and `docs/planning/MAP_CLIENT_HANDOFF_SEARCH_SEEDS.json`. Do not merge this branch.

Read CLAUDE.md, current Map Services documents, RUNBOOK, MOBILE_INTEGRATION, app/OpenAPI generator/export, proxy routing/CSP and the latest boundary validation record. From `origin/review/map-services-vm2-d63f1d9`, read `docs/reviews/VM2_d63f1d9_REVIEW.md` without merging. Preserve accepted F1–F4 fixes.

## Confirmed requirements

- The VM's hypervisor adapter is bridged onto the corporate private LAN, reachable by company devices. This does not mean Docker host networking or exposing providers.
- Owner tests from Windows. Two different developers build **web and mobile in parallel**, using one shared API/asset contract. Both benefit from the hosted test client and Swagger.
- The private `APPROVED_CLIENT_CIDR` is the authorized client subnet.
- Provide local interactive Swagger with user-triggered Try it out and offline assets, plus separate web/mobile quickstarts and a shared feature/asset guide.
- Target concurrency remains unknown. We select Persian fixtures; no invented SLA or completeness guarantee.
- Exact web origin and mobile framework/SDK are unspecified. Propose a development proxy for initial web integration and a generic mobile contract; these details do not block backend/docs review.

## Review tasks

1. Inventory existing versus missing Swagger/spec serving, schema completeness, examples, proxy/CSP and integration docs. Recommend compatible pinned local Swagger assets, same-origin paths and disabled remote validation/config overrides. Do not expose provider/admin/CLI controls or create divergent specifications.
2. Perform read-only, project-scoped preflight: observed VM address/routes, relevant Docker namespaces/ports, available resources and public certificate metadata. Derive a usable corporate HTTPS endpoint; distinguish VM versus nested-daemon loopback. Do not assume the VM address can bind inside an inner daemon or issue an untested forwarding recipe. Do not scan unrelated hosts/repos or print secrets.
3. Design ingress using the exact approved subnet, denying other sources and keeping providers/DB private. Verify the actual client address seen at ingress and trust forwarded headers only from explicit trusted hops. Do not broaden access to Docker bridge networks or rely on spoofable headers. Plan Windows/device CA trust without sharing keys or disabling TLS. No public endpoint or external runtime dependency.
4. Plan the web development proxy for `/api/` **and `/maps/`**, including absolute style/TileJSON URLs, glyphs/fonts/sprites/tiles and verified upstream TLS. Do not guess a port or grant wildcard/reflected CORS. Direct browser cross-origin access, if needed later, requires exact origins and correct preflight/errors/cache variation. Subnet access, browser CORS and authentication are separate.
5. Prepare one shared contract plus distinct web/mobile quickstarts: base URLs, public CA trust, coordinates/units, cancellation/backoff, dataset changes, examples and asset discovery. Distinguish native HTTP from WebView/hybrid contexts. Keep actual SDK/platform/Persian rendering tests explicitly unexecuted. Do not implement mobile apps, Auth, Relations or SOS.
6. Preserve the original PBF and designated serving/validation host. Do not restart, relabel, recreate or run another full stack alongside it. Separate code/doc readiness from activation/maintenance/resource impact and propose a concrete safe plan, not a blanket permission request.
7. Review the five Persian seeds and top-5/identity/location/navigation checks; flag unexecuted cases such as the Persian Shiraz query. Review a bounded 1→2→5 capacity plan with stop thresholds/cooldown/resource isolation, without executing it. Keep the original unexplained readiness 503 separate from workload-induced degradation.

Return checkout/preflight findings; [C]/[P]/[V]/[U] corrections; a concrete architecture recommendation; affected files/images/bundle/tests; ready-versus-blocked milestones; and only genuinely remaining decisions. Do not repeat resolved subnet/client-type questions. Keep sensitive preflight details local and use sanitized Git summaries. State what you did not test and how preserved host/input safety was checked.

Do not contact either developer, publish an endpoint, modify the PR, commit implementation changes, merge or force push. Give feedback before implementation.
