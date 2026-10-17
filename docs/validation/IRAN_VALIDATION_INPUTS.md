# Iran Map Services validation inputs

This intake is for validating the implemented Map Services with real owner data. It does not start Authentication, Relations, SOS or mobile implementation.

Owner update, 2026-10-17: a VM on a Windows host has been prepared with **4 CPU cores and 8 GB RAM**. Docker is installed, Claude Desktop is connected to the VM, and the Iran PBF is in `/home/user`. These are owner-reported facts. Guest OS/architecture, actual shell access, Docker daemon resources/context, disk capacity/filesystem, exact PBF filename and local Seyra image/bundle availability still require inspection. The directory path does not by itself establish the guest OS or Docker bind-mount visibility.

Owner clarification, 2026-10-17: **the VM has Internet access and may be used for setup, testing and image acquisition.** It may host an online preparation phase followed by an isolated offline product-validation phase. Online acquisition of pinned software/images is authorized during preparation; it does not relax the zero-external-dependency requirement for Seyra's operational installation from the prepared bundle, imports, startup, assets, updates and restore. Do not disconnect the whole VM or the Claude session just to isolate the product.

## Required to start the data import

| Input | Supplied value |
| --- | --- |
| Environment where Claude Code will execute: owner's machine / dedicated VM / dedicated test host | Owner's test VM on a Windows host; 4 cores, 8 GB RAM. Claude Desktop connected; verify Claude Code execution and shell/file access inside the VM. |
| Absolute local path to the owner-supplied Iran `.osm.pbf` | Directory `/home/user` supplied; discover the exact filename read-only. |
| Snapshot timestamp, if the file header does not supply it; do not invent a timestamp | Pending |
| Dedicated Docker host/daemon for this validation, with no existing Seyra deployment | Test VM prepared and Docker installed; daemon/context/isolation and absence of another Seyra deployment not yet verified. |
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
