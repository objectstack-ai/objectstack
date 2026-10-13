---
'@objectstack/rest': patch
---

fix(rest): `GET /api/v1/openapi.json` documents a valid declared endpoint that the served read decorated, and stops logging it as a declaration to fix (#23083)

Clause-②: no

**What was wrong.** On a composition with no endpoint matcher (no `metadata` service with `matchEndpoint`, for example `@objectstack/verify`'s `bootStack`), the document is built from the `api` items `getMetaItems` serves. That read adds `_diagnostics` to every item, and `ApiEndpointSchema` is closed, so the document's own parse refused every valid declaration by that key. The endpoints were left out of the document. For each one, the server logged at `error` that the declaration did not satisfy `ApiEndpointSchema` and should be fixed. Measured on the showcase booted through `bootStack`: 0 of its 2 declared endpoints in the document, and 2 such `error` lines.

**What changes.**

- The document's parse first removes the read-time decorations (`METADATA_READ_DECORATIONS` from `@objectstack/spec/kernel`: `_diagnostics`, `_draft`). It is the same strip the seed door applies. On that boot the document now lists both endpoints, and no line about them is logged.
- The ADR-0010 envelope keys (`_packageId`, `_provenance`, …) are allowlisted by the schema and parse as before. Any other unknown key is still refused.
- A declaration that really is invalid is still left out of the document and logged at `error`. The log line no longer says that the endpoint matcher excludes the item too. The document's parse does not know that: the matcher judges its own stored copy after removing the storage envelope, and where no matcher is reachable there is none to ask.

**Upgrading.** Nothing to change. `ApiEndpointSchema` is unchanged.
