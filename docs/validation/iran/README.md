# Real-Iran validation runs

Each run has its own directory, its own run identity and its own image lock. Earlier runs and the synthetic phase-1 evidence under `docs/evidence/` are historical and are not overwritten.

| Run | Environment | Source | Directory |
| --- | --- | --- | --- |
| `vm2-2026-10-18` | Owner's replacement VM `seyra` (VMware guest, Ubuntu 26.04 LTS, 4 vCPU, 7.2 GiB RAM, 100 GiB ext4 root) | Owner-supplied `iran-261017.osm.pbf`, SHA-256 `7060fbb5b6ae23acb20b3a376df8404ebec43c81fbc3b71b78f7cbf9c312198f`, header timestamp `2026-10-17T20:20:51Z` | [`vm2-2026-10-18/`](vm2-2026-10-18/README.md) |

The previous VM (4 cores, 8 GB, PBF in `/home/user`) was replaced after insufficient storage and other problems. No result from it is recorded in this repository, and none of its state (checkout, images, logs, partial releases) exists on the replacement VM, so nothing from it was reused or inspected.

Inputs that are still owner decisions are listed in `docs/validation/IRAN_VALIDATION_INPUTS.md` on the review branch: approved place/address queries with expected areas, representative routing points and restrictions, concurrency and latency targets, LAN CIDRs/DNS/certificates, and a second real snapshot for an update test.
