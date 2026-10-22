---
'@objectstack/spec': patch
---

docs(spec): `api.enableOpenApi` and the `api.documentation.enabled` refusal name only the OpenAPI document; the retired docs viewer page is no longer described

Clause-②: no
Metadata-protocol: none

The REST server no longer serves an HTML viewer page at `GET {basePath}/docs`; it serves the machine-readable OpenAPI document at `GET {basePath}/openapi.json`, gated by `api.enableOpenApi`. The spec text now says only that:

- **`RestApiConfigSchema.enableOpenApi`.** The description read "Enable OpenAPI 3.1 spec & docs viewer endpoints", and the TSDoc named a Scalar-rendered viewer at `GET {basePath}/docs`. Both now name the one endpoint the flag mounts, `GET {basePath}/openapi.json`.
- **The `api.documentation.enabled` refusal.** Its prescription said `api.enableOpenApi: false` leaves "the `/openapi.json` document and its `/docs` viewer unmounted". It now says the switch leaves the `/openapi.json` document unmounted. The key is refused exactly as before, at the same path, with the same opening sentence; only the closing words changed.
- **The `rest-api-config-dead-keys-retired` upgrade entry** (shown by `os migrate meta` and the upgrade guide) drops the viewer from its replacement and acceptance text the same way.

No schema accepts or refuses anything new, no default changes, and no export moves.
