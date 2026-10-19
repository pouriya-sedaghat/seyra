# Seyra client handoff: build and rehearse on the only available VM

## Owner authorization and scope

The owner has confirmed that there is no separate preparation machine. Use the existing VM. Online preparation and image downloads are allowed; the operational fixture install/import/update/restore must still work without Internet access.

The owner offered a full reset if necessary. A reset is not the chosen approach. You are authorized to **gracefully stop the existing inner Seyra service stack temporarily, retain its data and installation, run the preparation and disposable tests sequentially, and then resume that same installation**. The maintenance window starts when you execute the planned stop and ends when the original service is verified ready again. Do not promise its duration before measuring it. Do not ask again for a separate VM, or for permission to perform this bounded stop/resume.

This authorization supersedes earlier instructions forbidding all Docker workloads or all changes to the serving host's running state, solely for the explicit pause/resume described here. It does not authorize deploying the new build on that host, changing its access or certificates, deleting its stores, publishing a LAN endpoint, or installing trust on any device.

Use the existing VM-connected Claude Code session and operator-private handoff records to identify the preserved host and its installed CLI, home and nested Docker socket. Keep real addresses, client subnet, host identities, dataset bindings, secrets and certificate metadata outside Git. The corporate client subnet is already approved; no repeat intake is needed for this rehearsal.

## 1. Source and instructions

Implementation branch: `feat/map-services-v1`. Reviewed and pushed head: `3431e7e7330acb0e1184fd4d9c3204ab7f480ee7`.

Fetch origin and verify branch, HEAD and working tree before changes. Preserve unexpected local/newer work; never reset it or merge planning/review branches. Read `CLAUDE.md`, brief v0.3, `docs/handoff/DEPLOYMENT_PLAN.md`, RUNBOOK, accepted H1–H5/R1–R2 fixes and the source review from `origin/review/client-handoff-3431e7e`. Read planning files with `git show`, without switching or merging branches. This prompt's same-VM pause/resume authorization takes precedence over the older plan's requirement to keep the service running during builds.

The source review approves source and the next controlled build/rehearsal, not live rollout. Main must remain unchanged, PR #1 must stay draft, and the owner retains manual pushing. Do not push, mark ready, merge or contact the client developers.

## 2. Inventory, preservation and recovery before any stop

Record CPU, architecture, Docker versions, available RAM, swap, filesystem free space and the source/dependency lock. Distinguish the outer VM preparation daemon from the preserved host's nested daemon in every command. Record resolved daemon identity, endpoint and object IDs privately before each group of mutations; do not rely on inherited `DOCKER_HOST` or similar names alone.

For the preserved installation, record readiness and active/previous dataset identities, running inner container IDs and images, outer host/network/volume identities, installed lock, install/config/runtime file hashes, access settings, TLS public fingerprints and egress/isolation state. Record the original PBF identity read-only. Never put secret values in logs. If a pre-existing transition, TLS journal, import lease or unhealthy baseline exists, identify it before proceeding; do not disguise it as a test failure or clear it blindly.

Before stopping, prove that the old installed CLI, its lock and image IDs remain available on the nested daemon. Keep a verified coherent control/state backup and protected secrets/TLS recovery copy, reusing an existing verified copy where appropriate. Do not copy the entire Iran store merely to conduct a reversible stop. Preserve:

- the Git checkout and all unpushed work;
- original PBF, managed sources, active/previous stores and control database;
- preserved host containers, volumes, installation and private operator records;
- current certificate/key material and any existing issuer backups;
- the old images and verified bundle needed to resume that installation.

Write a private maintenance record, explicit stop/resume commands and recovery instructions before executing the stop. Include the exact installed CLI/socket/home, the baseline and a durable `resume required` marker. Implement cleanup/resume handling for normal completion, failure and interruption, not merely the success path. A shell trap cannot handle a VM crash: the durable record must let a resumed Claude session inspect state and finish recovery without guessing or starting a second workload.

## 3. Release RAM without destroying the installation

