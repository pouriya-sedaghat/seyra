# Iran Map Services validation inputs

This intake is for validating the implemented Map Services with real owner data. It does not start Authentication, Relations, SOS or mobile implementation.

**Latest owner update, 2026-10-18:** the previous VM had insufficient storage and other unspecified problems, and has been replaced. The new VM is connected to Claude Desktop and a new Claude Code session has been created. **The new VM's OS, CPU, RAM, storage, Docker state, checkout, PBF path and bundle availability have not been supplied or verified.** The older VM details below are historical and must not be applied to the new VM. Start with `prompts/CLAUDE_IRAN_NEW_VM_RESTART.md`; earlier authorization for online preparation remains in effect when Internet access is available.

Owner update, 2026-10-17: a VM on a Windows host has been prepared with **4 CPU cores and 8 GB RAM**. Docker is installed, Claude Desktop is connected to the VM, and the Iran PBF is in `/home/user`. These are owner-reported facts. Guest OS/architecture, actual shell access, Docker daemon resources/context, disk capacity/filesystem, exact PBF filename and local Seyra image/bundle availability still require inspection. The directory path does not by itself establish the guest OS or Docker bind-mount visibility.

Owner clarification, 2026-10-17: **the VM has Internet access and may be used for setup, testing and image acquisition.** It may host an online preparation phase followed by an isolated offline product-validation phase. Online acquisition of pinned software/images is authorized during preparation; it does not relax the zero-external-dependency requirement for Seyra's operational installation from the prepared bundle, imports, startup, assets, updates and restore. Do not disconnect the whole VM or the Claude session just to isolate the product.

## Required to start the data import

| Input | Supplied value |
| --- | --- |
| Environment where Claude Code will execute: owner's machine / dedicated VM / dedicated test host | Replacement VM, connected to Claude Desktop with a new Claude Code session. Collect all current host/guest resources; do not reuse the old VM's specifications. |
| Absolute local path to the owner-supplied Iran `.osm.pbf` | Pending on the replacement VM. The old `/home/user` location/filename is historical; verify that the original input was transferred and identify its actual current path. |
| Snapshot timestamp, if the file header does not supply it; do not invent a timestamp | Pending |
| Dedicated Docker host/daemon for this validation, with no existing Seyra deployment | Replacement VM supplied; verify Docker installation/context/isolation, available images and any transferred Seyra state. |
| Absolute SEYRA_HOME on a local Linux filesystem; original PBF stored outside managed release directories | Pending |
| Local install/bundle location and its trusted SHA256SUMS digest | Pending inventory; the online VM may acquire pinned images or use the project's preparation workflow, then produce/load a verified offline bundle. |

Claude Code should collect OS, CPU architecture/cores, RAM, available disk, filesystem type, Docker/Compose versions and existing Seyra containers/networks itself from the named machine. Do not substitute the earlier cloud container's specifications for this host.

A new SEYRA_HOME alone is not isolation: the current CLI uses fixed Docker project and network names. Use a separate host/daemon/VM for this validation. Do not stop or replace another deployment to make the test fit.

## Needed for meaningful quality and performance acceptance

| Input | Supplied value |
| --- | --- |
| Representative cities/regions and rural/border coverage to inspect | Pending |
| Owner-approved Persian/English place/address queries and expected places or acceptable areas | Pending |
| Representative routing points and known access restrictions for car, pedestrian and motorcycle | Pending |
| Expected concurrent operators/clients and main request mix | Pending |
| Required latency/throughput, update downtime and recovery objectives, if agreed | Pending |

If performance targets are unknown, record a baseline with sequential smoke requests; do not declare an SLA or start an unbounded load test. OSM omissions and relevance errors must be distinguished from import/API defects.

## Conditional inputs

- Shared LAN testing: bind address, allowed client CIDRs, internal DNS names and certificate/CA handling. Use loopback until supplied.
- A second real snapshot is needed for a real map-data update test. Re-labeling one PBF with a later date is not a real update.
- Restore drill: space for a second isolated host/daemon and retained inputs. Test the original-owner-file path when capacity permits; otherwise mark it pending.
- Mobile SDK/runtime owner and device scope remain a separate compatibility validation input.

Keep raw data, secrets, private keys, built stores and image archives out of Git. Save only sanitized measurements, checksums, environment metadata and test fixtures appropriate for repository storage.
