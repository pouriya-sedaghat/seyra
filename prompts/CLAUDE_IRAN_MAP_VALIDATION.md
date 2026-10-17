# Validate Seyra Map Services with owner-supplied Iran data

Work in `pouriya-sedaghat/seyra`. Reviewed implementation: `9f0d7925eef0d43fc157cdd64b557b962df457a6`, branch `feat/map-services-v1`, draft PR #1. Inspect current refs and preserve unrelated work. Do not reset, force push, merge or change main.

Read `CLAUDE.md`, the current Map Services brief/requirements/architecture/acceptance documents, `docs/RUNBOOK.md`, `docs/TEST_RESULTS.md`, and these artifacts from `origin/review/map-services-pr1-9f0d792`:

- `docs/reviews/PR1_9f0d792.md`
- `docs/validation/IRAN_VALIDATION_INPUTS.md`
- this prompt, `prompts/CLAUDE_IRAN_MAP_VALIDATION.md`

Use `git show` or a separate checkout to read the review branch; do not merge it. The follow-up review closed R3/R5 within its scope. This task validates real owner data and the declared execution environment; it does not implement Authentication, Relations, SOS or a mobile application.

## 1. Preflight before any installation/import

Start read-only. Identify where the session actually runs. Do not call a cloud container the owner's computer. Collect OS/kernel, CPU architecture/cores, RAM, swap, free disk, filesystem type for SEYRA_HOME, Docker/Compose versions, existing Seyra containers/projects/networks, available local image identities, bundle/install location and source-file availability.

Read the intake and collect missing values the operator has not already supplied. Required before import: a local owner-provided Iran PBF and a dedicated validation environment/home with adequate resources and matching locally loaded images. If these are absent, produce a concise BLOCKED preflight listing the exact missing inputs. Do not fetch public OSM data, invent a path, change the reference architecture or start a partial provider stack.

The CLI currently uses fixed Docker project/network names. A different SEYRA_HOME on a shared daemon is not isolated. Do not stop or recreate another Seyra deployment. Use a dedicated host, VM or Docker daemon for the run. Local Linux storage is required for the lifecycle flock; network shares are outside the validated environment.

The owner has explicitly authorized the test VM's Internet connection for setup, testing and image acquisition. It may first act as an **online preparation environment**, then run an isolated offline product-validation phase on the same VM. During preparation, acquire missing pinned images/source/build dependencies through the existing workflow, or load/transfer the previously verified bundle. Custom `seyra/*` images must not be assumed publicly pullable. If rebuilding is necessary, preserve pinned source/version provenance, generate actual image identities through the project's lock workflow and rerun affected checks; never change expected identities just to make unverified artifacts pass.

Before the operational phase, verify the trusted bundle checksum and all locked image IDs. Installation from that prepared bundle, import, startup, updates, map assets and restore must require no Internet. Deny/capture external egress for the product/test namespaces and audit browser requests while keeping VM/Claude access available. Record authorized online preparation downloads separately from offline operational evidence. Do not change the host's global firewall or exclude product-controlled requests from the offline audit.

Compute the owner's source checksum and inspect its PBF header/counts/bounds using the pinned local tools. Preserve the original read-only. Use a header snapshot time if present; otherwise ask for the real snapshot timestamp or explicitly retain unknown provenance. Do not invent dates. Honor the importer's free-space guard; its default 40× input factor is a guard, not measured Iran capacity. Do not lower it merely to make a failing preflight pass or delete unrelated data.

## 2. Execute on the dedicated validation environment

Once the required inputs and resource checks are satisfied, continue without another routine confirmation. Follow the existing runbook and retain all four mandatory providers. Start with loopback HTTPS; shared LAN requires the operator's actual CIDRs/DNS/certificate configuration.

Run init, verify-images and a complete Iran import with staging validation, then verify-release and activate within the isolated validation environment. Record the exact git commit, source SHA-256 and timestamp provenance, dataset_id, component image IDs and bundle digest.

Measure each import step's wall time and output size, minimum observed free disk, observed host/container memory and CPU, and total storage with staged/retained releases. State the sampling method and interval: an observed peak is not a guaranteed resource ceiling. If a guard fails, the host exhausts resources or a provider fails, preserve sanitized evidence and the failed-release state; do not claim success from partial output.

Verify that all provider identities correspond to the active release. Exercise the actual web client and API on Iran geography. Synthetic fixture tests have hardcoded fictional coordinates and expected objects: retain them as a separate regression dataset, never treat them as Iran acceptance tests.

## 3. Quality and functional validation

Build an explicit small real-Iran fixture set from owner-approved queries and locations. For each test, state the expected place/area or rule and its evidence. Do not infer ground truth from the same endpoint being tested.

Cover fa/en search, reverse geocoding, autocomplete and normalization variants; report top-k/rank and misses. Measure available house-number/address/postcode/POI coverage from the supplied snapshot before promising exhaustive address support. Distinguish missing OSM data from indexing or relevance errors.

Inspect light/dark and fa/en map views across representative urban/rural and border areas, with local font/sprite/glyph assets. Audit runtime requests for external dependencies. Measure approved catalog layer/POI coverage and document exclusions; do not claim every raw OSM tag is rendered.

Exercise supported routing combinations for car/pedestrian/motorcycle, time/distance objectives, alternatives for two points, ordered and optimized stops, all three proximity metrics and both directions. Preserve the phase-1 exclusions and engine objective/optimality labels. Use known route/access fixtures and explicit unreachable outcomes; do not claim Iranian legal restrictions are enforced where the input lacks the necessary tags.

Collect sequential baseline latency initially. Run bounded load/soak only after the owner supplies the expected concurrency, request mix and acceptance targets; do not invent an SLA or extrapolate national capacity from the synthetic map.

## 4. Lifecycle and recovery on real data

Within available capacity, verify restart, same-dataset identity consistency, backup-generation integrity and recovery on the declared environment. Prefer a fresh isolated restore target and exercise rebuilding from the owner's original file with the recorded checksum, so the path without `--include-sources` is validated. Preserve secrets/TLS separately and follow the documented restore order.

A real update test needs a second actual snapshot. Do not present a changed timestamp on the same PBF as validation of updated Iran data. Mark unavailable lifecycle/load/mobile checks NOT RUN or BLOCKED with precise reasons and commands. Do not prune owner data or test destructive recovery against an existing deployment.

## 5. Deliver evidence and findings

Keep raw PBFs, indexes, image archives, credentials, private keys and sensitive logs out of Git. Commit sanitized environment/provenance metadata, quality fixtures, measurements and reproducible commands under `docs/validation/iran/` on the existing feature branch. Update TEST_RESULTS and IMPLEMENTATION_STATUS while preserving historical synthetic results and labeling the new dataset/environment clearly.

Do not change provider versions, schemas, scope or product architecture merely to improve a benchmark. Reproduce any newly discovered defect and report its cause and proposed correction before a substantial implementation change; make only necessary validation harness/documentation changes in this task.

Push normally and keep PR #1 draft. Return completed versus pending acceptance items, measured resource/performance/quality results, defects (if any), and exact remaining operator decisions. Production acceptance, licences, mobile and other modules are separate gates.