Use the **preserved installation's own installed product CLI** against its verified nested daemon to stop the inner service stack gracefully. Do not use the newly built checkout's lock or wrapper to operate this old installation. Verify the services, including PostgreSQL, stopped cleanly.

Keep the outer nested-Docker host and its networks running. This retains its socket, addresses and namespace isolation while releasing the providers' RAM. Do not restart the outer host or Docker daemon, change restart policies, use `docker pause`, forcibly kill databases, or delete/recreate networks or volumes. If this limited pause does not provide enough resources, restore the original service and report the measured blocker before proposing a broader intervention.

The generic lab harness must still refuse mutation of the preserved host: do not relabel it or bypass its ownership guards. This explicit product-CLI stop/resume is the only exception to its earlier read-only treatment. Create and mutate test hosts solely under their own matching lab labels and private paths.

Verify released memory and disk budget before work starts. Reclaim disk only when needed and only from individually inventoried, positively identified disposable lab objects or reproducible generated outputs that are not rollback dependencies. Record exact candidates, daemon, ownership and retained dependencies before removal. Do not use global prune commands, wildcard volume/image deletion, `down -v` against the preserved installation, or delete the checkout to make space. Preserve ambiguous objects. If sufficient disk cannot be made available this way, resume the old service and report the exact capacity shortfall.

## 4. Supervision and execution order

Run one resource-heavy workload at a time. Do not overlap build, fixture import, browser or multiple serving stacks. Where a restore test uses two hosts, stop the first host's services before loading the second if otherwise both would run concurrently.

Run a bounded independent resource supervisor throughout preparation and tests, sampling at least every 5 seconds. Stop the current identified workload if available RAM falls below 1.5 GiB, swap use grows by more than 512 MiB from the maintenance baseline, disk approaches the applicable floor plus outstanding work budget, or the current test service persistently loses readiness unexpectedly. Record actual PIDs/container/build-job IDs and verify cancellation stops the work; avoid broad process patterns and never kill the Docker daemon as a cancellation shortcut.

The preserved service is intentionally stopped: its not-ready status is expected and must not trigger the old live-host watchdog or be counted as the original readiness incident. Monitor the active test service and system resources instead. Keep planned maintenance duration, test-induced outages and the original unexplained readiness 503 as separate records. On abort, stop your disposable workloads, allow resource recovery and resume the preserved service before ending the session.

## 5. Build, lock and deliverables

First run the focused accepted source regressions, workspace build in dependency order, typecheck and unit suites with the pinned runtime. Do not invent new package/base pins to get a build through.

Build only **API, proxy and OPS**, sequentially, from the reviewed source and existing pinned inputs. Inspect preparation scripts before invocation; avoid an all-images build. Do not rebuild Valhalla, Overpass, Tegola, Photon, PostGIS, osmtools or geocoder-build. No Iran reimport is needed or authorized in this phase.

Record build duration, sampled resource peaks, disk impact and real image IDs. Regenerate the lock from inspected images and prove all data image identities and data-producing inputs are unchanged. If one changes unexpectedly, stop and investigate rather than silently relocking it. Do not load the new images into the preserved nested daemon or overwrite its installed lock/runtime files.

Export the next offline bundle to a fresh directory as the ordinary operator. Record its SHA256SUMS digest out of band and verify exact entry types/inventory, checksums, image IDs, readable ownership and permissions without a root/chown workaround. Build a separate fresh client handoff pack; verify delivered-byte hashes, exact manifest/inventory, links, source revision/cleanliness and absence of operator-only/private material. Assign a bundle identifier only after checking existing exports. Retain the previous rollback bundle.

## 6. Affected real-provider and browser suites

Freeze harnesses from a recorded committed revision and never edit files being executed. Retain failed/invalid attempts and rerun corrected harnesses from a new frozen revision. Source changes within this scope require meaningful regressions and affected image rebuild/relock/retest.

Run the accepted H1–H5/R1–R2 regressions and retained boundary regressions. On the newly locked images, run fixture integration, full-stack security, lifecycle, bundle tamper, isolated offline-host and fresh-host restore suites sequentially. Exercise the strict verify-before-install update gate using trusted already-installed tools. A rejected update must leave the old install/images unchanged. No incoming code may execute before its bundle is verified.

