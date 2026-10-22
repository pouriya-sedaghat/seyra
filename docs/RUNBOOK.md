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
- Disk, on the filesystem that holds `SEYRA_HOME` (all import output goes there: managed source copy, render database under `data/postgres`, Valhalla, the temporary Nominatim database under `work/`, Photon, Overpass and its build-time temporaries, logs). Plan for:
  - **each import in progress:** about **120 × the PBF size** free. The measured Iran reference (229,845,082-byte PBF, run `vm2-2026-10-18`) used 21.93 GB at its sampled low point, which is 95.4 × the input, during the Overpass build. 120× adds about 25 % margin. That is about 27.6 GB for that extract.
  - **each retained release:** about 48 × the PBF size (11.1 GB for that extract). `prune` keeps the active and the previous release.
  - **separately**, if Docker's data root is on another filesystem: the loaded images (about 3.6 GB) and container logs. The import check does not see that filesystem.
  - These figures come from one extract on one host. Re-measure for a larger extract or a different pipeline.
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

**Who can read the bundle.** `bundle export` gives every file it writes to the owner of the `--out` directory, which the wrapper creates as the operator who runs it. Archives and files are `0644` (executables `0755`) and directories `0755`, so that operator can run the checks above and `bootstrap-load` without root. A bundle holds image archives and install files, never secrets or keys. Copy it with modes preserved. To install under `/opt/seyra`, the `sudo cp` above is the only step that needs root.

`bootstrap-load`:
1. Verifies the ops image archive and `SHA256SUMS`.
2. Runs `docker load` for the ops image.
3. Runs `bundle load` inside it, which re-verifies every checksum, loads each image archive, and requires each loaded reference to resolve to the exact image ID recorded in the bundle manifest.

A tampered or corrupted archive stops the install (evidence AC18).

```bash
export SEYRA_HOME=/srv/seyra               # absolute; all state lives here
/opt/seyra/bin/seyra-maps verify-images    # every locked image present with its locked ID
/opt/seyra/bin/seyra-maps init             # directories, secrets, internal networks, DB roles, migrations
/opt/seyra/bin/seyra-maps tls init --names localhost,127.0.0.1    # TEST ONLY (synthetic fixtures); see below for LAN hosts
```

