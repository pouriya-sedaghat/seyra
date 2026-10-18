# Run `vm2-2026-10-18`: replacement VM, owner's Iran snapshot

Run identity: **`vm2-2026-10-18`**. This is the first run on the owner's replacement VM. It does not reproduce or continue anything from the previous VM or from the 2026-10-14/17 cloud preparation container. Those results remain in `docs/TEST_RESULTS.md` and `docs/evidence/` as historical synthetic evidence.

- Code under test: `feat/map-services-v1` at reviewed head `9f0d7925eef0d43fc157cdd64b557b962df457a6`, plus `f244a25` (relock only; no product code change).
- Executed by Claude Code in the VM's own shell, as the local user `owner` (Docker group, no passwordless sudo).

## Outcome

**BLOCKED by a product defect at `geocoder-build`.** The full Iran import ran offline through source validation, the render database and the Valhalla graph, and Nominatim exported 1,199,311 places. Seyra's own preprocessing of that export (`apps/ops/src/geocoder-preprocess.ts`) then failed with `TypeError: text.normalize is not a function`. Cause: Photon 1.3.0 writes unmatched address lines as string arrays (`address.other`, `other:fa`, `other:en`), and 1,191,816 of the exported places carry them. The synthetic fixture never produced them. Details, reproduction and the proposed correction: §6.

Following the handoff, product code was **not** changed in this run. The release is marked `failed` and preserved on offline host 1. No activation, API/web smoke, Iran browser audit, restart, backup or restore on Iran data has run yet.

| Area | Result |
| --- | --- |
| Checkout, environment, source and storage preflight | Done; ready (§1–§3) |
| Online preparation: sources, image builds, relock, bundle | Done (§4). Bundle `SHA256SUMS` `71078a6c…`. One defect: root-only bundle archives (§4). |
| Synthetic regression on the rebuilt images | All PASS: unit 146, integration 137, security 28 (+1 note), lifecycle L1–L14, tamper T0–T5, offline host O0–O5, restore drill R1–R7 + R4a, browser (§5) |
| Iran offline host 1: isolation, bundle install, init/TLS, capacity recheck | PASS (I0, I1, I2, I3a) |
| Iran import | **FAIL at `geocoder-build`** (I3), after render-import and routing-build succeeded |
| Outbound packets from offline host 1 (install + import) | 0 |
| Iran verify-release, activation, API/web smoke, browser, restart, backup, restore from original input | **NOT RUN**: blocked by the defect |
| Real update test | NOT RUN: needs a second real snapshot |
| Quality acceptance / load | NOT RUN: owner-approved queries, locations and targets not supplied |


## 1. Environment preflight (measured, 2026-10-18 08:30–08:35 UTC)

Raw output: [`preflight/environment.txt`](preflight/environment.txt).

