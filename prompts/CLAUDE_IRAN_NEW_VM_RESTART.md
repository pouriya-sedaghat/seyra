# Seyra: restart Iran validation on the replacement VM

You are starting a **new Claude Code session on the owner's replacement VM**. Treat this prompt as the current handoff. The previous VM was replaced because storage was insufficient and other problems occurred. Do not assume its specifications, paths, Docker images, checkout or failed build state exist on this VM.

## Project and current task

- Canonical public repository: `https://github.com/pouriya-sedaghat/seyra.git`.
- Implementation branch: `feat/map-services-v1`; PR #1: `https://github.com/pouriya-sedaghat/seyra/pull/1`.
- Last reviewed implementation head: `9f0d7925eef0d43fc157cdd64b557b962df457a6`.
- Main is the documentation baseline. Map Services implementation already exists on the feature branch. Do not restart implementation from main.
- R1–R5 review findings were corrected and the targeted follow-up review passed. Prior synthetic/cloud test results are historical, not validation on this VM or on Iran data.
- Current work: prepare the replacement VM and validate the existing Map Services with the owner's Iran OSM file. Authentication, Relations, SOS and mobile application implementation are outside this task.

Use Claude Code with the actual VM shell and filesystem. The Desktop connection alone is not evidence that a command ran. Report actual host/user, commands, exit codes and sanitized errors. Do not replace VM execution with the former cloud preparation session.

## 1. Establish the checkout safely

Identify the VM's hostname, OS/kernel, current user, home directory and working directory. Use an existing verified Seyra checkout if present. Otherwise, if `$HOME/seyra` does not exist, run:

```sh
git clone https://github.com/pouriya-sedaghat/seyra.git "$HOME/seyra"
```

Do this yourself in the VM shell; the URL is already provided. Do not enumerate unrelated repositories in the `gh` account or ask the owner for the URL again. If the destination exists without a valid checkout, inspect and report it without overwriting/deleting it. Preserve all existing work.

In the verified checkout, inspect `git status --short --branch`, origin URL and refs, then run `git fetch origin`. If origin points to another repository, report it rather than silently changing it. Inspect any commits newer than the reviewed head and preserve them; never reset to the old SHA.

Read `CLAUDE.md` and the current Map Services brief, requirements, architecture, acceptance register, RUNBOOK, TEST_RESULTS and IMPLEMENTATION_STATUS. Read these review-branch files with `git show` (do not merge the review branch):

```sh
git show origin/review/map-services-pr1-9f0d792:docs/reviews/PR1_9f0d792.md
git show origin/review/map-services-pr1-9f0d792:docs/validation/IRAN_VALIDATION_INPUTS.md
git show origin/review/map-services-pr1-9f0d792:prompts/CLAUDE_IRAN_MAP_VALIDATION.md
```

If the review ref was omitted by a single-branch fetch configuration, fetch it explicitly:

```sh
git fetch origin refs/heads/review/map-services-pr1-9f0d792:refs/remotes/origin/review/map-services-pr1-9f0d792
```

Select the existing `feat/map-services-v1` branch when local work permits, or create its local tracking branch from origin if absent. Do not develop on main or merge the review branch. The complete Iran-validation prompt governs the task; this handoff overrides its historical VM assumptions.

## 2. Inventory this VM and the actual source before large downloads or imports

Collect CPU architecture/cores, RAM/available memory, swap, guest disk capacity/free bytes/inodes and filesystem types. Inspect Docker/Compose availability, active context and daemon OS/architecture/resources, Docker storage location and its filesystem/free space, existing Seyra containers/networks, loaded images and any transferred state. Verify bind-mount paths resolve on the actual Docker daemon, not another machine. The locked runtime targets Linux/amd64 and local Linux storage for SEYRA_HOME.

The previous 4-core/8-GB configuration is not a specification for this replacement. Do not assume the PBF is still `/home/user/iran-261016.osm.pbf`. Inspect the connected workspace and likely user-supplied locations with a bounded search, then ask for its actual path only if missing or ambiguous. Verify the owner's original file is present, readable and complete, record its exact size/SHA-256 and header/counts/bounds with the pinned local tools, and preserve it unchanged. Do not auto-download another country extract or invent its snapshot time.

