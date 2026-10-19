# Client handoff: build, rehearsal, cutover and rollback plan

Status: **plan for review; nothing in it has been executed.** Implementation preparation (code, documentation, focused tests) is committed; image builds, the rehearsal and any change to the serving host wait for the owner's decisions in §5. Values in angle brackets are operator-local; the filled-in copy lives outside Git.

Placeholders:
- `<LAB>`: the serving host's lab directory on the VM.
- `<HOST>`: the serving host container (nested Docker daemon).
- `<VM_LAN_ADDR>`: the VM's bridged LAN address.
- `<APPROVED_CLIENT_CIDR>`: the approved client subnet.
- `<NESTED_LAB_ADDR>`: the serving host's address on the internal lab network.
- `<EDGE_LAB_ADDR>`: the edge's address on that network. It is assigned at attach time, because the lab network has no user-configured subnet.
- `<PORT>`: the published HTTPS port.
- `<RELAY_PORT>`: the relay listener port.

Inside the serving host, the CLI runs as `DOCKER_HOST=unix://<LAB>/run/docker.sock SEYRA_HOME=<LAB>/home <LAB>/install/bin/seyra-maps …`. It runs from the VM against the nested daemon, not through the lab harness. The harness refuses every mutating phase on this unlabelled host by design (F4).

## 1. What changes, and what does not

| Item | Change | Data identity |
| --- | --- | --- |
| API image | Swagger UI plugin (pinned 5.2.6, local assets), documented OpenAPI, capabilities schema | unchanged dataset id |
| Proxy image | shared location include, optional relay listener (PROXY protocol, exact peer), diagnostics block, typed 413, render script | unchanged |
| OPS image | relay settings, `access apply`, `proxy restart`, `tls csr/import/status/recover`, publish and pair checks | unchanged |
| Data images (Tegola, Valhalla, Photon, Overpass, PostGIS, osmtools, geocoder-build) | **none**; must keep their locked ids | dataset `ds-…` and stores unchanged |
| Bundle | next bundle = these three relocked images, with the data images byte-identical; adds `runtime.relay.yml`, `infra/edge/`, `CLIENT_INTEGRATION.md` | — |

No Iran reimport and no PBF access are needed. The original readiness 503 of 18 October stays open.

## 2. Build and rehearsal on safe resources

**Inputs:** `infra/prepare/build-images.sh` lines for `api`, `proxy`, `ops` only, from a named commit. Then `node infra/prepare/write-lock.mjs`, and a check that the data image ids in the new lock equal the current lock. Then `seyra-maps bundle export` and the `SHA256SUMS` digest recorded out of band.

**Expected cost:**
- **Measured:** current image sizes are API 358 MB, proxy 99 MB, OPS 420 MB.
- **Estimated, not measured:**
  - each build runs `npm ci` plus TypeScript or Vite builds, at about 1–2 vCPU and 1–2 GiB RAM peak;
  - disk is about 1 GB of new layers plus build cache (the build cache is 9.3 GB today);
  - the bundle needs about 2.5 GB (all images; data images unchanged).

**Where (owner decision 1):**
- **(a) Preferred:** a separate preparation machine. Transfer the bundle; no co-located load.
- **(b) This VM, inside an agreed window:** builds one at a time, with `tests/validation/watch-serving-host.sh <HOST>` running.
  - Abort as soon as any threshold is crossed: available memory < 1.5 GiB, swap growth > 512 MiB, or the serving host not ready twice in a row.
  - On abort, stop the build (`docker kill` of the build container) and wait for recovery. Never restart the serving host.
  - Earlier co-located workloads did degrade it (boundary run, browser run 1).

**Rehearsal topology:** a disposable synthetic-fixture nested host, labelled for its own lab and created by `iran-offline-host.sh` on the fixture PBF. Plus a disposable edge (`infra/edge/edge.sh` with a rehearsal env file).
- It publishes only on a disposable test network, never on `<VM_LAN_ADDR>`.
- A client container on that network stands in for an approved client, and a second one stands in for an outsider.
- Steps:
  1. update r6 → next bundle through the strict gate;
  2. `tls csr` on the host, sign with a throw-away dev issuer, then `tls import`;
  3. `init` with the relay settings, `access apply`, `start`;
  4. measure the not-ready window, and which containers were recreated (expected: API and proxy only);
  5. run the boundary checks end to end through the published edge: approved client, outsider, forged PROXY, direct bypass, spoofed headers, unknown Host, diagnostics, 413, docs and spec;
  6. run `tests/offline/namespace-egress.sh` for both namespaces;
  7. run the rollback (§4) and measure it;
  8. clean up by label.

**Focused regressions already passing without Docker** (corrections H1–H5, run again on the new tree before any build):
- `tests/wrapper/test-wrapper-inputs.mjs`
- `tests/ops/test-tls-cli.mjs`
- `tests/offline/test-namespace-egress.mjs`
- `tests/security/test-error-contract.mjs`
- `tests/client/test-handoff-artifacts.mjs`

**Suites to rerun on the new images:**
- unit, typecheck and integration;
- `tests/security/check-ingress-roles.sh` (now including AC16.16–AC16.18);
- `tests/security/test-proxy-boundary.mjs` against the *new* proxy image, extracted with `extract-image-nginx.sh`;
- lifecycle (OPS changed), tamper, offline host and restore drill;
- the fixture browser audit;
- the Swagger UI browser check: zero external requests, zero CSP violations, no request before **Execute**.

