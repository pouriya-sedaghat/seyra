# Client handoff implementation preparation: evidence (2026-10-19)

Implements `prompts/CLAUDE_MAP_CLIENT_HANDOFF_IMPLEMENT_V03.md` and brief v0.3 §7. Both are on the planning branch at `ad24173`, which was read with `git show` and not merged. Baseline `d63f1d9`.

**Scope of this turn:** code, documentation and low-footprint tests only.
- **Not done this turn:** no image was built, no bundle exported, no Docker service or browser workload started, no port published, no relay started, and no live setting, certificate or install tree changed.
- **What did run on the VM daemon:** the only Docker operations were read-only `inspect`/`exec` listings, and `docker image save` of the locked proxy image to extract its nginx binary. No container was created.
- **Serving host and PBF:** checked unchanged at the end, recorded privately: same container, start time and 0 restarts, same inner container ids, egress counter 0, same PBF SHA-256.

Operational values (addresses, subnet, serving-host identifiers, certificate metadata, dataset binding) are in the owner-only operator directory, not here.

| Check | Command | Result |
| --- | --- | --- |
| Workspace build (contracts → map-assets → api, ops, web) | `npm run build` | rc 0 ([`build.txt`](build.txt)) |
| Typecheck | `npm run typecheck` | rc 0 ([`typecheck.txt`](typecheck.txt)) |
| Unit / HTTP injection / schema / temp-certificate tests | `npm test` | **219 PASS**: contracts 12, map-assets 6, API 54 (+8 docs), OPS 147 (+20 relay, +21 TLS) ([`unit-summary.txt`](unit-summary.txt)) |
| Ingress and relay boundary with the **exact locked proxy image's nginx** (1.28.3, `sha256:07e3eca2…`) and the real API | `node tests/security/test-proxy-boundary.mjs <extracted>` | **100/100** ([`test-proxy-boundary.txt`](test-proxy-boundary.txt)) |
| Web development proxy | `node tests/client/test-dev-proxy.mjs` | **35/35** ([`test-dev-proxy.txt`](test-dev-proxy.txt)) |
| Persian seed runner evaluation (offline) | `node tests/validation/test-search-seeds.mjs` | **18/18** ([`test-search-seeds.txt`](test-search-seeds.txt)) |
| Earlier boundary regressions, unchanged | update gate, host guard, navigation, verdict, reclaim credit | 74/74, 26/26, 0 failures ×3 |
| External URL inventory (now incl. Swagger UI assets, relay/edge templates, served spec) | `scan-external-urls.sh` | 0 unclassified ([`external-urls.txt`](external-urls.txt)) |
| Swagger UI pin | registry integrity, signatures, declared range | 5.2.6; integrity matches; 165 signatures and 61 attestations verified ([`swagger-ui-pin.txt`](swagger-ui-pin.txt)) |

**What the boundary test proves**, with the image binary on loopback:
- **Render refusals:** 16 unsafe access/relay settings are refused.
- **Configuration:** `nginx -t` passes for loopback, direct LAN and relay modes and for the edge `stream` config. The stream, `stream_realip` and `http_realip` modules are compiled in ([`proxy-image-nginx-V.txt`](proxy-image-nginx-V.txt)).
- **Control path:** works without a PROXY header.
- **End to end** (approved client → edge → relay → API, map assets, Swagger, spec and web): all paths reachable.
- **Refusals:**
  - an outsider is dropped at the edge before TLS, and gets 403 for every path class at the relay;
  - an untrusted peer forging an approved address gets 403;
  - a direct bypass of the edge gets 403;
  - a missing or malformed PROXY header gets no response;
  - a client's own PROXY header through the edge is not admitted;
  - spoofed `X-Forwarded-For`/`X-Real-IP`/`Forwarded` headers are ignored;
  - an unknown Host gets 421, including the control name `localhost` on the relay listener;
  - 16 diagnostics path variants × GET/HEAD never reach the API handler;
  - a body over 64 KiB gets a typed 413;
  - the docs page carries exactly one CSP, the ingress one.

**Not run in this turn** (no PASS is claimed):
- image builds, relock, bundle;
- the full-stack security suite (incl. new AC16.16–18), lifecycle, offline host and restore drill;
- the Swagger UI and fixture browser checks;
- the disposable cutover rehearsal and `tests/offline/namespace-egress.sh`;
- live Iran seed measurement (`tests/validation/search-seeds.mjs`);
- Windows, LAN, mobile and load checks.

The plan is in [`../../DEPLOYMENT_PLAN.md`](../../DEPLOYMENT_PLAN.md).