| Item | Measured on this VM | Assessment |
| --- | --- | --- |
| Host | hostname `seyra`, VMware guest (`systemd-detect-virt`), Ubuntu 26.04 LTS, kernel 7.0.0-38-generic, x86_64 | linux/amd64 as locked. The runbook reference is Ubuntu 24.04; 26.04 is newer and has not been validated before. |
| CPU | 4 vCPU (Intel Core i5-12400, 4 sockets × 1 core, 1 thread each) | Matches the owner's 4-core description. |
| Memory | 7,734,890,496 B total (7.2 GiB), 6.84 GB available at start; 4 GiB swap file | About 0.8 GB less than the "8 GB" description; the guest reports 7.2 GiB. |
| Root filesystem | `/dev/mapper/ubuntu--vg-ubuntu--lv`, ext4, local block device, 105,089,261,568 B; 91,348,471,808 B free; 6,442,606 free inodes | One mount holds `$HOME`, the PBF, Docker's data root and the validation home. Nothing is double-counted. |
| Unused disk | `sda` is 300 GiB; LVM PV `sda3` 319,971,917,824 B, root LV 107,374,182,400 B. About 212.6 GB of the PV is not assigned to the root LV. | Not touched. `vgs` needs root, so VG free space is inferred from `lsblk`. Whether the VMware disk is thin-provisioned on the host, and how much physical space backs it, cannot be seen from inside the guest. |
| Docker | Engine 29.9.1, Compose v5.6.0, context `default` (local unix socket), `/var/lib/docker` with the containerd snapshotter, on the root filesystem | Local daemon, so bind mounts resolve on this VM. |
| Existing Docker state | No containers, networks or volumes besides the defaults. Two unrelated images (`busybox`, `curlimages/curl`) were present at 08:30; the owner's interactive session deleted them at 08:32:44 UTC (Docker event log). | No Seyra deployment to conflict with. Nothing was deleted by this run. |
| Transferred state | No Seyra checkout, bundle, images, logs or releases | Prepared from pinned sources (§3). |
| Checkout | `$HOME/seyra` did not exist; cloned from `https://github.com/pouriya-sedaghat/seyra.git` | Origin is the canonical repository. |
| Internet | GitHub, Docker Hub, ghcr.io, PyPI, npm, nodejs.org and the Ubuntu/Debian archives reachable; no proxy variables | Used only for preparation (§3). |

## 2. Source file

| Item | Value |
| --- | --- |
| Path | `/home/owner/iran-261017.osm.pbf`, owner-supplied, left in place, mode `0644`, never modified |
| Size | 229,845,082 B |
| SHA-256 | `7060fbb5b6ae23acb20b3a376df8404ebec43c81fbc3b71b78f7cbf9c312198f` |
| Header (pinned osmium 1.19.1) | generator `osmium/1.16.0`; `osmosis_replication_base_url` `https://download.geofabrik.de/asia/iran-updates`; sequence 4940; **`osmosis_replication_timestamp` 2026-10-17T20:20:51Z** (used as the snapshot time; no operator timestamp was needed or invented) |
| Header box | 44.023033, 24.039475, 63.35413, 39.790447 |
| Data box | 43.315691, 24.813511, 64.3179533, 46.9863421. The extract keeps complete ways and relations, so it extends beyond Iran's borders (for example into the Caspian and its neighbours). |
| Counts | 27,001,241 nodes; 3,396,283 ways; 99,075 relations; sorted, no history; last object timestamp 2026-10-17T20:14:22Z |
| Completeness | `osmium fileinfo -e` read the whole file without error (CRC32 `cc663681`). |

Raw: [`preflight/iran-pbf-fileinfo.json`](preflight/iran-pbf-fileinfo.json).

**Measured tag coverage** ([`preflight/iran-pbf-tag-coverage.tsv`](preflight/iran-pbf-tag-coverage.tsv); `osmium tags-filter -R`, counts of nodes/ways/relations carrying the tag, so features outside Iran in the extract are included):

| Tag | Objects | Note |
| --- | --- | --- |
| `addr:housenumber` | 19,754 | Sparse. Exhaustive house-number search cannot be promised for this snapshot. |
| `addr:street` | 66,994 | |
| `addr:postcode` | 6,019 | Postcode search is not representative. |
| `addr:city` | 59,198 | |
| `name` | 1,220,773 | Persian primary names live in `name`. |
| `name:fa` | 21,641 | Rare. Display relies on `name`, which is mostly Persian already. |
| `name:en` | 235,066 | English labels fall back to `name` elsewhere. |
| `amenity` / `shop` / `tourism` / `healthcare` | 141,131 / 75,638 / 12,595 / 16,591 | |
| `place=city,town` / `village,hamlet` (nodes) | 1,568 / 46,248 | |
| `amenity=hospital` / `pharmacy` / `fuel` / `police` / `fire_station` / `school` | 2,097 / 4,464 / 5,817 / 3,582 / 1,049 / 16,682 | |
| ways: `highway` / `building` | 2,136,485 / 565,145 | |
| ways: `highway=motorway,trunk,primary` / `oneway=yes` / `access=no,private` / `motorcycle=no` / `route=ferry` | 57,088 / 254,091 / 24,456 / 445 / 22 | Only 445 ways carry an explicit motorcycle prohibition, so national motorcycle rules (for example on freeways) are not represented in the data unless tagged. |

