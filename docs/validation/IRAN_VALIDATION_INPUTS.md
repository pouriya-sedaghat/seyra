# Iran Map Services validation inputs

This intake is for validating the implemented Map Services with real owner data. It does not start Authentication, Relations, SOS or mobile implementation.

## Required to start the data import

| Input | Supplied value |
| --- | --- |
| Environment where Claude Code will execute: owner's machine / dedicated VM / dedicated test host | Pending |
| Absolute local path to the owner-supplied Iran `.osm.pbf` | Pending |
| Snapshot timestamp, if the file header does not supply it; do not invent a timestamp | Pending |
| Dedicated Docker host/daemon for this validation, with no existing Seyra deployment | Pending |
| Absolute SEYRA_HOME on a local Linux filesystem; original PBF stored outside managed release directories | Pending |
| Local install/bundle location and its trusted SHA256SUMS digest | Pending |

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