`init` defaults to loopback-only access (`--bind 127.0.0.1 --port 8443`).
- It generates random passwords in `$SEYRA_HOME/secrets/`. Each is mode 0400 and owned by the UID of the one container that needs it.
- It creates the internal networks `seyra_backend` and `seyra_build` (no outside route).
- It creates the roles `seyra_api` (control data, read-only), `seyra_tile_reader` (map render databases, read-only) and `seyra_render_import` (one release's render DB, only until it is frozen).

### TLS certificates

**Test only:** `tls init` creates an on-host test CA and a server certificate for the synthetic fixture flows; clients of such a host trust `secrets/tls/ca.crt`. Its CA private key stays in `secrets/tls`, so it is **not** the provisioning design for LAN clients.

**LAN hosts:** the issuer is managed outside the serving host. It is either the company CA or an operator-controlled development issuer (`infra/tls/dev-issuer.sh`, run on another machine). Both use the same interface:

```bash
seyra-maps tls csr --names <lan-address>[,<lan-name>]        # new server key stays in secrets/tls/pending (0400); the CSR there is 0444, readable by the operator
#   ... the issuer signs the CSR for serverAuth, elsewhere ...
seyra-maps tls import --cert leaf.crt [--chain intermediates.pem] --ca issuer-root.crt --names <lan-address>[,<lan-name>]
seyra-maps proxy restart                                      # serve the new pair (providers keep running)
seyra-maps tls status                                         # public metadata only: subject, SAN, validity, fingerprint
seyra-maps tls restore --from <SEYRA_HOME>/secrets/tls/previous-<time>   # validated rollback to a saved set
```

`tls import` validates everything before it changes a file, and a failed validation keeps the previous pair. It checks:
- the key matches the leaf;
- every `--names` entry is in the SAN (no wildcards);
- the certificate is currently valid and valid for at most 825 days in total;
- it is not a CA certificate, and it has serverAuth and digitalSignature;
- the chain verifies to the given root for every name;
- no input file carries a private key other than the server key.

The replacement itself is journalled:
- Every input is read once into a private staging directory, and validation and installation use only those staged bytes, so changing an input file afterwards cannot change what is installed.
- The previous set is copied to `secrets/tls/previous-<time>/`: the served file, the split `leaf.crt`/`chain.pem`, the key, the trust anchor and `served.json`.
- An interruption leaves a journal that makes `start`, `proxy restart` and activation refuse until `seyra-maps tls recover` completes or undoes it. Recovery only completes a set whose certificate and key match; otherwise it restores the verified previous pair, and if neither is valid it refuses and keeps everything for inspection.

Roll back to an earlier certificate with `seyra-maps tls restore --from <SEYRA_HOME>/secrets/tls/previous-<time>`. The backup is validated like an import: key match, names (from its `served.json`, or else its own SAN), purpose and its saved chain to its saved trust anchor. It then goes through the same journalled replacement, followed by `seyra-maps proxy restart`. The `previous-<time>` directories are root-only (0700); the wrapper passes a `--from` path inside `SEYRA_HOME` through unchanged and the CLI checks it as root, so the non-root operator runs this command as written.

Every TLS command that changes `secrets/tls` (`csr`, `import`, `restore`, `recover`, and the test-only `init`) takes the same lifecycle lock as `start`, `proxy restart` and activation, and checks its preconditions after acquiring it. Two TLS or lifecycle commands never interleave.

The host wrapper checks every input file argument (`--cert`, `--key`, `--ca`, `--chain`, `--pbf`) before Docker runs: the argument must be present and name an existing readable regular file. Relative paths resolve against the current directory, and each file is mounted read-only at its own path, so inputs may live in any directories. Files inside `SEYRA_HOME` (for example the pending key or a backup) need no extra mount.

Only the leaf key, the served chain and the public root are stored. No OCSP, CRL or AIA fetch is required at run time: revocation is handled by short-lived leaves and re-issue.

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

Free-space admission (before anything is created or removed):
- `required = max(minFreeBytes, minFreeFactor × PBF size)`, with defaults of 2 GiB and **120** (`state/settings.json`).
- `available = free space on SEYRA_HOME's filesystem + a conservative reclaim estimate for a failed build of the same dataset_id`. The estimate counts only allocated blocks of that release's regular files and directories on the same filesystem. It never follows symlinks, gives no credit to a file that keeps another hard link outside the release, and counts the render database as 0 (`pg_database_size` is recorded but is not an equal free-space gain).
- If `available < required`, the import stops with both figures and **nothing is changed**; the failed build and its render database are kept.
- Otherwise the failed build is removed. Free space is then *observed* again and compared with the requirement before anything new is written. If the removal released less than estimated, the import stops there.
- `init` writes every setting into `settings.json`. A home initialised before this default changed therefore keeps `minFreeFactor: 40` until you edit it, and every import then logs a warning that the factor is below the measured reference. Raise it, or lower it only after measuring your own extract.
- The guard is a sizing guard, not a reservation: another process can still fill the disk during an import.

Free-space measurement: the importer samples free space on SEYRA_HOME's filesystem every 5 s and at each step boundary. It records each step's minimum (`steps[].free_bytes_min`), the run's low-water mark with its time (`free_bytes_min_observed`, `free_bytes_min_observed_at`), the sampling settings and the admission figures (`capacity_check`) in the release manifest. A dip shorter than the interval can be missed.

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

**Failure during activation.** Before step 2, `activate` saves the current `runtime.env` and `release.json` under `state/transition/` and writes a journal, `state/transition.json` (`from`, `to`, phase).

If any later step fails, `activate` stops the API, restores the saved configuration, starts the stack again and waits for the previous release's identities. This covers a `docker compose up` error, a filesystem error, or the new release not reporting within `readinessTimeoutS` (default 300 s). On success it clears maintenance and fails with "previous release … restored and ready" (evidence L3, L7).

If restoring the previous release also fails, the command reports both errors. The platform then **stays in maintenance**, and the journal and the saved configuration are kept (evidence L8). Fix the cause (for example a port held by another process), then run:

```bash
seyra-maps status     # shows "UNFINISHED activate <from> -> <to> … run: seyra-maps recover"
seyra-maps recover
```

While a journal exists, `activate`, `rollback`, `prune` and `start` refuse to run. `recover` also covers a killed `activate` process:
- If the pointers were already committed to the new release, it finishes that activation.
- Otherwise it restores the previous release.
- If this was a first activation with no previous release, it restores the saved configuration and leaves the platform in maintenance until a release is activated.

This is **not** zero-downtime and not an atomic multi-service swap. *Fixture:* about 25 s of refused connections while the proxy restarts, then about 11 s of `503 MAINTENANCE`; about 42 s end to end.

## 5. Rollback, prune, start/stop

```bash
seyra-maps rollback          # cut back to the previous release (same verified cutover)
seyra-maps prune             # keep active + previous; drop other releases and their render DBs
seyra-maps stop | start      # start refuses if any image no longer matches the lock
seyra-maps verify-release <dataset_id>
```

Releases are never pruned automatically.

**Lifecycle lock.** Each state-changing command holds `state/lifecycle.lock` while it runs: `init`, `start`, `stop`, `activate`, `rollback`, `recover`, `prune`, `backup`, `restore`, and the set-up phase of `import`. A second such command fails at once with "another lifecycle operation is running: <op> <target> (started …)". Retry it when the first command has finished.

The lock is a kernel `flock(2)` held by the running command. The kernel releases it as soon as that command's process or ops container ends, however it ends, so a crash never leaves a lock that has to be cleared by hand.
- The file itself stays in place. It only records the current owner, and `status` shows whether that owner still holds the lock.
- A record left by a command that ended without releasing the lock is replaced by the next command. If an activation journal also exists, only `recover` may run (section 4).
- `SEYRA_HOME` must be on a local Linux filesystem that enforces `flock` (not a network share); every command verifies this and refuses otherwise.

A long `import` also holds a lease, `state/import.lock`, which names the release being built:
- `prune` never removes that release or any release still `building` (evidence L9).
- An import lease whose owner process or ops container no longer exists is treated as abandoned. It is removed only while holding the lifecycle lock, and the abandoned import is marked `failed` (evidence L2).
- A lease whose owner's liveness cannot be determined is never removed automatically.

## 6. LAN access for shared testing

Loopback is the default. Every LAN path needs an explicit allowlist and a certificate for the LAN name (§2, *TLS certificates*). Every path (web client, Swagger, API, map assets) sits behind the same access boundary. Client integration: `docs/CLIENT_INTEGRATION.md`.

### 6.1 Direct LAN mode (Seyra runs on the host's own Docker daemon)

```bash
seyra-maps tls csr --names 10.20.0.15   # then tls import the issued certificate
seyra-maps init --access lan --bind 10.20.0.15 --lan-cidrs 10.20.0.0/24 --server-names "maps.internal 10.20.0.15"
seyra-maps start
```

Docker's published-port NAT normally keeps the client source address, so nginx checks the real client against the allowlist. Confirm this with a real LAN client before relying on it. Connections that originate on the host itself take a different path and cannot stand in for a LAN client test.

`init` persists the settings, but `runtime.env` is written only by the first `init` and by activations. On an install that is already running, apply changed access settings deliberately:

```bash
seyra-maps access apply      # rewrites only access/relay keys for the active release; keeps runtime.env.prev
seyra-maps proxy restart     # recreates only the proxy and checks every expected publication
```

### 6.2 Relay mode (Seyra inside a nested Docker host)

When the stack runs inside a nested host on an internal network, the host's LAN address cannot be bound inside the inner daemon. A small layer-4 relay (`infra/edge/`, operator commands in `infra/edge/edge.sh`, settings in an operator-local copy of `infra/edge/edge.env.example`) publishes the LAN port and forwards TCP to a separate relay listener of the proxy:

```bash
seyra-maps init --access loopback --bind 127.0.0.1 --server-names "localhost 127.0.0.1 <lan-address>" \
  --relay-peer <edge address on the lab network> --relay-bind <nested host lab address> --relay-port <relay port> \
  --relay-client-cidrs <approved client subnet> --relay-server-names "<lan-address>"
seyra-maps access apply && seyra-maps proxy restart
```

- **Edge:** sends a PROXY protocol header built from its actual TCP peer, and allows only the approved subnet. It holds no TLS key and logs no addresses.
- **Inner relay listener** (container port 8444, added by `runtime.relay.yml` only when a relay is configured):
  - requires PROXY protocol;
  - accepts only the configured relay as its actual socket peer (403 otherwise);
  - only then checks the conveyed client address against the approved subnet.
  - HTTP forwarding headers are never trusted, and unknown Host names get 421.
- **Ordinary listener:** stays the loopback-only local control path for CLI, readiness and recovery calls, with no PROXY header and no LAN exposure.
- **Settings rules:** a relay requires loopback access mode. Its peer must be one exact non-loopback address outside the client allowlist. Its server names may not contain loopback names.
- **Egress:** the edge's network namespace gets an egress guard (new connections only to the relay upstream). `tests/offline/namespace-egress.sh` checks the namespaces directly. The old outbound counter treats private destinations as local, so it cannot prove LAN isolation.
- **Rollback order:**
  1. `init --no-relay`, then `access apply` and `proxy restart`: the inner proxy stops trusting the edge address and the LAN path closes;
  2. `edge.sh stop`;
  3. `edge.sh remove`.

  A stopped container releases its lab address at once, and Docker gives it to the next container (verified on Docker 29). So the inner relay must stop trusting the address **before** the edge stops.

  `edge.sh stop` stops the edge only on positive, read-only evidence from the serving installation (`EDGE_INNER_DOCKER_HOST`, `EDGE_INNER_HOME` in the edge env file) that the edge's exact lab address is no longer trusted:
  - `state/settings.json` is read and its `relayPeer` is not that address;
  - exactly one serving proxy container exists and is plainly running (not stopped, restarting or paused); its `SEYRA_RELAY_PEER` is not that address; without a relay peer it publishes no relay port;
  - `state/runtime.env` has not changed since that proxy was created (by ctime), so a restart would apply the same state.

  A closed or refusing relay port is **not** evidence: a stopped or restarting proxy keeps its configured trust and applies it again on start. Any unreadable, failed, stale or inconsistent state refuses and keeps the edge, and so its address. `stop --force` is for emergencies only. It stops the edge without this evidence, and any container that later receives the address can then claim approved clients until step 1 is done, so step 1 must follow at once.

### 6.3 Rules for both modes

Access settings are validated by `init` before anything is saved, again before every start, and independently by the proxy entrypoint:
- **Loopback mode** requires a bind address in `127.0.0.0/8` and no CIDRs.
- **LAN mode** requires a non-loopback bind address and at least one CIDR. Each CIDR must be a canonical IPv4 network (`10.20.0.0/24`, not `10.20.0.5/24`) with a prefix length of 8–32. Every allowlist ends in `deny all`.
- Invalid settings are refused with the reason: `0.0.0.0` in loopback mode, `0.0.0.0/0`, malformed or out-of-range addresses. A hand-edited `runtime.env` that breaks these rules makes `start` refuse (evidence AC16.11–AC16.15).
- LAN mode without CIDRs fails closed: the proxy refuses to start (evidence AC16.9).
- Clients outside the CIDRs get 403 (evidence AC16.10).
- Unknown Host names get 421.
- The hidden diagnostics route (`/api/v1/map/diagnostics` and its normalized or encoded variants) is blocked at the ingress. Operators use `seyra-maps status`.
- Bodies over 64 KiB get a typed 413 `PAYLOAD_TOO_LARGE` from the ingress.
- This is network access control only, not user authentication; Authentication is a separate future module.
- Do not change the host firewall for Seyra tests.

## 7. Backup and restore

```bash
seyra-maps backup [--out /backup/seyra] [--include-sources]     # default root: $SEYRA_HOME/backups
```

Each run publishes one **backup generation** under the backup root, `seyra-backup-<UTC stamp>-<id>/`, containing:
- `seyra_app.sql`: a `pg_dump` of the control database `seyra_app`, checked for its completion trailer.
- `state.tar.gz`: pointers, settings, history and runtime config.
- `manifests.tar.gz`: every release manifest.
- With `--include-sources`, `sources/<dataset_id>.osm.pbf` and `.json`: the managed input copy of the active and previous releases, checked against their release manifests. These are large. A restore then does not depend on finding the owner's original files.
- `backup-manifest.json`, the completion record. It lists every file with its role, size and SHA-256, the backed-up pointers, and each release's source identity (file name, SHA-256, snapshot timestamp).

The generation is assembled in a hidden `.seyra-backup-…partial` directory. The completion record is written last, everything is flushed to disk, and only then is the directory renamed to its final name. A published generation is therefore complete by construction. A backup that fails removes its `.partial` directory. One that is killed leaves it behind; restore reports it and never reads it, and you can delete it. Use the same root for repeated backups and remove old generations under your retention policy.

**Secrets and TLS keys are never included.** Back up `$SEYRA_HOME/secrets` separately (`cp -a`, preserving owners and modes), under your key-handling policy. The database role passwords in a restored host must match the dump's host, so the secrets backup is part of every restore.

Map stores are not backed up. They are rebuilt from the original input and the locked images; identical inputs and images reproduce the same `dataset_id`.

**Restore on a fresh host** (order matters):

```bash
# 1. install from the bundle (section 2): copy install/, bootstrap-load, verify-images
# 2. secrets first, so init creates the DB roles with the backed-up passwords
#    (and the existing TLS CA/certificate stay valid for clients):
mkdir -p "$SEYRA_HOME" && cp -a /backup/secrets "$SEYRA_HOME/secrets"
# 3. init: directories, networks, DB roles from the restored secrets, schema
seyra-maps init
# 4. restore: selects and verifies ONE generation, then replaces the freshly initialised control DB
#    with its dump, re-applies grants/migrations, restores settings and history, and
#    prints the re-import commands for the backed-up active and previous releases
seyra-maps restore --from /backup/seyra [--generation seyra-backup-…]
# 5. run the printed imports (previous first, then active); each must report the backed-up dataset_id
seyra-maps import --pbf /backup/seyra/seyra-backup-…/sources/<previous>.osm.pbf [--snapshot-timestamp …]
seyra-maps import --pbf /backup/seyra/seyra-backup-…/sources/<active>.osm.pbf  [--snapshot-timestamp …]
# 6. activate previous, then active (restores the active/previous pair)
seyra-maps activate <previous> && seyra-maps activate <active>
```

**Which generation is restored.** `--from` may name a generation directory itself, or a backup root.
- For a root, restore uses the **newest published generation**, or the one given with `--generation`. It prints which one it chose, the other complete generations, and every `.partial` attempt it ignored.
- Files are never combined across generations.
- The previous flat layout (`seyra_app-*.sql`, `state-*.tar.gz` and `manifests-*.tar.gz` side by side, without a completion record) is refused. Nothing can prove those files belong to one complete backup. Take a new backup.

**What is verified before anything changes.** The whole selected generation is checked before the database is touched:
- every listed file is present with its recorded size and SHA-256, and no unlisted files are present;
- the SQL dump is complete;
- the state archive's settings satisfy the access rules (section 6), and its pointers match the record;
- the archived release manifests, and any included sources, match the recorded release identities.

Any mismatch stops restore with the reason. Restore does not fall back to another generation on its own; to use an older one, name it with `--generation`.

Notes on `restore`:
- It refuses on a host that already serves a release, and before changing anything if a secret is missing.
- It does not restore the release pointers, because the map stores do not exist until step 5.
- Without `--include-sources`, it prints the source file name and SHA-256 to look for; rebuild from the owner's original input with that checksum.

The isolated drill `tests/offline/restore-drill.sh` follows these steps from one offline host to a second, empty one. It also checks the generation selection, an interrupted attempt and a damaged generation; see `docs/TEST_RESULTS.md`. Install and rollback are not restore tests.

## 8. Updating software (new bundle)

1. Prepare a new bundle in the preparation environment, and send the digest of its `SHA256SUMS` through the trusted channel.
2. On the host, **before replacing anything or running a file from the new bundle**, verify it with the tools already installed: compare `sha256sum SHA256SUMS` with the received digest, then run `sha256sum --quiet --strict -c SHA256SUMS` and check that the bundle contains no file missing from `SHA256SUMS`. Stop if any check fails.
3. Replace the install tree, then run `bootstrap-load` from the new tree.

Then:
- **API/proxy/ops-only changes:** `seyra-maps start` recreates the changed containers.
- **Any data-component change** (DB, osmtools, Valhalla, geocoder-build, Photon, Overpass, Tegola) or catalog/pipeline/style change: re-import and activate. `activate` refuses a release built with different data-component images.

## 9. Health and diagnostics

- `GET /health/ready` (via the proxy) returns 200 only when all four providers and the control DB answer with the active release's identities; otherwise it returns 503.
- `GET /api/v1/map/health` returns the same details without a 503.
- `seyra-maps status` shows releases, pointers and live readiness.
- Swagger UI `/api/docs/` and the specification `/api/docs/json` are served by the API through the same ingress and access rules; they load while a provider is down.
- The API's internal diagnostics route is not reachable through the ingress (blocked, including path variants).
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
