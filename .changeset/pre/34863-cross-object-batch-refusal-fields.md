---
'@objectstack/rest': patch
---

fix(rest): `POST /api/v1/batch` answers a request-schema refusal with the per-field `fields[]` list

Clause-②: no
Metadata-protocol: none

A cross-object batch body the request schema refuses (for example `{"operations":"x"}`, or `{}`) is still answered `400 VALIDATION_FAILED`, but the answer now carries `fields`, the same list of `{ field, code, message }` entries the per-object batch doors (`/data/:object/batch`, `createMany`, `updateMany`, `deleteMany`) answer: `{"operations":"x"}` names `operations` with `invalid_type`, `{}` names `operations` with `required`, and an operation missing its object names `operations.0.object` with `required`. A client's `err.fields` (`@objectstack/client`) is now filled on this door too.

The raw schema-library `issues` list is no longer on this refusal: field errors are mapped at the boundary, never passed through (ADR-0114 D3), and no client, SDK or test read it. A caller that read `issues[i].path` reads `fields[i].field` (the path joined with dots) and `fields[i].code` instead.
