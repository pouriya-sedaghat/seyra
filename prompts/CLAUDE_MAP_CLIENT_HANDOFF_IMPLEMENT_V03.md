# Seyra client handoff implementation — v0.3

Continue in the existing VM-connected Claude Code session at `~/seyra`. The owner has accepted the overall handoff proposal with the corrections in brief v0.3 §7. This is the implementation-preparation turn, not another review-only turn and not live deployment.

## 1. Checkout and scope

Verify local status and fetch origin without overwriting work. Expected implementation baseline: `d63f1d9310c4a3c51abee3dde832eb36e51b267f` on `feat/map-services-v1`. Preserve newer/local changes, all accepted boundary fixes, main and draft PR #1. Do not reset, merge a planning/review branch, force-push or create a second implementation line merely for this task.

Read with `git show` from `origin/plan/map-services-client-handoff-d63f1d9`:

- `docs/planning/MAP_CLIENT_HANDOFF_BRIEF.md` — must be **v0.3**, especially §7;
- `docs/planning/MAP_CLIENT_HANDOFF_SEARCH_SEEDS.json`;
- this prompt.

Read `CLAUDE.md`, current requirements/architecture, RUNBOOK, existing mobile guide, OpenAPI generator/export, app/proxy/OPS code, and the current validation records. Read `docs/reviews/VM2_d63f1d9_REVIEW.md` from the review branch without merging it.

The private session input supplies `APPROVED_CLIENT_CIDR`. It is the already approved exact corporate subnet; do not ask again or broaden it. Derive actual endpoint/namespace values from your existing owner-only preflight file and read-only confirmation. Public Git examples use placeholders; keep actual addresses, host identifiers, certificate fingerprints and operational dataset/checksum bindings in private operator output.

## 2. Work authorized now

Implement on the existing feature branch, with logical commits and focused tests:

### A. Public contract and offline Swagger

- Add a verified, exact compatible `@fastify/swagger-ui` release. Your proposed 5.2.6 is a candidate to verify against package/release integrity and the installed Fastify 5/swagger 9 stack, not a prescribed "latest" claim. Pin dependencies and retain local static assets.
- Serve `/api/docs/` and `/api/docs/json` through the existing `/api/` ingress. Export the same canonical specification to `docs/openapi/map-services-v1.json`; test runtime/export agreement without relying on accidentally matching fixtures.
- Add meaningful summaries, stable unique operation IDs, parameter/body examples and descriptions, a capabilities response schema and truthful error/limit responses including 413. Preserve response behavior, admission/identity gates, redaction and unsupported routing semantics. Ensure schema additions do not strip existing required fields.
- Describe proxy-served styles/TileJSON/MVT/fonts/sprites in the asset contract and specification narrative. Do not add fake JSON routes or expose providers/admin/CLI commands.
- Use same-origin user-triggered GET/POST Try it out. Disable remote validator/config/spec selection, query-string overrides, OAuth and automatic operation execution. Loading local docs/spec/static assets is expected; unrelated API operations must not execute until requested. Nginx owns the effective CSP; do not globally weaken it or add a conflicting plugin CSP.
- Docs/spec must remain available when a provider is down, with actual typed errors for attempted operations. Block ingress access to the hidden diagnostics endpoint and normalized/path variants; hiding it from OpenAPI is insufficient.

### B. Shared web/mobile handoff

- Write `docs/CLIENT_INTEGRATION.md`, a handoff index, and consistent updates to the mobile guide/RUNBOOK. Both developers use one backend/asset contract. Do not contact them or implement their apps.
- Include relative endpoint inventory, units and named lon/lat, readiness versus availability, capabilities/limits, errors, dataset-version changes, light/dark fa/en styles, fonts/sprites/attribution, cancellation, bounded retries and GET/POST examples. Label synthetic and unexecuted examples honestly.
- Provide a configurable web development proxy for `/api/` and `/maps/`, with verified upstream TLS. Account for absolute URLs in style/TileJSON using an exact configured-origin rewrite for MapLibre resources or a narrowly scoped proxy rewrite. Cover tiles, fonts, glyphs and sprites. Reject unrelated targets, protocol-relative/credential-bearing bypasses and forwarded-Host abuse; no arbitrary proxy, disabled certificate checks or localhost addition to LAN server names.
- Hosted Swagger/test client is same-origin. Do not invent browser origins or add wildcard/reflected CORS. Explain native HTTP versus WebView/browser behavior; no `null`/`file://` origin grant. SDK-specific trust/Persian rendering remains untested until the platforms are known.
- Implement the Persian seed runner: split independent yeh/diacritic changes, add kaf and ZWNJ coverage from observed data, and test Persian Shiraz. Record query/options, expected identity/location/top-k and actual results; navigation tests must prove arrival. No silent reference changes when a snapshot/OSM ID differs. Keep operational bindings in local reports. Do not issue new live Iran queries during this implementation-only turn; leave that measurement pending.
- Correct the boundary README's overbroad install-failure wording as described in brief §7.1.

