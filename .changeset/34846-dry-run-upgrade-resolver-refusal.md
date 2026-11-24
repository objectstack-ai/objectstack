---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): a dry-run re-install answers a refused installed copy or incoming package with a 422, never a 500

Clause-②: no
Metadata-protocol: none

`POST /api/v1/marketplace/install-local` with `dryRun: true` compares the installed copy (the body the last install stored) with the incoming version. When today's artifact resolver refused either body (for example, a stored copy that still carries a retired key such as a bare `indexes[].unique: true`), the dry run threw, and the transport answered `500 INTERNAL_ERROR`. It now answers the way the real install already does: the refusal's own `422` and code (`INVALID_ARTIFACT_PACKAGE_ENTRY` and its siblings). When the stored copy is refused, the message names that copy and the way out: uninstall the package, then install the new version. When the incoming package is refused, the message names the incoming package. Nothing is planned or written. A dry run whose two bodies both resolve answers the plan exactly as before.
