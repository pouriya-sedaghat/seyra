# Seyra — Map Services Requirements Intake

Version: 0.1
Status: OPEN — answer before technical research, architecture selection, or implementation.
Related brief: `docs/PROJECT_BRIEF.md`

## Confirmed

- Map Services is the first module.
- Delivered scope includes a tile server, routing engine, geocoder, and Overpass service.
- Map services must run using Docker images; Tegola was mentioned only as an example.
- Backend: Node.js and TypeScript. Application database: PostgreSQL/PostGIS.
- Operations, installation, and updates must work without Internet or external-network access.
- The web client must provide agreed functionality when disconnected from the server.
- Future consumers include the monitoring map, relation-based location tracking, and operator-managed SOS dispatch. Those modules will have separate requirements intake.

## Questions requiring user input

### M01 — Geographic coverage and data

- Which countries, provinces, cities, or other boundaries must the first version cover?
- Will the user supply map data such as an OSM `.pbf` extract, or should the project define how data is acquired outside the operational network and transported into it?
- Are there proprietary or organization-specific map layers/data to import?
- How frequently must map data be updated? Are licensing or redistribution constraints already specified?

### M02 — Map display

- Which map types are required: street map, terrain/topographic layers, satellite imagery, or others?
- Is a vector or raster tile format contractually required, or should format selection follow the requirements study?
- Are Persian labels, additional languages, custom styles, layer controls, or specific zoom levels required?

### M03 — Routing and proximity

- Which travel modes are required: cars, walking, bicycles, motorcycles, heavy vehicles, or other profiles?
- Which features are needed initially: shortest/fastest routes, alternatives, multiple stops, restrictions, directions, or distance/time matrices?
- For future SOS candidate selection, is "nearest" defined by straight-line distance, road distance, travel time, or a configurable rule? Only the metric is being clarified here; SOS lifecycle requirements are deferred.

### M04 — Geocoding

- Is forward search required for addresses, place names, POIs, and coordinates?
- Is reverse geocoding required?
- Are autocomplete, Persian/English search, spelling tolerance, or custom organizational addresses required?
- Are there examples of searches that must work well in the chosen geographic area?

### M05 — Overpass

- What concrete scenarios require Overpass: POI search, roads/buildings, custom filters, or another use case?
- Is compatibility with the full Overpass API/query language required, or would a controlled set of queries meet the contract?
- Which consumers may query it: backend services, operators, end users, or external systems inside the internal network?

### M06 — Disconnected web client

- When the client loses its server connection, which capabilities must continue locally: map viewing, routing, geocoding/search, location recording, or queuing user actions?
- What geographic extent and zoom range must be provisioned onto each client? Are browser/device storage limits known?
- Must offline functionality work on the first visit to a newly provisioned device, or can initial connection/download be required?
- Which browsers/devices will be used? Must the data survive browser restart?
- Full location/SOS/relation synchronization rules will be elicited in their respective modules; do not infer a server delivery guarantee during disconnection.

### M07 — Deployment, capacity, and operating procedures

- What are the target server operating system, CPU architecture (for example x86_64 or ARM64), CPU, RAM, and available SSD storage?
- How many users and concurrent map/search/routing requests should the first deployment support? Estimates are acceptable.
- Are response-time, availability, backup/restore, or installation-time targets defined?
- Are there mandated Docker images/vendors, an existing internal registry, deployment restrictions, or a required package-transfer medium?
- Must individual map services be disableable? If so, which combinations must be supported while retaining the contracted delivered capabilities?
- If a selected map service needs storage beyond the application PostgreSQL/PostGIS database, is that acceptable subject to review?

## Record after answers

For each answer, preserve its ID and mark it CONFIRMED, PROPOSED, or UNRESOLVED. Research must produce a requirement-to-capability matrix, official source links, image/license/storage considerations, a proposed deployment design, and measurable acceptance criteria. Unsupported combinations and unresolved requirements must be explicit.
