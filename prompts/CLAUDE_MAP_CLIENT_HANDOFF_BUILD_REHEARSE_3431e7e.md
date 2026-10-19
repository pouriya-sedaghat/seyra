# Seyra client handoff: build and disposable rehearsal after source approval

Use the approved preparation environment. Implementation source: `feat/map-services-v1`, reviewed head `3431e7e7330acb0e1184fd4d9c3204ab7f480ee7`. Preserve newer/local work; do not reset, merge review/planning branches, force-push, change main or mark PR #1 ready/merge it.

The owner supplies private execution inputs alongside this prompt:

- `EXECUTION_LOCATION`: `separate-preparation-machine` or `shared-vm-approved-window`;
- when shared: the explicitly approved window, existing owner-only serving-host watcher configuration and allowed resource budget;
- operator-local paths to the verified current bundle/images, source checkout and test output; real addresses/CIDRs/host/dataset identities stay private.

**Resource gate:** do not infer shared-VM workload approval from the existence of this prompt or earlier development authorization. If the location/window is not supplied, finish read-only preflight and a concrete command/resource plan, then report that workload steps are pending. Do not start image builds, service/browser workloads or a rehearsal. This gate does not require the owner to repeat the already approved corporate client subnet or client types.

Fetch origin and read, without merging, from `origin/review/client-handoff-3431e7e`:

- `docs/reviews/CLIENT_HANDOFF_3431e7e_REVIEW.md` and its evidence;
- this prompt.

Read `CLAUDE.md`, brief v0.3, current deployment plan/RUNBOOK, preparation scripts and all accepted H1–H5/R1–R2 fixes. The reviewed corrective patch has SHA-256 `32085226b1c0dfe703a82383941fd8730b6bef19857287b552c98b3364443729`. R1/R2 are accepted: 24/24 recovery, 19/19 pack checks plus 20/20 retained TLS checks in the independent adapter. This is source approval, not evidence of Docker/LAN/browser behavior.

## A. Preflight, source identity and resource supervision

Verify the exact source/branch, cleanliness, platform/architecture, Docker state, available CPU/RAM/swap/disk and the current dependency lock. Preserve current bundles/images for rollback; do not remove unrelated artifacts or use global Docker pruning. Freeze harnesses from the tested revision, record their identity and keep invalid/failed attempts.

On separate resources, transfer the verified old bundle/data image archives and synthetic fixture as needed; no new Iran dataset import. On a shared-VM approved window, record the live host's identity/readiness read-only and run the prepared watcher independently of the workload. Workloads run one at a time with enforceable limits where available. Verify probes/watchdog are bounded and abort handling really stops only your workload.

Use at least the already proposed stop criteria: available memory below 1.5 GiB, swap growth above 512 MiB, or two consecutive not-ready observations; apply stricter owner-supplied limits. On a trigger stop your build/test processes, retain evidence, and wait for recovery. Never restart/recreate the preserved serving host to repair a test's resource pressure. Container uptime alone does not prove preserved service quality. Do not run browser, import and build workloads together.

## B. Build only the approved components

Inspect the preparation script and invoke only the **API, proxy and OPS** builds with the existing exact base/source/package pins. Do not run an all-images path that rebuilds Tegola, Valhalla, Photon, Overpass, PostGIS, osmtools or geocoder-build. Online preparation is authorized; none of its downloads may become an operational dependency.

Measure actual build duration, peak resources, disk impact and image identities. Regenerate the dependency lock from inspected results. Assert all data image identities and data-producing inputs are unchanged, and existing fixture release compatibility remains valid. If a data identity changes unexpectedly, stop and explain it rather than relocking it as an incidental change or reimporting Iran.

Export the next real offline bundle to a fresh directory as the ordinary operator, record its SHA256SUMS digest out of band, and verify exact files/checksums/image IDs/ownership. Build the separate client handoff pack to a new/empty directory with an exact manifest. No real issuer private keys, live secrets or private operational configuration in either deliverable or public evidence. Do not invent an r7 identifier or image/dataset identity before it is measured.