The cutover can only be planned against measured numbers after the rehearsal.

## 3. Serving-host cutover (owner decision 2: window and go-ahead)

Preconditions:
- the rehearsal passed;
- the new bundle is verified with its digest recorded;
- a certificate is issued for `<VM_LAN_ADDR>` by the chosen issuer (decision 3);
- an owner-approved window;
- the before-state recorded: container id, start time, restarts, inner container ids, egress counter, PBF SHA-256, `runtime.env` hash, `tls status`, readiness.

1. **Stage (no service change).** Copy the bundle into `<LAB>/transfer/`. Copy `<LAB>/install` to `<LAB>/install.pre-cutover` and `runtime.env` to `runtime.env.pre-cutover`, both kept for rollback.
2. **Verify, then load.**
   - Compare the out-of-band digest of `SHA256SUMS`.
   - Run the strict entry checks (directories and listed regular files only), then `sha256sum --strict -c`.
   - Replace the install tree through a staged copy and verify it again.
   - Run `seyra-maps bundle load <bundle>` and `verify-images`: new API, proxy and OPS ids; data ids unchanged.
   - Tags change; running containers keep their images until recreated.
3. **Certificate.**
   - If not done before the window: `tls csr --names <VM_LAN_ADDR>`, then sign off-host (company CA or dev issuer).
   - Then `tls import --cert … [--chain …] --ca … --names <VM_LAN_ADDR>`, which validates the staged material before replacing and keeps the previous set in a `previous-…` directory (the rollback source for `tls restore`). The leaf, chain and root may be in any directories: the wrapper mounts each input read-only.
   - The control path keeps working with `--connect-to <VM_LAN_ADDR>:8443:127.0.0.1:8443` once `<VM_LAN_ADDR>` is also among the control server names.
4. **Edge.** `infra/edge/edge.sh <private env> check`, then `up`.
   - `up` publishes `<VM_LAN_ADDR>:<PORT>`, applies the namespace egress guard and attaches the edge to the lab network.
   - It prints `<EDGE_LAB_ADDR>`. Until step 5 completes, approved clients reach a relay with nothing behind it, so connections fail.
5. **Access.**
   - Run `init --access loopback --bind 127.0.0.1 --server-names "localhost 127.0.0.1 <VM_LAN_ADDR>" --relay-peer <EDGE_LAB_ADDR> --relay-bind <NESTED_LAB_ADDR> --relay-port <RELAY_PORT> --relay-client-cidrs <APPROVED_CLIENT_CIDR> --relay-server-names "<VM_LAN_ADDR>"`.
   - Then `access apply`.
   - Then `start`, which recreates the API (new image) and the proxy (new image, environment and relay port) and checks both publications.
   - The data providers keep running if the rehearsal confirms it.
6. **Verify.**
   - control-path readiness;
   - `tls status`;
   - published ports on both daemons;
   - `namespace-egress.sh` for the serving host and the edge;
   - egress counter, container ids and PBF SHA-256 against the before-state;
   - a negative check from a disposable container on a VM bridge (expect a closed connection at the edge).
   - The owner's Windows check H-01 follows: first an approved device, then the client-address check. A `/32` of that device on both layers proves the address is seen exactly; then restore the approved subnet.
7. **Record.** Measured not-ready time, recreated containers, and every check, written to a private run directory with sanitized evidence in Git.

The not-ready time is **not promised**. The synthetic L4/L5 activations, which recreate everything, measured about 29 s. An API and proxy recreate is expected to be shorter, and must be measured in the rehearsal.

## 4. Rollback (any failed step, or on request)

1. `infra/edge/edge.sh <private env> stop`: the LAN path is closed at once.
2. `init --no-relay --server-names "localhost 127.0.0.1"`, then `access apply`. This happens before the edge is removed, so its former lab address is never trusted for a later container.
3. Certificate: restore the previous set with `tls restore --from <LAB>/home/secrets/tls/previous-<time>`.
   - It is validated like any import: key match, its recorded names (or its own SAN), purpose, and its saved chain to its saved root.
   - It works with the full-chain backups that `tls import` makes.
   - It is journalled; an interruption is completed or undone by `tls recover`.
4. Images and install:
   - restore `<LAB>/install.pre-cutover`;
   - `bundle load` the bundle the host was installed from (`<LAB>/transfer/<previous bundle>`, read-only), so the tags point at the previous images again;
   - `verify-images`.
5. `start`, which recreates the API and proxy with the previous images and loopback-only access. Check readiness, ids and counters against the before-state.
6. `infra/edge/edge.sh <private env> remove`.

## 5. Owner decisions needed for the next step

1. **Safe resources for builds and rehearsal:** a separate preparation machine (preferred), or a window on this VM with the watcher and abort thresholds above.
2. **Cutover window** on the serving host after a passed rehearsal (date and time, and an accepted not-ready period once measured).
3. **Certificate issuer:**
   - the company CA, if one exists and devices already trust it (preferred);
   - or a development issuer run on a separate operator machine (`infra/tls/dev-issuer.sh`), with device trust installed and later removed as an explicit step.

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
