# Client handoff execution on the single available VM

Status: owner-authorized preparation and disposable rehearsal; live LAN deployment remains pending.

Reviewed implementation: `3431e7e7330acb0e1184fd4d9c3204ab7f480ee7`, feature branch `feat/map-services-v1`. The owner pushed this head normally. Source approval and evidence are on `review/client-handoff-3431e7e`; review/planning branches are reference material, not merge inputs.

The owner has only this VM and offered a reset if needed. Retain the installation and release RAM by gracefully stopping its inner service stack. Keep the outer nested-Docker host, network and volumes. This bounded pause/resume avoids a new Iran import and preserves the previously verified installation as the recovery target.

| Stage | Allowed work | Required exit condition |
| --- | --- | --- |
| Preflight | Verify both daemon identities, source, resources, old images/installation and recovery material | Durable private recovery instructions and a verified resume path exist |
| Maintenance | Stop the inner stack through its own installed CLI | Clean service shutdown; outer host/networks/volumes retained; sufficient resources |
| Preparation | Sequential API, proxy and OPS builds; inspected lock; offline bundle and client pack | Data-producing identities unchanged; old nested installation untouched |
| Validation | Sequential synthetic suites, actual Swagger browser checks and disposable relay/TLS/rollback rehearsal | Honest recorded verdicts; measured resource/outage/rollback evidence |
| Recovery | Dispose only owned lab workloads, then start the old installed stack | All four original providers ready with expected identities and original access/TLS |
| Handoff | Commit sanitized evidence and a concrete live cutover plan | Manual push retained, PR draft, live LAN/trust/deployment still pending |

The old always-running-host watchdog must not flag the authorized pause as an incident. During maintenance supervise VM resources and the currently active test service. Stop the current workload for available memory below 1.5 GiB, swap growth above 512 MiB, inadequate remaining disk budget or unexpected persistent test-service degradation. Do not overlap heavy workloads.

No broad cleanup is required or authorized by this plan. Remove only exact, positively identified disposable artifacts if space requires it. Retain source, original PBF, current/previous stores, control database, TLS/secrets, operator records and resume/rollback images/bundle. Do not bypass harness ownership guards, restart the outer host, prune globally, delete volumes or deploy new images to the preserved nested daemon.

If the measured resources are still insufficient, stop the new work, resume the original service and report the capacity shortfall. The fallback is not an automatic reset.

Temporary fixture PKI lets the rehearsal proceed without a company-CA decision. Trust installation and the real LAN cutover remain later owner decisions after concrete rehearsal evidence. No fixed downtime estimate is promised; actual maintenance and fixture cutover intervals are reported separately.

Full execution prompt: [CLAUDE_MAP_HANDOFF_SHARED_VM_BUILD_REHEARSE.md](../../prompts/CLAUDE_MAP_HANDOFF_SHARED_VM_BUILD_REHEARSE.md).

This plan changes authorization and execution order only. It is not evidence that the new images, Docker topology or browser behavior have passed yet.