If logs or failed releases from the old VM were transferred, inspect them read-only and distinguish input/software/resource failures. Do not infer unreported causes. Reuse a built release only if the existing CLI verifies its manifest/artifacts and required image identities; do not blindly reuse partial indexes or delete lock/state files to make it run. Recover unfinished transitions/imports through the documented CLI where applicable.

## 3. Storage feasibility is a gate

Before acquiring large artifacts or starting the Iran import, show the relevant mount points and a capacity table. Account for what is already stored versus additional space needed: owner input, managed source copy, loaded image layers, bundle archives or preparation build cache, render database, routing graph, temporary geocoder database/dump/index, Overpass XML/base, staging/retained releases and any planned backup/restore target. Avoid double-counting shared mounts, but do not assume free space on a different mount is usable. Report uncertainty explicitly.

Honor the current import guard. At defaults it requires free space of at least `max(2 GiB, 40 × PBF byte size)` at the managed home before import. Check again after preparation/image loading and before import, since preparation consumes disk too. That multiplier is a guard, not a measured Iran storage guarantee; monitor free disk/inodes throughout the run. Where relevant and accessible, note limits of thin-provisioned virtual/backing disks instead of treating virtual capacity as physically reserved space.

Do not lower the guard to force a run, delete unrelated data, run a broad `docker system prune`, reformat disks, or alter VM storage merely to clear a failed check. If capacity is insufficient, stop before the expensive phase and return measured available bytes, the applicable guard and a concrete additional-capacity estimate with its assumptions. Continue useful read-only inventory so the owner gets a precise blocker rather than a generic request to resize.

## 4. Online preparation is authorized

The owner authorized Internet use for setup, testing and acquiring pinned images/build dependencies. Check current connectivity; the new VM may perform online preparation followed by isolated offline product validation. Prefer loading the existing verified bundle if available. Custom `seyra/*` image tags are not assumed publicly pullable: use the pinned project preparation/source-build workflow or transfer the verified bundle when needed. Do not substitute arbitrary versions, disable required providers or rewrite expected image IDs simply to accept an unverified image. Record any rebuilt provenance/identities using the project's lock workflow and rerun affected checks before use.

Check resources before source builds as well as before data import. Transfer/acquire the needed material when supported, verify/export a complete offline bundle, and record its checksum and actual image identities. Preparation downloads are permitted and must be recorded separately from operational evidence.

## 5. Continue the real-Iran validation when ready

Use a dedicated test daemon/VM with no conflicting Seyra deployment. The CLI has fixed Docker project/network names; a new SEYRA_HOME alone is not isolation. Keep the original PBF outside managed release directories and select a verified local Linux filesystem for SEYRA_HOME. Use loopback TLS by default. Shared LAN needs actual CIDRs, DNS and certificates.

When the supported environment, input, images and storage/memory checks are satisfied, proceed without another routine confirmation: install from the prepared bundle, init, full Iran import with resource monitoring, staging validation, verify-release, activate and sequential real-Iran web/API smoke checks under the complete validation prompt. Keep all four capabilities mandatory: tiles, routing, geocoder and Overpass.

Prove Internet-independent product installation/import/start/assets/update/restore using scoped test/product network isolation and capture while keeping the VM and Claude session accessible. Do not change the host's global firewall. An Internet-connected host successfully serving a map alone does not prove offline operation.

Record step durations, storage/minimum free space and observed CPU/memory with the sampling method. Stop cleanly and preserve sanitized evidence if resources fail. Do not mark a partial/subset import as full-Iran validation. Keep synthetic fixture regressions separate from Iran queries; quality expectations and SLA/load targets require owner inputs, not invented thresholds. Use actual owner locations/queries where supplied, and label exploratory smoke results accordingly.

## 6. Checkpoints and delivery

Begin with an environment/source/storage readiness table and exact missing inputs, if any. If ready, continue the task rather than ending at a plan. If blocked, complete independent safe checks and report the concrete blocker and next command/action. Do not claim that the prior session's work or tests were reproduced here.

Save sanitized results/provenance/reproducible commands under `docs/validation/iran/` on the existing feature branch and update the status/test records with a separate replacement-VM run identity. Preserve historical evidence. Keep PBFs, generated stores, image archives, secrets and private keys out of Git. Push normally; keep PR #1 draft. Do not merge, force push, alter main or start another module.

Return: current head, actual VM resources, exact source/checksum, capacity decision, preparation/bundle/image identities, completed versus blocked/not-run tests, resource/quality observations and the next concrete step.
