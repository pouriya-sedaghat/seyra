# Source and evidence review: client handoff build/rehearsal at c73db85

Verdict: **REQUEST CHANGES before live LAN cutover.** Four narrow issues in the new safety guards and rehearsal verdict require correction. The submitted successful fixture run is useful evidence; these counterexamples do not assert that it damaged any owner object or leaked traffic.

## Reviewed input and independent scope

- Mail patch: `3431e7e..c73db85`, 12 commits, final head `c73db85d824a801ff9c31fe958c2ee8da164c496`.
- SHA-256: `aa05ca6808311ceca889b61f69e3ec469b293b8c9bc33b43a229bf97db9d1131`, matches the owner-provided value.
- Reconstructed every mail commit over the previously reviewed source; all **134 changed file versions** match their Git blob IDs before/after application, including binary evidence.
- The seven data image entries are unchanged. Only API, proxy and OPS entries changed. Their Dockerfile hashes match source; the unchanged API Dockerfile was retrieved from the approved base to complete the local reconstruction.
- **327 retained standalone checks pass independently**: wrapper 64, edge-stop 4, namespace egress 21, handoff pack 19, dev proxy 35, update gate 74, host guard 26, reclaim credit 4, navigation 9, browser verdict 9, seeds 18, TLS CLI 20, TLS recovery 24. Pack checks counted once.
- Node here is **24.19.0**, OpenSSL **3.0.13**, rather than the VM's pinned 24.21.0/3.5. The TLS checks run actual source with the previously disclosed minimal layout/entry adapter and explicit unprivileged ownership branch; temporary real PKI and kernel flock are used. The adapter does not reproduce the whole built application.
- The 10 error-contract checks could not run here because `ajv` is absent. No new dependency was installed. Full workspace build/unit tests, image/archive inspection, real browser, Docker, network namespaces and the live VM were **not** independently rerun.
- Four new negative cases reproduced against the actual shell scripts with recording Docker/ip stand-ins. No owner data, daemon, network, live certificate or service was accessed.

## R1 — P1: rehearsal reuses an existing volume without checking ownership

Location: `tests/rehearsal/handoff-rehearsal.sh:125-130`.

The VM container and networks have ownership checks, but the fixed-name rehearsal VM volume does not. The driver calls `volume create --label ...` and immediately mounts that name read/write at `/var/lib/docker`. A volume left by a different lab or an unlabelled owner volume is therefore usable by the new privileged DinD container.

Docker's documented behavior is that an existing name on the same volume driver is reused without an error: [official volume-create reference](https://docs.docker.com/reference/cli/docker/volume/create/). A successful create is not ownership evidence.

Independent case: the stand-in models an existing foreign volume. No `volume inspect` occurs; the script reaches `run ... -v <volume>:/var/lib/docker`. The recorder deliberately fails that run after recording the attempted mount, before any real container could start. The script's eventual exit 1 does not undo the unsafe admission decision.

Required correction: preflight the exact daemon and volume. Reject existing unlabelled/foreign volumes before use; verify labels after creation as well. Handle inspect/create failures and races without mounting unverified state. Keep the preserved host and its volumes outside this harness. Add negative cases for foreign/unlabelled/uncertain volume state and a positive owned/new-volume path.

## R2 — P1: failed TCP connection is treated as proof that relay trust was removed

Location: `infra/edge/edge.sh:101-114`.

The new ordinary-stop interlock accepts `nc` exit 1 and stops the edge. A proxy that is temporarily stopped, restarting or unreachable produces that result while the relay peer remains in persisted settings/runtime and can be reinstated on startup. Stopping the edge can then release the trusted source address for reuse, the same risk B2 was intended to close.

Independent case: with unchanged persisted relay settings and a temporarily closed upstream, the actual script calls `docker stop` and exits 0. Controls confirm that a listening upstream and a probe execution error are refused. The defect is the inference from connection failure to removal of authorization, not the existence of the probe.

Required correction: ordinary stop must require reliable evidence that this installation has removed the exact peer's relay trust from persistent state and the applied ingress configuration/publication, or preserve the address reservation. Refuse ambiguous/down/restarting states. Do not use a failed connection, timeout, stale acknowledgement or arbitrary unchecked file as proof. Keep emergency force explicit and document its residual risk.

Test a proxy outage with trust still configured, proxy restart, failed state inspection, wrong/stale proof and confirmed successful trust removal. The first cases must retain the edge/address and fail closed. The current regression calling exit 1 “relay trust removed” must be corrected.

