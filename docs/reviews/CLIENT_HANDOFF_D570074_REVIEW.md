# Client handoff corrective review at d570074

**Verdict: APPROVED for the owner's normal feature-branch push.** The four findings from the c73db85 review are resolved within the reviewed scope. No further corrective implementation round is requested. Proceed to the remaining issuer/window/device decisions for the existing live LAN cutover plan; this review is not authorization to install device trust or execute that cutover.

## Input and integrity

- Expected local head: `d5700749b68929d86f1f468cc61be41f7d741a64`, `feat/map-services-v1`, reported clean and 21 commits ahead of remote.
- Patch range: `c73db85..d570074`, nine commits.
- Patch SHA-256: `5bf5156ddd99fa9e226e51ed8acf8c97bb257cd8111ed69c61bff848a88c480b`, matches the owner-provided value.
- All **101 changed file versions** match the Git blob IDs before and after applying each mail commit over the already reviewed c73db85 reconstruction, including binary evidence.
- The dependency lock and wrapper are byte-identical to c73db85. No image, contract, npm pin or data-producing input changes occur in this patch. Present image/contract source files in the reconstruction also match the base. No image rebuild or Iran reimport is required for these corrections.

The preceding 12-commit build/rehearsal patch was already reviewed. This approval covers the now corrected cumulative feature work from the pushed `3431e7e` through the local `d570074` head. Review/planning branches are reference material and must not be merged.

## Independent verification

The desired-behavior regressions were executed from the new tree against both the old actual scripts and the fixed scripts:

| Area | c73db85 | d570074 |
| --- | --- | --- |
| Edge trust-removal evidence | 19 of 23 fail | 23/23 pass |
| Namespace sink evidence | 7 of 29 fail | 29/29 pass |
| Volume ownership and cleanup verdict | 24 of 25 fail | 25/25 pass |
| Swagger exact-origin / pre-Execute helper | New helper; old inline behavior covered by the regression | 14/14 pass |

Retained wrapper, handoff pack, development proxy, update gate, host guard, capacity credit, browser navigation/verdict, seeds and actual TLS source checks also pass: **393 existing checks in total**, counting the pack once. Two additional independent edge tests use genuine fractional file ctimes with recording Docker creation metadata: recently applied state allows stop; a runtime file changed after proxy creation is refused without stopping the edge. Both pass.

The reviewer environment uses **Node 24.19.0 and OpenSSL 3.0.13**, not the VM's pinned 24.21.0/3.5. The retained TLS dispatcher/source checks use the previously disclosed minimal layout/entry adapter and explicit unprivileged ownership branch, with real temporary PKI/kernel flock. The new guard checks run the actual shell scripts with recording Docker/ip stand-ins. No Docker daemon, real namespace, browser, live host or owner certificate is touched here.

Ten unchanged Ajv error-contract checks were **not independently rerun** because that dependency is absent in this reconstruction. Full workspace build, typecheck/unit tests, actual image archives, real Docker/browser runs and service recovery were assessed from the submitted evidence rather than executed by the reviewer. No package was installed to expand this review.

The supplied final-tree summary correctly totals **403** standalone checks; **402** refers to the earlier pre-final run. The evidence distinguishes these, so no new correction is required for that count.

## Finding dispositions

### R1 — resolved: volume ownership before use

The rehearsal now inspects the exact named volume on the explicit outer daemon, rejects foreign/unlabelled/uncertain state, verifies the name/local driver/lab label after any create, and refuses if any container uses it. An uncertain inspection is not treated as absence. The repeated inspection catches a foreign create during the create path.

The regression covers foreign, unlabelled, wrong-driver, in-use, failed-inspection/create/list and post-create race cases, plus owned/new paths. The submitted real probes report rejection of planted foreign/unlabelled volumes without mounting them and preservation during cleanup.

### R2 — resolved: positive relay-trust evidence

Ordinary edge stop no longer uses a failed TCP connection as proof. It requires readable saved intent, one plainly running proxy, its applied environment/publication, and runtime-file freshness relative to proxy creation. Down, paused, restarting, stale, unreadable and inconsistent states refuse. The edge's own exact lab address is observed rather than assumed. Unknown edge run state also refuses.

The runtime freshness check uses GNU stat's fractional ctime output. The independent fractional-order tests confirm that recently changed state cannot pass the older-applied-state test in this environment. The real fixture evidence additionally covers configured trust with a closed port, not-yet-applied removal, proxy down after removal, and successful applied removal before stop.

These are read-only checks of the configured serving installation, not a general authorization service. Populate the new private `EDGE_INNER_DOCKER_HOST` and `EDGE_INNER_HOME` correctly, retain sequential operator execution of the documented rollback and do not repurpose emergency force as the ordinary path.

### R3 — resolved: sink evidence and tool errors

Sink acceptance combines internal-network checks, Docker address inventory and bounded failed neighbour resolution without a link-layer address. Ping only triggers the resolution; missing tools, exec/daemon errors and inconclusive results fail. The positive outer sink controls now affect RE2's verdict rather than appearing only in log text.

The new negative regressions pass, and the submitted real run includes the inventory, failed neighbour resolution and both successful positive controls. This does not rely on the historical egress counter that excludes private ranges.

### R4 — resolved: cleanup errors affect success

Required removals, final labelled inventories, directory cleanup and route comparison now accumulate failures and produce nonzero status. Foreign objects are preserved and reported. The explicit retained evidence directory is distinct from leftover lab state. Cleanup can run after its rehearsal VM has already disappeared.

The regression covers failures/uncertainty/leftovers/changed routes and successful cleanup. Submitted real evidence records a deliberately unremovable lab directory causing FAIL/exit 1, followed by successful retry after permissions were restored. The full subsequent rehearsal reports clean cleanup.

## Supporting evidence and accepted scope

- RB1 now reads `state/runtime.env` and requires successful state reads.
- Swagger checks compare exact origins and include operation-open/Try-it-out traffic before Execute. The 14 helper checks pass; supplied real-browser records show normal 16/16 and provider-down 13/13.
- The bridge-TCP cause is explicitly unknown, correcting the unsupported attribution.
- Bundle **r9**, submitted SHA256SUMS digest `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`, changes only shipped edge/operator documentation files relative to r8. Submitted evidence reports byte-identical image archives, successful tamper/offline checks and retention of r8.
- The complete corrected disposable rehearsal reports **32/32** with the guarded relay-stop negatives, TLS/rollback, egress controls and cleanup. Failed and invalid earlier attempts remain distinguishable.
- The original serving installation is reported recovered on its original images, dataset, access and TLS. This reviewer has no VM connection and does not independently certify its current readiness.

The decision not to repeat the unchanged restore drill is reasonable: this patch does not change its image/wrapper/OPS inputs or the certificate restore implementation. No blanket all-image rebuild, duplicate Iran stack or additional load run is requested.

## Next action

The owner may push `feat/map-services-v1` normally from `3431e7e` to the reviewed local head `d5700749b68929d86f1f468cc61be41f7d741a64`. No force, merge or main change. PR #1 stays draft.

After push, use the existing concrete r9 deployment/rollback plan to settle the remaining real issuer, maintenance window and Windows/LAN verification inputs. No separate preparation VM is required again. The earlier stop/resume authorization was for build/rehearsal and does not silently extend to a new live certificate, trust installation or LAN publication.

Keep the recovered original service running until that bounded live step is ready. The original readiness incident, Overpass slow shutdown, mobile, load and Iran search-quality acceptance remain separate pending items; none is claimed resolved by this review. No new broad intake or development feature is requested.
