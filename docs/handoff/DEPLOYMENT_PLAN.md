# Client handoff: build, rehearsal, cutover and rollback plan

Status:
- **Build and disposable rehearsal: done** on 2026-10-19 (run `2026-10-19-build-rehearse`, [evidence](evidence/2026-10-19-build-rehearse/README.md)).
- **Corrections to review `c73db85`: done** on 2026-10-20 (run `2026-10-20-c73db85-corrective`, [evidence](evidence/2026-10-20-c73db85-corrective/README.md)).
- **LAN PKI tooling corrections to review `f5bd978`: done** on 2026-10-21 (run `2026-10-21-f5bd978-corrective`, [evidence](evidence/2026-10-21-f5bd978-corrective/README.md)). The corrected scripts await review. Their real-Windows acceptance has not been run, and the owner's Windows steps (issuer keys, signing, trust) have not started.
- On 2026-10-21 the VM rebooted, and the serving host (restart policy `no`) was down for about 39 minutes. It was restored unchanged; see §6 of that evidence.
- The cutover bundle is now **r9**, with `SHA256SUMS` digest `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`. Its images are byte-identical to r8; its edge tooling and RUNBOOK are corrected. r8 (`10797ff1…`) is retained for recovery but superseded for the cutover.
- **Serving-host cutover: not executed.** The serving host still runs r3 on loopback only. It was paused and resumed for the build window with its own installed CLI, and the new build was not deployed to it.
- The cutover (§3) waits for the owner's decisions in §5.

Values in angle brackets are operator-local; the filled-in copy lives outside Git.

Placeholders:
- `<LAB>`: the serving host's lab directory on the VM.
- `<HOST>`: the serving host container (nested Docker daemon).
- `<VM_LAN_ADDR>`: the VM's bridged LAN address.
- `<APPROVED_CLIENT_CIDR>`: the approved client subnet.
- `<NESTED_LAB_ADDR>`: the serving host's address on the internal lab network.
- `<EDGE_LAB_ADDR>`: the edge's address on that network. It is assigned at attach time, because the lab network has no user-configured subnet.
- `<PORT>`: the published HTTPS port.
- `<RELAY_PORT>`: the relay listener port.
- `<R9>`: the r9 bundle directory on transfer media.

Inside the serving host, the CLI runs as `DOCKER_HOST=unix://<LAB>/run/docker.sock SEYRA_HOME=<LAB>/home <LAB>/install/bin/seyra-maps …`. It runs from the VM against the nested daemon, not through the lab harness. The harness refuses every mutating phase on this unlabelled host by design (F4).

## 1. What changes, and what does not

| Item | Change | Data identity |
| --- | --- | --- |
| API image `sha256:710d5e37…` | Swagger UI plugin (pinned 5.2.6, local assets), documented OpenAPI, capabilities schema | unchanged dataset id |
| Proxy image `sha256:b953043a…` | shared location include, optional relay listener (PROXY protocol, exact peer), diagnostics block, typed 413, render script | unchanged |
| OPS image `sha256:8cbabae5…` | relay settings, `access apply`, `proxy restart`, `tls csr/import/status/recover/restore`, publish and pair checks, operator-readable CSR | unchanged |
| Data images (Tegola, Valhalla, Photon, Overpass, PostGIS, osmtools, geocoder-build) | **none**: their lock entries are byte-identical | dataset `ds-…` and stores unchanged |
| Bundle r9 | these three images plus byte-identical data images (archives identical to r8); install tree adds `runtime.relay.yml` and `infra/edge/` (evidence-based `edge.sh stop`), and the fixed wrapper (`--out` 0755, root-only `--from` backups) | — |

No Iran reimport and no PBF access are needed. The original readiness 503 of 18 October stays open.

## 2. Build and rehearsal (done)

Owner decision 1 was resolved as "this VM, in an authorized window". Details are in the [evidence](evidence/2026-10-19-build-rehearse/README.md).

