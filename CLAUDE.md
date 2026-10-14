# Seyra repository instructions

This repository implements an internal-network platform. Product requirements and prompts are maintained in English; user communication may be Persian.

Read the active project brief, requirements, architecture and acceptance documents before changing application code. Current authorized scope is Map Services phase 1 and its web test client. Authentication, Relation System, SOS and mobile application implementation require their own requirements intake.

Develop on a separate feature branch based on the supplied documentation commit. Preserve unrelated/local changes. Do not develop features on main, force push, merge, publicly deploy or silently change required scope.

Operations, installation, imports, startup, updates and local assets must have zero outside-network dependency. Software/image acquisition belongs to a separate preparation environment. Owner supplies OSM data; never auto-download or delete it.

All four map runtime capabilities are mandatory. Do not add disable toggles or opt-in runtime profiles. Use real providers; mocks only in tests. Unknown image digests, capability support and test results must be explicit, not fabricated.

Default test ingress is loopback; shared LAN tests require explicit allowlist/TLS configuration. No private user tracking/management data before module authorization. Keep credentials, private keys, datasets and generated large images/indexes out of Git; preserve source provenance and licence inventory.

Follow prompts/CLAUDE_MAP_SERVICES_IMPLEMENTATION.md for the development task. Record evidence and pending validation honestly. Exact waypoint-order optimum is scoped to the modeled pair-cost table; do not imply global road-route optimality. Temporal routing and multipoint alternatives are excluded from phase 1.