### C. Ingress, relay and certificate preparation

- Implement optional validated relay configuration and a sanitized `infra/edge/` template for the nested topology, retaining ordinary direct deployment. Verify exact-image stream/real-IP module requirements in prepared checks; accepting HTTP PROXY protocol alone is not enough evidence.
- The edge derives a PROXY header from the actual connection peer. The inner listener independently requires the configured relay socket peer and then the approved conveyed client subnet. Never trust arbitrary PROXY/HTTP forwarding claims. `set_real_ip_from` is not itself a peer firewall. Keep unknown-Host rejection and private providers/DBs.
- Preserve an ordinary local TLS control path for existing CLI/readiness/recovery calls without PROXY headers. A separate listener must not create a LAN bypass. No bridge/gateway ranges added to the client allowlist to make self-tests pass.
- Prepare external-issuer CSR/validated certificate import and explicit renewal/replacement. Company CA and an operator-managed test issuer use the same server provisioning interface. Do not implement a new on-server "IP-restricted root" as a universal trust guarantee. Follow brief §7.2; name constraints alone do not establish cross-platform root restrictions.
- Validate a proposed leaf/key/chain and expected SAN/validity/server purpose before replacement; invalid input preserves the previous pair. Recoverable replacement must avoid partial cert/key state. Use temporary synthetic material for tests only. No live key/certificate deletion, generation, replacement or implicit issuer rotation. No issuer key in service TLS directories/backups/images/bundles/Git. Preserve legacy fixture compatibility and document its test-only CA boundary.
- Prepare tests for valid relay traffic, untrusted peers forging approved addresses, absent/malformed PROXY headers, spoofed forwarding headers, direct bypass, denied diagnostics, unknown Host and local control recovery. Include all web/Swagger/API/map paths in the common access boundary.
- Prepare controlled namespace egress tests covering corporate/private destinations as well as public destinations. The historical counter excluding private ranges cannot prove LAN isolation. Do not scan corporate devices or alter the VM's global firewall.

## 3. Tests and shared-VM safety

Run low-footprint unit, schema, Fastify HTTP injection, configuration-generation and temporary-certificate tests first. Include meaningful negative regressions for newly added boundaries. Build/typecheck in the project's required workspace order and report exact commands/results. Use existing installed tools where possible; online dependency preparation is allowed, operational downloads are not.

Do **not** start another Docker service stack, Docker/browser workload, image build or rehearsal beside the preserved Iran host in this turn. Do not run load tests, change its live settings/certificate/images/install tree, publish ports, start a relay, restart/recreate any live service, install Windows/device trust or reimport Iran. Do not change readiness semantics/timeouts or call the original readiness incident resolved.

Prepare a precise follow-on plan for safe resources: API/proxy/OPS-only build inputs, expected CPU/RAM/disk, isolated fixture/relay/certificate rehearsal topology, health/resource monitoring, abort thresholds, cleanup and rollback commands. Current resource estimates are planning inputs, not proof that co-location is safe. If a test cannot run within this boundary, record it as NOT RUN and finish the code, tests, docs and reviewable plan that do not depend on it.

Data-producing images/inputs must remain unchanged. Do not relock nonexistent images, invent r7 identities, change the dataset ID, or re-export a supposedly verified bundle before real safe builds and checks. Prepare the commands and suite list for the eventual API/proxy/OPS rebuild/relock/bundle and disposable cutover rehearsal.

Keep the five-second within-step capacity monitoring, conservative reclaim credit, strict bundle gate, host labels, frozen harness identities and deterministic overlap checks intact. No Auth/Relations/SOS/mobile implementation.

## 4. Completion for this turn

Commit the completed implementation preparation on `feat/map-services-v1`; preserve the owner's manual-push workflow and do not push or change PR state/description in this turn. Return:

1. Exact head, commits, clean/dirty state and affected files; keep main unchanged and PR draft.
2. What changed, validation performed, meaningful failures and unexecuted checks.
3. A table of milestones: code ready; image builds/rehearsal pending; live cutover pending; Windows/mobile/load checks pending.
4. Concrete resource/rehearsal and serving-host cutover/rollback plans, with no unmeasured outage guarantee. Include the current versus proposed trust model and issuer key location, without printing secrets.
5. Only remaining owner decisions that are actually needed for the next concrete step: safe rehearsal resources/window, and company-CA availability versus a separately managed development issuer/device trust. The LAN subnet, two client types, unknown concurrency and delegated query selection are already resolved.

Finish all independent authorized work before requesting those deployment/resource decisions. The immediate result is code and a reviewable plan, not a live endpoint. Never represent an unexecuted LAN, Windows, mobile, image or browser check as PASS.
