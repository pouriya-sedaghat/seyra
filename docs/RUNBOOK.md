# Seyra Map Services — operator runbook (phase 1)

This covers the offline operational host. Software and image acquisition happens separately, in a **preparation environment** with Internet access; see "Preparation" at the end. Nothing in installation, import, start, update or rollback downloads anything.

All four map capabilities run together and unconditionally:
- tiles: Tegola + Nginx
- routing: Valhalla
- geocoding: Photon
- POI presets: Overpass

There are no switches to turn any of them off.

> Numbers marked *fixture* were measured on the synthetic test dataset in a cloud preparation container. They are not capacity, RAM, disk or downtime figures for the Iran dataset; those must be measured on the target host (see "Pending validation").

## 1. Host prerequisites

- linux/amd64 host. Ubuntu 24.04 is the reference; the preparation run used a cloud container, not customer hardware.
- Docker Engine with Compose v2. The preparation environment used Engine 29.8.2 and Compose v5.6.0.
- bash, coreutils (`sha256sum`), and `jq`/`curl` for checks.
- Disk: the offline bundle, the owner's PBF, plus import staging. The importer refuses to start unless free space ≥ max(2 GiB, 40 × PBF size). That is a conservative default, not a measurement, and is configurable in `state/settings.json` (`minFreeFactor`, `minFreeBytes`).
- Time: a synchronised clock (TLS validity, log timestamps).
- Network: none required. The default ingress is `https://127.0.0.1:8443`.

**Trust boundary.** Processes running on the Docker host itself can reach container bridge addresses; Docker does not filter host-local traffic (evidence AC16.3b). Treat shell access to the host as administrative access to the providers. Other machines cannot reach providers, the database or the API directly (evidence AC16.3).

## 2. Install from the offline bundle

**Authenticity.** `SHA256SUMS` and the bundle manifest protect against corruption and partial edits, but someone who rewrites an archive, the manifest and `SHA256SUMS` together can pass them. Transfer the digest of `SHA256SUMS` (printed at export: `sha256sum SHA256SUMS`) through a separate trusted channel, such as a signed change ticket or a phone readback, and compare it before installing. Even then, `bundle load` refuses any image whose real ID differs from the manifest (evidence T4).

```bash
# copy the bundle directory to the host (removable media / internal transfer), then:
cd /path/to/bundle
sha256sum SHA256SUMS                       # compare with the digest received out of band
sha256sum --quiet -c SHA256SUMS            # integrity of every archive and install file
sudo cp -r install /opt/seyra              # install tree: wrapper, compose files, catalog, lock, docs
/opt/seyra/bin/seyra-maps bootstrap-load /path/to/bundle
```

`bootstrap-load`:
1. Verifies the ops image archive and `SHA256SUMS`.
2. Runs `docker load` for the ops image.
3. Runs `bundle load` inside it, which re-verifies every checksum, loads each image archive, and requires each loaded reference to resolve to the exact image ID recorded in the bundle manifest.

A tampered or corrupted archive stops the install (evidence AC18).

```bash
export SEYRA_HOME=/srv/seyra               # absolute; all state lives here
/opt/seyra/bin/seyra-maps verify-images    # every locked image present with its locked ID
/opt/seyra/bin/seyra-maps init             # directories, secrets, internal networks, DB roles, migrations
/opt/seyra/bin/seyra-maps tls init --names localhost,127.0.0.1[,maps.internal]
```

