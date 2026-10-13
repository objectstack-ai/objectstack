---
"@objectstack/metadata-protocol": patch
---

The metadata door serves a code-defined datasource's code definition while a stored row under its name still exists

Clause-②: no

- `GET /api/v1/meta/datasource/:name`, the `GET /api/v1/meta/datasource` list and the `effective` layer of `GET /api/v1/meta/datasource/:name/layers` now skip a stored `sys_metadata` row under a datasource name the host registers from code: one an installed package declares in `*.datasource.ts`, or the host's `default`. They serve the in-memory code definition instead. The datasource admin door and the boot restore already serve that ("code wins on collision"). Before this change the stored row was served first, so the two doors answered with two different bodies for one name.
- The decision is made by name, through the same predicate the reads already ask for a shipped flow name. It never reads a row's `origin`. Every other type keeps ADR-0005's read order, in which the stored overlay wins.
- Unchanged: the row stays at rest and is still reported in the layered read's `overlay`. The read envelope stays `deletable: true` while the row exists, and `DELETE /api/v1/meta/datasource/:name` still removes it as the repair. A draft read (`state: 'draft'`, or the draft preview) is still answered from the draft row. A runtime datasource's stored row is served as before.
- The `/meta` and admin doors already refuse to write such a row. This change affects only how a row left from before that refusal is read.
- Not moved: `GET /api/v1/meta/datasource/:name/published` still serves the stored row, which is the active overlay row that route describes.
- ⛔ No public export, signature, schema or accept-set change. The built entry declarations gain two `private` member names on `ObjectStackProtocolImplementation`.
