---
'@objectstack/spec': patch
---

fix(spec): the `ImportRequest.matchFields` describe says a multi-value or structured field is refused as a match key

Clause-②: no
Metadata-protocol: none

The `matchFields` describe of `ImportRequestSchema` (the body of `POST /data/:object/import` and `POST /data/:object/import/jobs`, which ships in the published JSON schema and the generated API reference) did not say that an `update` / `upsert` whose match key names a field that holds a list or a structured value is refused at the import door with `400 INVALID_REQUEST` before any row. A caller picking `matchFields` from the describe learnt it only from the refusal. The describe now names the refusal; the fields it covers (a `multiple: true` select, radio, lookup, user, file or image field, a `multiselect`, `checkboxes` or `tags` field, or a `json`, `composite`, `repeater`, `record`, `location`, `address` or `vector` field, the population the spec's `isMultiValueField` and `STRUCTURED_JSON_TYPES` define); that a named mapping's `upsertKey` used as the key is judged the same way; the remedy (match on single-value fields); and the runner's answer for a caller that reaches it without the door (a mapping's connector pull): every row failed with `VALIDATION_ERROR`. Text only: no schema, accepted value or server answer changes.
