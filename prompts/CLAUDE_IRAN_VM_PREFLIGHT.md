# Seyra: preflight and Iran validation on the owner's test VM

**Superseded VM facts, 2026-10-18:** the owner replaced the VM after storage shortage and other unspecified problems, and opened a new Claude Code session connected to the replacement VM. Start with `prompts/CLAUDE_IRAN_NEW_VM_RESTART.md` on this review branch. The 4-core/8-GB configuration and `/home/user` path below describe the old VM only. Discover the replacement VM's actual environment, paths and artifacts instead of applying those values.

Execute through Claude Code on the **owner's VM**, not the previous cloud preparation session. Repository: `pouriya-sedaghat/seyra`; implementation branch `feat/map-services-v1`; reviewed head `9f0d7925eef0d43fc157cdd64b557b962df457a6`; PR #1 remains draft. Preserve local work and inspect newer commits if the head has moved.

## Known owner inputs

- The VM runs on a Windows host.
- Assigned resources: 4 CPU cores and 8 GB RAM.
- Docker is installed on the VM.
- Claude Desktop is connected to the VM.
- The owner has downloaded the Iran PBF and placed it in `/home/user`.
- The VM has Internet access. The owner explicitly authorizes using it for setup, testing and image acquisition.

The guest OS, architecture, exact filename, free disk, Docker context/server resources and locally available Seyra images/bundle are not yet known. Do not infer Linux/amd64, terminal access or file visibility from the directory name or Desktop connection. Do not claim 8 GB is sufficient or insufficient for the complete Iran import without inspecting the actual pipeline and observing resources.

## Bootstrap the repository when this is a fresh VM

Canonical repository URL: `https://github.com/pouriya-sedaghat/seyra.git`. It is public. The intended checkout is `/home/user/seyra`. The VM may contain only the PBF initially; `git fetch origin` requires a checkout first. Do not search the signed-in `gh` account's repository list or ask for the clone URL again.

Verify the VM shell's host/user and whether that path is a Git checkout. If the path does not exist, run `git clone https://github.com/pouriya-sedaghat/seyra.git /home/user/seyra` yourself using the VM shell, then inspect its actual exit code/output. If the path exists without a valid checkout, report its contents and do not overwrite or delete it. If it is an existing checkout, inspect its working tree and origin URL; preserve unrelated changes and stop on a different repository rather than changing its remote silently.

After a valid checkout exists, use `git -C /home/user/seyra fetch origin` and read the prompt from the remote-tracking review ref. Inspect `feat/map-services-v1` and preserve local work before selecting the implementation branch for validation. If clone/fetch fails, report the actual command, exit code and sanitized stderr; classify DNS, TLS, network, authentication or refspec errors from evidence. Do not change global credentials, disable TLS verification or claim a clone succeeded based only on a chat message.

Read `CLAUDE.md` and, using `git show` from `origin/review/map-services-pr1-9f0d792`, read:

- `docs/validation/IRAN_VALIDATION_INPUTS.md`
- `prompts/CLAUDE_IRAN_MAP_VALIDATION.md`

That complete validation prompt remains the governing task. This entry prompt supplies the owner's new environment facts and narrows the first actions. Do not merge the review branch.

## A. Read-only inventory, then online preparation on the VM