## 3. Storage feasibility (the gate)

The import guard at defaults is `max(2 GiB, 40 × 229,845,082 B)` = **9,193,803,280 B**. It is a guard, not a measured Iran requirement.

| Checkpoint | Free bytes on `/` | Guard | Decision |
| --- | --- | --- | --- |
| Preflight, before any download | 91,348,471,808 | 9,193,803,280 | pass |
| After sources, base images, all image builds and the bundle export (09:13) | 71,871,873,024 | 9,193,803,280 | pass |
| Inside the offline host after `bootstrap-load`, immediately before the import (09:37) | 67,246,477,312 | 9,193,803,280 | pass (also enforced by the importer itself) |

What was already stored, and what this run added (single mount, so there is no double-counting):

| Item | Bytes | Source |
| --- | --- | --- |
| Owner input (outside managed directories) | 229,845,082 | `stat` |
| Pinned sources and artifacts (`seyra-prep/sources`) | 604,906,163 | `du -sb` |
| Base images + built images on the VM daemon (incl. Playwright 3.68 GB and DinD 0.51 GB test tooling) | 9.34 GB | `docker system df` |
| Build cache from the source builds | 9.30 GB | `docker system df` |
| Offline bundle (10 archives + install tree) | 1,297,861,727 | `du -sb` |
| Images loaded into the offline host from the bundle | see §5 | `docker system df` inside the offline host |
| Release stores, render DB, temporary geocoder DB, retained release, backup | see §5 | measured during the run |

The build cache was kept for provenance; it is this run's own preparation data and could be pruned with `docker builder prune` if space becomes short. No unrelated data was deleted, and the guard was not changed.

## 4. Preparation (online, authorized; separate from operational evidence)

The previous verified bundle (`SHA256SUMS` `5cf828a9…`) was not available on this VM, so every image was rebuilt with the project's preparation workflow (RUNBOOK §10). Logs: [`preparation/`](preparation/).