`init` defaults to loopback-only access (`--bind 127.0.0.1 --port 8443`).
- It generates random passwords in `$SEYRA_HOME/secrets/`. Each is mode 0400 and owned by the UID of the one container that needs it.
- It creates the internal networks `seyra_backend` and `seyra_build` (no outside route).
- It creates the roles `seyra_api` (control data, read-only), `seyra_tile_reader` (map render databases, read-only) and `seyra_render_import` (one release's render DB, only until it is frozen).

`tls init` creates an internal CA and a server certificate. Clients must trust `secrets/tls/ca.crt`. To use certificates from your own internal CA instead: `seyra-maps tls import --cert server.crt --key server.key`.

## 3. Import an owner-supplied OSM extract

```bash
seyra-maps import --pbf /data/owner/iran-YYYYMMDD.osm.pbf [--snapshot-timestamp 2026-10-01T00:00:00Z]
```

The original file is only read: it is checksummed and copied into the release. It is never modified, moved or deleted. Every build step writes only into a new `releases/<dataset_id>/` directory and a new render database. The active release is not touched; build containers have no network, or only the internal build network.

Steps:
1. `source-checksum`
2. `source-validate` (osmium)
3. `source-copy`
4. `render-import` (osm2pgsql flex into `render_<id>`, then frozen read-only)
5. `routing-build` (Valhalla tiles)
6. `geocoder-build` (temporary Nominatim → export → Seyra normalization → Photon index)
7. `overpass-build` (osmium XML → Overpass base, version label `seyra:<id>`)
8. `map-styles`
9. `staging-validation`: the real providers are started against the new stores on the build network; tiles, routing, geocoder and Overpass are probed with data sampled from the release, and each provider's identity is recorded.

`dataset_id = ds-<snapshot date>-<12 hex>`. The hash covers the source checksum, pipeline files and versions, the data-shaping image IDs (DB, osmtools, Valhalla, geocoder-build, Photon, Overpass, Tegola) and the map-asset digest. A release can only be served by those exact images: `activate` refuses otherwise ("re-import required").

Failure handling:
- A failed import leaves the release marked `failed`. Re-running the same input replaces that failed build automatically.
- If an import process dies (killed, reboot), the next import detects the abandoned lock, stops the orphaned build containers and marks the interrupted release `failed` (evidence L2).
- Corrupt or truncated input is rejected at `source-validate` (evidence L1).

*Fixture:* a full import, including staging, took about 1.5 minutes.

## 4. Activate (maintenance cutover)

```bash
seyra-maps status                       # releases, pointers, live readiness
seyra-maps activate <dataset_id>
```

1. Re-verify the release: artifact checksums, the frozen render DB marker, and the data-component image IDs.
2. Set the maintenance flag; the API answers `503 MAINTENANCE`.
3. Drain the API (40 s grace), then stop the providers and proxy.
4. Write the new `runtime.env` and `release.json`, keeping the previous ones.
5. Start the whole stack.
6. Wait until **all four providers report the new release's identities**:
   - Tegola: map name.
   - Valhalla: tileset timestamp.
   - Photon: release marker document.
   - Overpass: base version label.
7. Clear maintenance and update the active/previous pointers.

If the new release does not become ready within `readinessTimeoutS` (default 300 s), the previous configuration is restored and the command fails, reporting that the previous release is ready again (evidence L3).

This is **not** zero-downtime and not an atomic multi-service swap. *Fixture:* about 25 s of refused connections while the proxy restarts, then about 11 s of `503 MAINTENANCE`; about 42 s end to end.

## 5. Rollback, prune, start/stop

```bash
seyra-maps rollback          # cut back to the previous release (same verified cutover)
seyra-maps prune             # keep active + previous; drop other releases and their render DBs
seyra-maps stop | start      # start refuses if any image no longer matches the lock
seyra-maps verify-release <dataset_id>
```

Releases are never pruned automatically.

## 6. LAN access for shared testing

Loopback is the default. LAN access needs an explicit allowlist and a certificate valid for the LAN name:

```bash
seyra-maps tls init --names maps.internal,10.20.0.15     # or tls import
seyra-maps init --access lan --bind 10.20.0.15 --lan-cidrs 10.20.0.0/24 --server-names "maps.internal 10.20.0.15"
seyra-maps start
```

- LAN mode without CIDRs fails closed: the proxy refuses to start (evidence AC16.9).
- Clients outside the CIDRs get 403 (evidence AC16.10).
- Unknown Host names get 421.
- This is network access control only, not user authentication; Authentication is a separate future module.
- Do not change the host firewall for Seyra tests.

## 7. Backup and restore

```bash
seyra-maps backup --out /backup/seyra-$(date +%F)
```

This writes:
- a `pg_dump` of the control database `seyra_app`
- `state-*.tar.gz` (pointers, settings, history, runtime config)
- `manifests-*.tar.gz` (every release manifest)

Secrets and TLS keys are **not** included; back up `$SEYRA_HOME/secrets` separately, under your key-handling policy. Map stores are not backed up: they are rebuilt from the managed source copy in `releases/<id>/source/` plus the locked images.

Restore on a fresh host:
1. Install from the bundle and run `init`.
2. Restore `secrets/`.
3. Restore `state/` from the archive.
4. Restore the control database: `docker compose -p seyra exec -T db psql -U seyra_admin -d seyra_app < seyra_app-*.sql`.
5. Re-import the active release's source with the same snapshot timestamp. The same inputs and images give the same `dataset_id`.
6. Activate it.

*Not yet exercised end to end; see `docs/TEST_RESULTS.md`.*

## 8. Updating software (new bundle)

1. Prepare a new bundle in the preparation environment.
2. Verify and load it with `bootstrap-load`.
3. Replace the install tree.

Then:
- **API/proxy/ops-only changes:** `seyra-maps start` recreates the changed containers.
- **Any data-component change** (DB, osmtools, Valhalla, geocoder-build, Photon, Overpass, Tegola) or catalog/pipeline/style change: re-import and activate. `activate` refuses a release built with different data-component images.

## 9. Health and diagnostics

- `GET /health/ready` (via the proxy) returns 200 only when all four providers and the control DB answer with the active release's identities; otherwise it returns 503.
- `GET /api/v1/map/health` returns the same details without a 503.
- `seyra-maps status` shows releases, pointers and live readiness.
- Logs: `docker logs seyra-api-1` and `seyra-proxy-1`. Both are redacted: no query strings, coordinates or bodies are logged (evidence AC17.11).

## 10. Preparation environment (Internet-connected; not the operational host)

```bash
SEYRA_SOURCES=/prep/sources infra/prepare/fetch-sources.sh          # pinned tags/commits/artifact sha256 (infra/prepare/sources.json)
SEYRA_SOURCES=/prep/sources [SEYRA_PREP_CA=/path/ca.pem] infra/prepare/build-images.sh
SEYRA_SOURCES=/prep/sources node infra/prepare/write-lock.mjs        # real identities -> infra/dependencies.lock.json
SEYRA_HOME=/prep/home bin/seyra-maps bundle export --out /prep/bundle-$(date +%F)
bin/seyra-maps bundle verify /prep/bundle-...
```

Base images are pinned by digest in the Dockerfiles. Registry access in the 2026-10-14 preparation run:
- Docker Hub pulls went through `mirror.gcr.io` because of 429 limits.
- ghcr.io was blocked, so Valhalla was built from source.

## 11. Pending validation

These items are owner/target-host work, not done here:
- Iran extract import time, RAM and disk.
- Full-country tile, routing and geocoder latency and load.
- Overpass limits under real data.
- Staging and rollback storage sizing.
- Update cadence, downtime and SLA.
- Target OS, CPU, internal CA, DNS and time.
- Mobile SDK execution.
- Distribution licence review (`docs/LICENSES.md`).
