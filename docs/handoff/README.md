# Client handoff index

This file is the index of the **client handoff pack**: the declared set in `infra/handoff/build-client-pack.mjs`, built with `node infra/handoff/build-client-pack.mjs <out-dir>` and checked for links and key material. It is separate from the operational bundle. Operator material, such as `docs/handoff/DEPLOYMENT_PLAN.md`, evidence and the edge/issuer tooling, stays in the repository and is never part of the pack.

For the owner to pass to the web and mobile developers once the LAN endpoint is live. Nothing here is sent to anyone automatically. Operational values (address, port, subnet, certificate fingerprints, dataset bindings) are given privately by the owner and are not in this repository.

| For | Read | Status |
| --- | --- | --- |
| Both developers | [`../CLIENT_INTEGRATION.md`](../CLIENT_INTEGRATION.md): one shared API/asset contract, errors, retries, dataset changes, map styles | Prepared |
| Both developers | Swagger UI `/api/docs/` and `/api/docs/json` on the Seyra origin (same content as [`../openapi/map-services-v1.json`](../openapi/map-services-v1.json)) | Code ready; not yet served on the LAN |
| Web developer | §7 of the guide, and [`../../examples/web-dev-proxy/`](../../examples/web-dev-proxy/README.md) (local development proxy for `/api/` and `/maps/`) | Prepared; tested against a local stand-in only |
| Mobile developer | §8 of the guide, and [`../MOBILE_INTEGRATION.md`](../MOBILE_INTEGRATION.md) with recorded fixture pairs in [`../mobile-fixtures/`](../mobile-fixtures/README.md) | Prepared; no SDK executed |
| Owner (Windows) | §9 of the guide: `curl.exe` checks over trusted HTTPS | Pending the live endpoint (H-01) |

What the developers need from the owner, privately:
1. the base URL `https://<SEYRA_HOST>:<PORT>`;
2. the issuing CA's **public** certificate (never a private key);
3. confirmation that their device is in the approved subnet.

Not included: accounts or credentials (there is no Authentication in phase 1), provider or admin access, and Authentication, Relations or SOS, which need their own intake.