- **Window:** the serving installation was stopped gracefully with its own CLI for about 86 min and resumed with all identities unchanged. One heavy workload ran at a time under a 5 s resource supervisor, with no abort.
- **Builds** of API, proxy and OPS only, from `043993c`:
  - each build took 14–34 s with ≥ 5.8 GiB available;
  - `docker build --network host` was required: TCP from Docker's NAT bridge to the npm registry timed out that day, while host-network connections worked. The cause is unknown (corrected after review `c73db85`);
  - relocked with all seven data entries byte-identical.
- **Suites on the new images:**
  - integration 137/137, security 31 + 1 note, exact-image boundary 104/104;
  - lifecycle 15/15, tamper 6/6, offline host 6/6, restore drill 8/8;
  - Swagger UI in Chromium, normal and provider-down: all checks pass;
  - served-asset URL scan: 0 unclassified.
- **Rehearsal r3 → r8 (synthetic fixture):**
  - It ran inside a disposable "rehearsal VM" with its own daemon, on internal benchmark-range segments. A client packet followed the real path: LAN address → Docker DNAT → edge → lab network → nested DNAT → PROXY listener, with the client source preserved.
  - Final result: 28/28.
  - Attempt 1 on r7 found the `tls restore --from` operator defect (B5), fixed in r8.
- **Corrective rehearsal r3 → r9 (2026-10-20):** 32/32.
  - It adds the real authorization-removal failure cases: the proxy down with the trust configured, the trust removed but not applied, and the proxy down after removal. In each, the edge stop is refused and the address kept; it stops only on positive evidence.
  - It adds the volume-ownership refusals, positive sink evidence and a counted cleanup verdict, including a real cleanup failure that returned FAIL.

## 3. Serving-host cutover: concrete live LAN plan

Preconditions:
1. The owner approved a window (decision 2). The expected not-ready time is a few seconds per step (measured below). Plan for 30 minutes, including verification and the H-01 device check.
2. A certificate for `<VM_LAN_ADDR>` (plus a DNS name if one exists) is available from the chosen issuer (decision 3), or will be signed in the window from the CSR of step 4.
3. `<R9>` is on transfer media under `<LAB>/transfer/`, and its `SHA256SUMS` digest has been compared out of band with `50ade03079c11dbef7a13dabcc9a2a5bac716c024fe0107db0be5c70e57e82bf`.
4. An approved test device (Windows, H-01) and its LAN address are known; it has the public root for application-specific trust. A second LAN device outside the approved subnet is available for the edge refusal check.
5. The private edge env file is filled in (template `infra/edge/edge.env.example`), including `EDGE_INNER_DOCKER_HOST` and `EDGE_INNER_HOME`, which `edge.sh stop` reads to establish trust removal.

Measured on the synthetic rehearsals (r3 → r8 and r3 → r9, the same within 0.1 s; control-listener readiness sampled every 0.5 s):

| Step | Not ready | Recreated |
| --- | --- | --- |
| software cutover (`start`) | 2.1 s | api, proxy |
| certificate (`proxy restart`) | 0.5 s | proxy |
| relay on (`proxy restart`) | 0.5 s | proxy |

Provider identities did not change and the data containers were not recreated. The Iran release may need longer for the API's first identity probes after a restart. The time is **not promised**: it is measured again in the window.

0. **Before-state (no change).** Record:
   - readiness and the dataset;
   - container ids and start times, on both daemons;
   - nested image ids and the `runtime.env` hash;
   - `tls status`;
   - the egress counter and the PBF SHA-256.

   Then make a fresh `backup` generation and a verified copy of `secrets/`, and write a private `CUTOVER-IN-PROGRESS` marker that holds the rollback commands of §4.
1. **Stage.**
   - Run the strict entry checks on `<R9>`: directories and listed regular files only, plain names, well-formed `SHA256SUMS`, the digest from precondition 3, then `sha256sum --strict -c`, and no unlisted file.
   - Copy `<LAB>/install` to `<LAB>/install.pre-cutover`, and `runtime.env` to `runtime.env.pre-cutover`.