## R3 — P2: missing ping still produces an isolation PASS

Location: `tests/offline/namespace-egress.sh:55-63`.

The sink branch treats every unsuccessful `docker exec ... ping` as `sinkok=1`, discarding stderr and status. A missing executable, failed exec or daemon error is therefore accepted as an absent sink. The later positive TCP control validates `nc`, not this ping operation.

Independent case: all existing valid sink-route conditions and TCP controls are retained, but ping returns 127 with `ping: not found`. The actual script prints the absent-sink PASS and exits 0 with zero failures.

Required correction: distinguish verified bounded probe results from tool/daemon failures, and avoid claiming an address is absent merely because ICMP did not answer. Preserve strong sink/internal-network evidence and make unavailable/inconclusive verification fail. Cover missing ping, failed exec/daemon, answering sink, inconclusive probing and the intended valid case.

## R4 — P2: unsuccessful cleanup and changed outer routes return success

Location: `tests/rehearsal/handoff-rehearsal.sh:371-391`.

Cleanup commands run without accumulating their errors. The final result is always NOTE, even if owned objects remain or the VM routing table is CHANGED. `finish` therefore reports zero failures and exit 0.

Independent case: exact owned removal operations fail with status 125; final inventory contains one container, one network and one volume, and the final route table differs. The actual script emits all those facts as NOTE and exits 0.

Required correction: distinguish a deliberate retention policy from cleanup failure. Failed required removals, failed inventory/route checks, unexpected remaining owned objects or changed host routes must be FAIL/nonzero. Never repair a failure by deleting foreign objects or modifying the VM's global firewall. Include negative verdict tests and a clean-success control.

## Accepted changes and limited observations

- The CSR permissions change is narrow: traverse the pending directory and read public CSR/names, with the private key still 0400. The retained TLS checks pass.
- The wrapper's lexical handling of root-only `--from` under the already mounted service home and its fresh `--out` mode change pass the retained 64 checks. The successful real rollback evidence supports the intended operator workflow.
- The corrected manual order “remove trust and apply/restart ingress, then stop/remove edge” is sound. R2 concerns the claimed automated interlock, not a request to reverse that order.
- The submitted egress record reports successful positive controls and cleanup reports no leftovers. R3/R4 expose untested failure handling; they do not retrospectively turn those specific recorded observations into failures.
- The build-network evidence supports “bridge TCP timed out; host-network build succeeded.” It does **not** locate the fault outside the VM. Mark that cause unknown unless additional evidence establishes it.
- In the driver, RB1 reads `<home>/runtime.env` rather than the actual `<home>/state/runtime.env`. A failed read can look like zero peer lines. Correct the path and require a successful state read while addressing R2.
- RE1 logs the rehearsal VM's sink-positive controls but does not include their success in its verdict. Require both controls to succeed; the submitted run's log reports both did.
- The Swagger harness checks “no operation request before Execute” before entering Try-it-out, then records its request baseline after Try-it-out. Add a negative case for a request emitted at Try-it-out, and compare exact URL origins rather than string prefixes. These are evidence-quality improvements; no automatic Swagger operation or external request was demonstrated in the submitted browser run.
- Overpass shutdown and the original readiness observation remain separate recorded items. No data-image change, Iran reimport or load test is requested in this correction.

## Next authorized work

Correct R1–R4 on the existing feature branch, retain accepted work and failed evidence, and add meaningful failing-before/passing-after tests. No live rollout or device trust change. Most corrections are host scripts/tests/docs; do not rebuild unchanged images. If an OPS helper changes, rebuild/relock only its affected image and prove data identities unchanged.

Use the same-VM maintenance policy only if a real targeted rehearsal needs resources: verified backup/resume path, gracefully stop the original inner stack through its own installed CLI, retain the outer host/data, run serial disposable work and resume/verify the original installation before finishing. Do not stop it for recording-stand-in tests.

Export a fresh verified operator-readable bundle if its shipped scripts change, retain the previous bundle, and rerun affected bundle checks plus the targeted disposable relay/rollback/egress/cleanup rehearsal. Report exact evidence and any remaining limits. Keep the owner manual-push workflow, main unchanged and PR draft. Do not merge this reference branch.

Independent executable and JSON evidence accompany this review. Its exit 0 means the stated defects reproduced; it is not a passing product verdict.