## C. Affected suites and the actual browser boundary

Run the pinned-runtime source build/typecheck/unit suites and focused recovery/wrapper/pack/contract regressions. Then run real-provider fixture integration, security, lifecycle, tamper, isolated offline-host and restore suites on the new locked images, in resource-safe sequence.

Test the built ingress and actual Swagger UI in a real browser: local UI/spec/static assets, zero external requests/CSP violations/errors, no unrelated operation requests before Execute, representative GET and POST Try-it-out, provider-down docs availability, runtime/export spec agreement and real JSON errors conforming to the schema. Scan the built assets, not merely source URLs. Record aborted/missing requests and visits in the verdict; a harness crash is FAIL, never a partial PASS.

Exercise the strict update gate before loading/installing any incoming bundle on a disposable host. Keep the previous installed tree/images unchanged on refusal, including invalid file types/copies; do not execute new tools before their bundle is verified.

## D. Disposable end-to-end relay/certificate rehearsal

Use a uniquely labelled small synthetic-fixture host plus a disposable edge, not the preserved serving host and not a second Iran stack. Publish only on a controlled test surface, not the corporate LAN address. Use isolated documentation/benchmark address ranges with no conflict with real routes. Never create a Docker network overlapping the actual approved corporate subnet merely to simulate a client.

Use temporary test PKI only. Rehearse CSR, validated import, renewal, full-chain backup, `tls restore` and interrupted replacement/recovery. No live certificate/key/trust-store changes and no production issuer generation. Existing issuer/device-trust decisions are for later LAN activation, not a reason to invent live trust during fixture testing.

Measure the update/cutover/rollback not-ready interval and the exact containers recreated; prove data stores/providers retain their intended identities. Verify the ordinary loopback control path without PROXY headers, and real source-address handling across outer Docker → edge → nested relay listener. Required negatives: outsider, untrusted peer forging an approved address, missing/malformed PROXY header, spoofed HTTP forwarding headers, direct bypass, unknown Host, diagnostics variants and oversized body. Cover web/docs/spec/API/map assets behind the common boundary. Do not broaden source grants to Docker gateways when a source-address test fails.

Run the namespace egress test with its cumulative exit verdict, controlled sinks and namespace-specific evidence; include private destinations instead of relying on the old counter that excludes them. No scanning corporate devices or modifying the VM's global firewall. Verify the edge's egress guard, permitted ingress replies/upstream and failure handling in the actual topology. Any unsafe start/cleanup path blocks live rollout.

Perform the documented rollback including certificate restore and relay trust removal before address reuse, not just a healthy forward cutover. Clean up only objects whose labels/ownership match this rehearsal; do not attach, restart, relabel, delete or otherwise mutate the preserved host. Keep operator configs/private identities outside Git.

## E. Result and remaining live gate

Record measured results, commands/harness/source/image/bundle identities, failures and unexecuted checks. Keep historical evidence intact. Update test/status/deployment/handoff docs with the final build inputs and measured outage/rollback, using public placeholders. Real verified links belong in the private operator handoff.

If a product/harness defect is found, reproduce it, add a meaningful regression and correct it within this scope before claiming PASS; rebuild/retest only what changed. Do not weaken access, TLS, readiness, identity checks or test verdicts to finish a run. Keep the original readiness incident separate from new findings.

Commit results logically on the existing feature branch and retain the owner's manual-push workflow. Return new head, changed image IDs (API/proxy/OPS), unchanged data identities, operator-readable verified bundle/pack, test table, measured rehearsal/rollback and any blockers.

**Stop at the concrete live cutover plan.** No LAN endpoint publication, load on the preserved host, live certificate/access/image replacement, live service restart, trust installation, real Iran queries or contact with the two client developers. Live activation needs the owner's final window/trust decision after a passed rehearsal. PR #1 stays draft and main unchanged.