Use a real browser against the built ingress/Swagger UI: local spec/scripts/styles only, zero external requests, zero CSP violations/errors, no operation request before Execute, representative GET and POST execution, provider-down docs availability, exported/served spec agreement and real JSON errors conforming to the strict schema. Include aborted/missing requests, required visits and crashes in the verdict. Scan the actual built assets as well as source configuration.

## 7. Disposable relay, TLS and rollback rehearsal

Use a small synthetic fixture, uniquely labelled disposable hosts/edge and temporary test PKI. Do not use a second Iran stack. Keep the test surface isolated or loopback-only; do not publish on the VM's corporate LAN interface. Use non-overlapping documentation/benchmark addresses, never a network overlapping the approved corporate subnet. Company-CA choice is not a prerequisite for temporary fixture PKI; no issuer/root for real device trust is created in this phase.

Rehearse the nested topology and actual source-address path through outer Docker, edge and inner PROXY listener. Preserve the ordinary control listener without PROXY headers. Verify both grants and refusals: outsider, untrusted relay peer forging an approved client, missing/malformed PROXY, spoofed HTTP forwarding headers, direct bypass, unknown Host, diagnostics variants and oversized bodies, across web/docs/spec/API/map assets. Never allow Docker gateway addresses just to make a test pass.

Rehearse CSR, import, renewal, full-chain backup, `tls restore`, interrupted replacement and recovery. Check complete set/chain/root/metadata integrity and unchanged active files on refusal. Measure actual update/cutover and rollback not-ready intervals and which containers are recreated; prove intended data/provider identities remain stable.

Run the real namespace egress test, including private destinations, controlled disposable sinks, tool failures and its cumulative nonzero failure verdict. Verify permitted ingress replies/upstream and guarded egress in the real topology. Do not scan corporate devices or change the VM's global firewall. Rollback must remove relay trust before address reuse and validate certificate restore. Any failed safety boundary blocks later live rollout.

## 8. Mandatory resume of the original service

Before resuming, stop/remove only your matching disposable workloads and verify available resources. Confirm the preserved outer host, private install/runtime/TLS fingerprints, dataset pointers, volumes and nested image IDs match the preflight. Use its unchanged installed product CLI and existing nested images to start the original service; do not use this as a deployment of the new API/proxy/OPS build.

Wait for readiness of all four providers with the recorded dataset identity and verify the original loopback ingress, image/config identity and isolation. Do not claim success because containers are merely up or `start` returned zero. Record the intentional stop/start timestamps and any actual recreation; do not claim unchanged uptime after an authorized restart. Mutable database/provider files need not have unchanged byte hashes after normal shutdown/startup.

Clear the maintenance marker only after verified recovery. If recovery fails, prioritize the bounded attempt to restore the unchanged installation, stop testing, retain the data and precise errors and leave explicit operator recovery instructions. Never reset volumes, reimport Iran, rotate TLS or deploy the new bundle to conceal a resume failure.

## 9. Evidence and final boundary

Record sanitized evidence under a new run identity: source/harness/image/bundle/pack identities, commands, actual resource peaks, maintenance duration, rehearsal outages/rollback, verdicts and unexecuted checks. Keep historical records intact. Real endpoints/configuration, secrets and certificate details remain private. Update TEST_RESULTS, IMPLEMENTATION_STATUS and the handoff/deployment plan to distinguish source approval, built fixture evidence and pending live deployment.

Commit changes logically on the feature branch, keep the tree clean and report the new head for the owner's manual push. Report API/proxy/OPS image IDs, unchanged data identities, verified operator-readable bundle/client pack, suite results, measured rehearsal/rollback and original-service recovery.

**Finish with the old service running again and a concrete, reviewable live LAN cutover plan.** Live image/access/TLS replacement, a corporate LAN relay, Windows/device trust, live Iran query/load tests and contact with either client developer remain outside this phase. PR #1 stays draft. Do not ask for those decisions before completing the authorized build and disposable rehearsal.