2. **Install and load, with no service change.**
   - Replace `<LAB>/install` through a staged copy that is verified again against `SHA256SUMS`.
   - Run `bootstrap-load <R9>`, then `verify-images`: new API, proxy and OPS ids; data ids unchanged.
   - The old stack keeps serving (rehearsal RH3).
3. **Software cutover:** `start`. It recreates the API and proxy with the new images; loopback access is unchanged.
   - Check the readiness and provider identities on the recorded dataset.
   - Check that the data containers keep their ids.
4. **Certificate.**
   - Run `tls csr --names <VM_LAN_ADDR>[,<name>]`. The operator reads `<LAB>/home/secrets/tls/pending/server.csr` directly (0444; the key stays 0400).
   - Have it signed off-host.
   - Run `tls import --cert <leaf> --chain <intermediates> --ca <root> --names …`, then `proxy restart`.
   - Check that `tls status` shows the new SAN and fingerprint.
   - The previous set is kept in `secrets/tls/previous-<time>`; record that path for §4.
   - Control-path checks keep `Host: localhost` (or `127.0.0.1`) on the ordinary listener and verify the new root, with the LAN name as the TLS identity (rehearsal RR8).
5. **Edge.** Run `infra/edge/edge.sh <private env> check`, then `up`.
   - It publishes `<VM_LAN_ADDR>:<PORT>` with the exact locked proxy image and the namespace egress guard, and attaches to the lab network.
   - It prints `<EDGE_LAB_ADDR>`.
   - Approved clients reach a relay with nothing behind it until step 6.
6. **Relay on.**
   - Run `init --access loopback --bind 127.0.0.1 --server-names "localhost 127.0.0.1" --relay-peer <EDGE_LAB_ADDR> --relay-bind <NESTED_LAB_ADDR> --relay-port <RELAY_PORT> --relay-client-cidrs <APPROVED_CLIENT_CIDR> --relay-server-names "<VM_LAN_ADDR> [<name>]"`.
   - Then run `access apply` and `proxy restart`.
7. **Verify on the host.**
   - control readiness, `tls status`, published ports on both daemons (proxy relay port on `<NESTED_LAB_ADDR>` only; edge on `<VM_LAN_ADDR>:<PORT>` only);
   - `tests/offline/namespace-egress.sh` for the serving host and the edge, with `SINK_GATEWAY`, `HOST_CONTROL=<EDGE_LAB_ADDR>:8443`, and disposable sinks only on the lab network;
   - egress counter, container ids and PBF SHA-256 against the before-state.
   - **Not used:** a "negative check" from a container on another VM Docker bridge. Docker drops that traffic before the edge (verified on this VM), so it proves nothing.