1. Prove that your shell and repository/file tools run inside the intended VM. Record hostname, guest OS/kernel, architecture and resource totals. The Windows host and the VM guest are different environments. If this Desktop session cannot invoke Claude Code or access a VM shell/files, report the missing capability and the command/session needed; do not execute against the cloud host as a substitute.
2. Inspect the working tree and refs. Collect CPU, total/available RAM, swap, disk capacity/free bytes and filesystem types for the prospective SEYRA_HOME and Docker storage. Do not change VM resources, create swap, reconfigure Docker or delete data as part of preflight.
3. Inspect Docker/Compose versions, active context/daemon endpoint, server OS/architecture, CPU/memory visible to the daemon, existing Seyra containers/projects/networks and locally loaded image IDs. The lock targets Linux/amd64. Confirm that host bind paths will refer to the VM's files on the daemon actually being used; when a pinned local image is available, use a non-mutating read-only mount probe with `--pull never` as needed. Do not assume a remote Docker daemon can read `/home/user` from this VM.
4. List PBF candidates directly under `/home/user` read-only. Discover the actual filename; do not invent `iran.osm.pbf`. If more than one plausible Iran input exists, report names/sizes and ask which to use. Keep the original unchanged. Record its byte size, SHA-256 and, using the pinned local tools when available, header timestamp/counts/bounds. Do not auto-download a replacement or modify the original filename/content.
5. Inventory the local Seyra install tree, bundle and image identities. The VM is an authorized **online preparation environment** at this stage: missing pinned images, source artifacts and development/build dependencies may be acquired using the existing preparation workflow. Prefer loading the previously validated bundle if available. Do not assume custom `seyra/*` image tags are published to a registry. If they are unavailable, use the project's pinned source-build workflow or transfer the existing verified bundle; never substitute arbitrary images/tags. Record provenance and any rebuilt identities with the project's lock-generation workflow and rerun affected validation; never rewrite expected IDs merely to accept an unverified image. Verify/export the resulting offline bundle and its trusted checksum before the operational test phase.
6. Confirm a dedicated test daemon/VM with no conflicting Seyra deployment. The CLI uses fixed project/network names, so a new SEYRA_HOME alone is not isolation. Choose a new absolute SEYRA_HOME on a local Linux filesystem, outside the owner's PBF directory/release inputs. Verify its filesystem and available capacity before init.
7. Evaluate resource feasibility from the real file size and current configuration. Honor the existing free-space check, `max(2 GiB, 40 × input bytes)` at the defaults. This is a guard, not a measured Iran sizing estimate. Inspect build/runtime memory and thread settings, including temporary Nominatim/PostgreSQL and Photon. With 8 GB assigned, account for the guest OS, Docker and concurrent processes; do not silently weaken guards or start an unbounded load test.

Return a compact preflight table: guest OS/architecture, effective Docker CPU/RAM, RAM/swap, storage/filesystem/free bytes, exact PBF path/size/checksum/provenance, bundle/image verification, isolation, and PASS/BLOCKED with concrete reasons. Collect facts from commands instead of asking the owner for values you can inspect.

## B. Offline product validation after preparation

When online preparation is complete and the required inputs, supported environment, locally loaded images and resource guards are satisfied, continue automatically under the complete Iran-validation prompt: installation from the prepared bundle, loopback TLS, init, a full local import with resource monitoring, staging validation, verify-release, activation and initial real-Iran smoke checks in this dedicated environment. The same VM may perform both phases; keep their dependencies, network scope and evidence distinct.

Prove offline product operation by denying/capturing external egress for the relevant product/test namespaces and auditing client requests, without changing the Windows/VM host's global firewall or cutting off the Claude session. Online preparation downloads are permitted and recorded separately. The isolated operational install/import/start/update/restore and all map assets must make zero outside-network attempts; do not exclude product-controlled calls from the audit. Keep all four services mandatory. Preserve original data and record import step timings, disk usage/minimum free space, observed memory/CPU and source/dataset/image identities. Stop cleanly and report a measured resource failure if the import cannot complete; do not label a subset or partial import as nationwide validation.

If preflight is blocked, finish the useful read-only inventory and report only the exact missing inputs or resource corrections. Do not replace the pending checks with fabricated PASS results or perform a fallback cloud import. Quality/SLA targets may remain pending while sequential smoke measurements are collected; do not invent acceptance thresholds.

Keep raw PBFs, stores, image archives, credentials and private keys out of Git. Commit sanitized validation evidence on `feat/map-services-v1`, push normally, and keep PR #1 draft. Do not merge, force push, alter main or begin another module.