| Step | Result |
| --- | --- |
| `fetch-sources.sh` | rc 0, 285 s. All 8 source commits match `sources.json`. `photon-1.3.0.jar` and `nominatim_db-5.3.2-py3-none-any.whl` match their pinned SHA-256 (the wheel's PyPI JSON digest equals the pin). |
| Base images by digest | 6 pulls, 280 s, directly from Docker Hub (no mirror, no 429s). `postgis/postgis` resolved to the locked ID `01a6a70e…`. |
| `build-images.sh` | rc 0, 1,603 s (08:44–09:10 UTC). Sampled every 30 s: minimum 4.15 GB memory available, swap ≤ 24 KB, peak load 4.24. |
| `write-lock.mjs` (`f244a25`) | All nine custom image IDs changed; DB unchanged. Reported versions, base digests, Dockerfiles, npm lockfile and map-asset digest `8f7bcaf8…` unchanged. OS package lists differ for Valhalla, Overpass and geocoder-build, because apt is not snapshot-pinned. |
| Unit/contract | `npm ci` + `build` + `test`: 146 passed (12 + 6 + 46 + 82). `npm run typecheck` passes once `build` has produced the workspace `dist`; run first on a fresh checkout it fails with `Cannot find module '@seyra/contracts'` (an ordering note, not a product defect). |
| `bundle export` / `bundle verify` | rc 0 / rc 0. 10 archives (1,297,591,808 B) + 17 install files. **`SHA256SUMS` digest `71078a6c87fcb8fb897cd5b45b4ddcc67ee253c9a748812b408318626281a243`.** |
| Test tooling (never in the bundle) | `docker:29.8.2-dind` `1e08cdb6…` (same as the earlier offline evidence), `mcr.microsoft.com/playwright:v1.56.1-noble` `f1e7e010…` with npm `playwright@1.56.1`, `busybox:1.37.0` `bdf57e52…` (security AC16.3 probe), Node 24.21.0 (nodejs.org tarball, SHA-256 `fd8e59d5…` matched against `SHASUMS256.txt`; signature not checked), and `seyra-test-runner:local` (`tests/validation/runner.Dockerfile`). |

Image identities now locked (`infra/dependencies.lock.json`):

| Role | Image ID |
| --- | --- |
| DB | `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` (unchanged) |
| TEGOLA | `sha256:4379ed15b436599a68b7908c8b35767c586801273eeca725ca144926e5e0757f` |
| VALHALLA | `sha256:df4afb12dd7e4d5a110178d3a931facc206239470dc043c38dd117af331defc3` |
| PHOTON | `sha256:46112b0677bb6866b8c7c5c55d883d5c302264f7c855a5bc4a5fefac745f97b2` |
| OVERPASS | `sha256:44d8f7a9837f953d34122189a716c663263a7e6a531104548f37c5604c4b85fa` |
| API | `sha256:ad11e92b08790044a31c23bf16a61bd6689fdeda1f7241f2c41dce4d59d36b00` |
| PROXY | `sha256:07e3eca26da70c86cf69cb4538dbcac9eb163ad507a574eb411d561d005e233c` |
| OSMTOOLS | `sha256:a6803a35f3a1ed2d059bb170e7e2efdabd31567412c33b94ccd518b6678acfc0` |
| GEOCODER_BUILD | `sha256:ee886ca3890b697b2117919c1dcff389988ee782fb5c1bf20a61c90be8f80057` |
| OPS | `sha256:8a7ee6f7ed8f80f16fe2966ae0c3683718b701d9d0f1488e8476bd09cf196078` |

Because the data-component IDs feed `dataset_id`, releases built with the old lock cannot be served by these images; this is by design.

### Defect found during preparation: root-only bundle archives

`bundle export` runs `docker save -o` as root inside the ops container. The archives come out as `root:root 0600`, the directories as `root:root 0755` ([`preparation/bundle-modes-as-exported.txt`](preparation/bundle-modes-as-exported.txt)). An operator without root therefore cannot run the RUNBOOK §2 host-side `sha256sum -c SHA256SUMS`, copy the bundle, or `bootstrap-load` it: the wrapper's own `sha256sum` of the ops archive gets "Permission denied". The cloud runs executed as root, so they did not see this.
- Workaround used here: the bundle directory was handed to `owner` with a one-off container `chown -R` (ownership only). `SHA256SUMS` was re-verified afterwards and is unchanged.
- Proposed correction (not implemented in this task): after `docker save`, make archives `0444` and chown the bundle tree to the invoking host user (pass `--user`/the UID to the ops container, or `chown` to the `--out` directory's owner). Then document the expected modes in RUNBOOK §2 and §10.

## 5. Synthetic regression on the rebuilt images (fixture only, not Iran)

The rebuilt images had to pass the image-dependent suites before use. Fixture `synthetic-v1.osm.pbf` rebuilt by `fixtures/osm/build-fixture-pbf.sh`: SHA-256 `e90c33a29619db99…`, byte-identical to the recorded fixture. Release IDs change with the image IDs: A = `ds-20261001-9843cf36a06e`. Evidence: [`synthetic-regression/`](synthetic-regression/).

| Suite | Result on this VM |
| --- | --- |
| Fixture import + staging + activate (VM daemon) | PASS: import 79 s, activate 14 s |
| Integration (`tests/integration`, vitest) | **137/137 PASS** (5 files) |
| Security (`check-ingress-roles.sh`) | **28 PASS, 0 FAIL**, plus NOTE AC16.3b (host-local bridge reachability). The first attempt failed AC16.3 only because the test's `busybox:1.37.0` probe image was absent; it was pulled and the suite re-run. |
| External URL inventory (`scan-external-urls.sh`) | PASS: 0 unclassified |
| Lifecycle L1–L14 (`lifecycle.sh`) | **15/15 PASS** in 552 s. L4/L5 not-ready windows 28.5 s; L3 130.5 s. In L14 this time `prune` started after `start` had finished (owner sequence `stop` killed → `start` → none → `start` → none), so the "refused as busy" branch was not exercised in L14; L10, L11, L13 and `lock-race.test.ts` cover it. |
| Bundle tamper T0–T5 | **6/6 PASS**; bundle byte-identical afterwards (`71078a6c…`) |
| Offline host O0–O5 (DinD on an internal network) | **6/6 PASS**: 10 images loaded with locked IDs, fixture import/activate/restart/update/rollback offline, **0 outbound packets** (7 link-local IGMP reports counted separately). The offline host derived the same `dataset_id` as the preparation host. |
| Synthetic fresh-host restore drill (`restore-drill.sh`) | **8/8 PASS** (R1–R7, R4a) in 473 s: two generations plus an interrupted attempt, damaged generation refused before any DB change, newest complete generation selected, both releases rebuilt with the same dataset IDs, 0 outbound packets |
| Browser (`tests/browser/web-client.mjs`, Playwright 1.56.1 Chromium) | PASS: 62 requests, 0 external, 0 RTL-plugin, 0 failed, 0 console errors; light/dark × fa/en screenshots in `synthetic-regression/browser/` |

The lifecycle, security, tamper and offline harnesses assume root: they read `0400` secrets owned by container UIDs and change provider-owned paths. They were run unchanged inside `seyra-test-runner:local` (root in a container with the Docker socket), which gives no access beyond the `owner` account's Docker group.

## 6. Real-Iran run on an isolated offline host

Harness: [`tests/validation/iran-offline-host.sh`](../../../../tests/validation/iran-offline-host.sh). It uses the isolation of `tests/offline/offline-host.sh`: a fresh `docker:29.8.2-dind` daemon on a Docker `--internal` network, with a sink default route and iptables egress counters in its own network namespace. The VM's firewall and the Claude session's connectivity were not touched, and the owner's PBF is bind-mounted read-only, alone. The harness runs as the non-root operator and does root-owned file work inside the offline-host container. `SEYRA_HOME=/home/owner/seyra-lab/home` is on the VM's local ext4 root (flock enforced). Ingress is loopback `127.0.0.1:8443` inside the offline host.

```bash
BUNDLE=$HOME/seyra-prep/bundle-2026-10-18-vm2 PBF=$HOME/iran-261017.osm.pbf LAB=$HOME/seyra-lab \
DIND_IMAGE=docker:29.8.2-dind OUT=$HOME/seyra-prep/iran-ev PHASES="install import serve browser" \
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.56.1-noble PLAYWRIGHT_DIR=$HOME/seyra-prep/playwright \
  tests/validation/iran-offline-host.sh
# then, on the same host: PHASES="backup restore" (fresh second host; rebuild from the original PBF)
```

**Attempt 1 (aborted, 09:33–09:35 UTC; [`iran-run/attempt-1-aborted/`](iran-run/attempt-1-aborted/)).** The inner daemon's socket was `root:2375 0660`, so every non-root `docker` call to it was denied. I0 nevertheless reported PASS, because "0 images" was read from a failed call. This was a harness defect: no import ran. The harness was fixed before the next attempt: `dockerd --group $(id -g)`, a hard stop if the daemon is unreachable, and I0 now requires `docker info` to succeed. The offline host was destroyed and recreated.

**Attempt 2 (09:35–10:19 UTC; [`iran-run/`](iran-run/)):**

| Step | Result | Time | Notes |
| --- | --- | --- | --- |
| I0 isolation | PASS | | engine 29.8.2 reachable; 0 images; `example.com` DNS SERVFAIL and HTTP unreachable |
| I1 `bootstrap-load` + `verify-images` | PASS | 47 s | 10 images; every reference resolves to its locked ID |
| I2 `init` + `tls init` | PASS | 6 s | loopback, internal CA |
| I3a capacity recheck before import | PASS | | 67,246,477,312 B free ≥ guard 9,193,803,280 B |
| I3 `import --pbf iran-261017.osm.pbf` | **FAIL** | 2,525 s | `dataset_id` would be `ds-20261017-2d2c87f31d11` (snapshot date from the PBF header) |
| ↳ source-checksum / validate / copy | ok | 1.6 / 3.7 / 1.0 s | |
| ↳ render-import (osm2pgsql 2.3.1 flex, 2 processes) | ok | 196.6 s | Input read in 104 s (27,001k nodes, 3,396k ways, 99k relations). Render DB 1,479,437,459 B, frozen. Catalog: transport 2,150,528; buildings 633,782; POIs 329,105; landcover 183,520; waterways 98,019; places 62,233; boundaries 30,978; water 14,055; 685,766 uncatalogued (largest: `power` 324,110, `barrier` 87,427) |
| ↳ routing-build (Valhalla 3.9.1, 2 threads) | ok | 183.5 s | 2,121,715 routable ways; 4,646,371 edges; 3,602,809 nodes; 3,144 turn restrictions; 1,143 ferry edges reclassified; 2,794 tiles, 870,415,744 B |
| ↳ geocoder-build | **failed** | ~2,136 s | Nominatim 5.3.2 import (reverse-only) and Photon dump completed: 1,199,261 lines (1,199,311 places). Seyra preprocessing then threw `text.normalize is not a function`. |
| overpass-build, map-styles, staging-validation | not reached | | |

**Resources during the import** (`iran-run/I3-import-samples.txt`; every 10 s: VM `df`/`/proc/meminfo`/load, `docker stats` of the offline-host container and of each container inside it; observed peaks between samples can be missed):

| Phase | Min free disk | Min MemAvailable | Max swap used | Peak offline-host RAM | Peak / mean CPU of offline host | Largest container |
| --- | --- | --- | --- | --- | --- | --- |
| render-import | 63,157,432,320 B | 5.78 GB | 28.7 MB | 1,105 MiB | 223 % / 103 % | osm2pgsql 402 MiB, DB 384 MiB |
| routing-build | 61,289,824,256 B | 3.92 GB | 176.8 MB | 3,085 MiB | 206 % / 113 % | valhalla-build 2,620 MiB |
| geocoder export | 54,492,868,608 B | 5.04 GB | 99.5 MB | 2,259 MiB | 252 % / 163 % | geocoder-export 1,868 MiB |

Disk used by the import at its observed peak: about 12.75 GB (67.25 GB → 54.49 GB). After the failure (temporary Nominatim DB already removed by the job): managed source copy 229,849,178 B; Valhalla 870,731,136 B; geocoder export 1,099,609,063 B; PostgreSQL data 2,615,827,723 B (render DB 1.48 GB); 4.16 GB of images inside the offline host. Overpass, the Photon index (574 MB in the scratch check below), staging, a retained previous release and backups were not measured on Iran yet. The 40× guard (9.19 GB) is below the ~12.75 GB observed peak, so on a disk with little headroom the guard alone would not be enough.

**Egress:** 0 packets to non-local destinations from offline host 1 during install and import (5 link-local IGMP reports, 60 loopback packets): [`iran-run/I9-egress-counters-host1-after-failed-import.txt`](iran-run/I9-egress-counters-host1-after-failed-import.txt).

The failed release, its render DB and the Nominatim export are preserved on offline host 1 (`seyra-iran-host`, volume `seyra-iran-host-docker`, `$HOME/seyra-lab/home`). Nothing was pruned.

## 7. Defect: Photon dump `address.other` arrays crash geocoder preprocessing

Files: [`defect-geocoder-address-other/`](defect-geocoder-address-other/).

- **Where:** `apps/ops/src/geocoder-preprocess.ts`, `preprocessDump()`. `collectSynonyms(v)` → `tokens(text)` → `text.normalize('NFC')` is called on every value of `content.address` (and `content.name`), which are typed `Record<string, string>`.
- **Actual data:** Photon 1.3.0 `dump-nominatim-db` writes address lines it cannot map to a named field as **arrays of strings** under `address.other` and `address.other:<lang>`. A read-only scan of the real export ([`export-scan.json`](defect-geocoder-address-other/export-scan.json), [`scan-photon-dump.mjs`](defect-geocoder-address-other/scan-photon-dump.mjs)) found `address.other` arrays in 1,191,816 places, `other:fa` in 140,391 and `other:en` in 35,941. No name value and no house number was non-string. The first occurrence is line 696 of the export.
- **Why it was not caught:** the synthetic fixture's places all map to named address fields, so their dumps contain no `other` arrays.
- **Reproduction on the reviewed code** (application sources unchanged since `9f0d792`): one synthetic dump record with `"address": {"city": "…", "other": ["…", "…"]}` ([`minimal-photon-dump.jsonl`](defect-geocoder-address-other/minimal-photon-dump.jsonl)) run through the built `preprocessDump` ([`repro.mjs`](defect-geocoder-address-other/repro.mjs)) gives `TypeError text.normalize is not a function`.
- **Proposed correction (not applied):** [`proposed-correction.diff`](defect-geocoder-address-other/proposed-correction.diff). It takes text values element-wise from string arrays, ignores other non-string values, and skips non-string names in `addNameVariants`. The API's Photon adapter already ignores non-string address values (`apps/api/src/providers/photon.ts`). Any input that previously succeeded contained no arrays and produces byte-identical output, so `dataset_id` semantics do not change and no pipeline-version bump is needed.
- **Scratch evidence for the correction** (an uncommitted copy of the built module; the failed release was not modified):
  - Over the full real export: completed in 37 s, 207 MB RSS; 1,199,311 places, 376,601 names given search variants (382,551 variants, 24 without a free slot), 22,564 synonym entries.
  - The locked Photon image then imported that output offline with the job's own arguments: 1,199,260 documents (places + release marker) in 155 s, index 573,540,688 B, no import errors ([log](defect-geocoder-address-other/scratch-photon-import-with-proposed-correction.log); the two `UnknownHostException`s are the container's hostname lookup with `--network none`).
  - `overpass-build`, `map-styles` and staging validation remain untested on Iran.

### Next steps once the correction is authorized

1. Apply the correction with a regression test in `apps/ops/src/geocoder-preprocess.test.ts` (array address values): it must fail on `9f0d792` and pass after.
2. Rebuild only the OPS image, relock (only OPS should change), re-export and verify the bundle, and record the new `SHA256SUMS` digest. Re-run unit tests plus the OPS-dependent suites: lifecycle, offline host, restore drill, tamper, security AC16.14/15.
3. On offline host 1, as RUNBOOK §8 (ops-only update): `bootstrap-load` the new bundle, replace the install tree, then `seyra-maps import --pbf $HOME/iran-261017.osm.pbf`. The same `dataset_id` replaces the preserved failed build. Then run the harness phases `serve browser backup restore`.

### Owner inputs still needed for acceptance (unchanged)

- Approved fa/en place and address queries with expected places or areas; representative urban/rural/border areas.
- Routing points and known access restrictions for car, pedestrian and motorcycle.
- Expected concurrency, request mix and latency/recovery targets (no load test without them).
- LAN CIDRs, DNS names and certificates (loopback only until supplied).
- A second real Iran snapshot for an update test.