8. **Verify from the LAN (owner's H-01).**
   - **Approved device:** it gets readiness 200 on the dataset with the expected certificate, plus docs, a tile and a route.
   - **Exact address at the inner layer:** rerun the step-6 `init` with `--relay-client-cidrs` set to a `/32` of another address, then `access apply` and `proxy restart`; the device must now get 403 from the relay. Then set the device's own `/32`; it must get 200. This shows the inner proxy sees the device's exact address through PROXY protocol, not the edge's. Restore `<APPROVED_CLIENT_CIDR>` afterwards.
   - **Refusal at the edge:** a second LAN device outside the approved subnet gets no response. Narrowing the edge allowlist instead would need a new edge container with a new lab address. Edge-layer refusal by exact source address is already shown in the rehearsal (RR5).
   - This step also proves that forwarded replies leave the VM. On 2026-10-19, TCP from Docker bridges to internet destinations timed out for an unknown cause, so this is not assumed.
9. **Record and close.** Record the measured times, recreated containers and every check in the private run directory, with sanitized evidence in Git. Clear the marker only after steps 7–8 pass. Any failed safety boundary means the rollback of §4.

## 4. Rollback (any failed step, or on request)

Rehearsed in this order on r8 and again on r9 with the evidence-based edge stop (RB0–RB5, RB0a/RB0b/RB1a). The measured not-ready times are about 0.5 s (relay off), 0.5 s (certificate) and 2.5 s (software).

1. `init --no-relay --server-names "localhost 127.0.0.1"`, then `access apply` and `proxy restart`. The inner proxy stops trusting the edge address and the LAN path closes.
2. `infra/edge/edge.sh <private env> stop`, then `remove`.
   - A stopped container releases its lab address at once, and Docker reuses it for the next container. So this step comes only after step 1.
   - `edge.sh stop` stops the edge only on positive, read-only evidence that the serving installation no longer trusts the edge's exact address: persisted `settings.json`, the running proxy's environment and publication, and an unchanged `runtime.env` since that proxy was created (RUNBOOK §6.2). A proxy that is down, restarting or not yet restarted after `access apply`, and any failed read, refuses and keeps the edge and its address. A closed relay port is not evidence. This was rehearsed in the corrective run `2026-10-20-c73db85-corrective`.
   - `stop --force` is for emergencies only and must be followed at once by step 1.
3. **Certificate:** `tls restore --from <LAB>/home/secrets/tls/previous-<time>`, then `proxy restart`.
   - It is validated like any import: key match, its recorded names (or its own SAN), purpose, and its saved chain to its saved root.
   - It is journalled; an interruption is completed or undone by `tls recover`.
   - Run it **before** step 4, with the r9 tools: the r3 CLI has no `tls restore`, and the r3 wrapper cannot pass a root-only `--from` backup (finding B5).
4. **Images and install:**
   - restore `<LAB>/install.pre-cutover`;
   - `bootstrap-load` the bundle the host was installed from (`<LAB>/transfer/<r3>`, read-only), so the tags point at the r3 images again;
   - `verify-images`.
5. `start`, which recreates the API and proxy with the r3 images and loopback-only access. Check readiness, ids and counters against the before-state.

## 5. Owner decisions needed for the cutover

1. ~~Safe resources for builds and rehearsal~~: done on this VM in an authorized window (§2).
2. **Cutover window** on the serving host, with the measured not-ready times above accepted as expected, not promised.
3. **Certificate issuer:**
   - the company CA, if one exists and devices already trust it (preferred);
   - or a development issuer run on a separate operator machine (`infra/tls/dev-issuer.sh`), with device trust installed and later removed as an explicit step.
4. **H-01 devices:** the approved Windows device, and a second LAN device outside the approved subnet for the edge refusal check (§3 step 8).

## 6. Trust model: current and proposed

| | Current serving host | Proposed |
| --- | --- | --- |
| Issuer | Legacy on-host test CA from `tls init`, created with the restored host | Company CA (preferred), or a development issuer on a separate operator machine |
| Issuer private key | On the serving host's disk: `<LAB>/home/secrets/tls/ca.key`, and in the operator copy `<LAB>/secrets-backup/tls/` | Never on the serving host, its containers, service or secrets backups, images, bundles or Git |
| Served certificate | Test certificate for loopback names only (details in the private operator record) | SAN exactly `<VM_LAN_ADDR>` (plus a DNS name if one is created); serverAuth; ≤ 825 days (dev issuer default 90) |
| On the server | Leaf key, leaf, CA cert **and CA key** | Leaf key (0400, proxy user), served chain, public trust anchor; `tls status` shows public metadata only |
| Client trust | Not usable for LAN clients | Public root only; for application-specific trust see the guide §8. System-wide trust on Windows or a device is a separate owner decision with removal steps |
| Revocation | None | Managed offline: short-lived leaves and re-issue. No OCSP, CRL or AIA fetch is an operational requirement; how Windows treats a CA without them is checked at H-01 |

- The legacy CA key is **not deleted** by this work.
- After the cutover, removing it (and the copy in the operator secrets backup) is a deliberate operator step. Synthetic fixtures still use `tls init` as a documented test-only path.
- The development root carries no name constraints and is not presented as restricted to one address: RFC 5280/6818 processing of such constraints is client-dependent.
