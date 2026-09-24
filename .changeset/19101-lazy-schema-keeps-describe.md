---
"@objectstack/spec": patch
---

JSON Schemas converted from a `lazySchema()` reference now carry the `description` the schema authored, the same as an `OS_EAGER_SCHEMAS=1` run (#19101).

Clause-②: no

zod reads `.describe()` / `.meta()` from its registry by node identity. A lazily built schema is referenced through a Proxy, while the metadata sits on the real instance behind it, so `z.toJSONSchema` found nothing and dropped the text. The published result depended on the evaluation mode. The Proxy now answers the real instance's metadata to that lookup, less `id`, which stays on the real instance so that zod's duplicate-id refusal is never triggered.

What changes: descriptions reappear. Nothing else does. Measured lazy against eager, leaf by leaf:

- `@objectstack/spec/openapi.json`, and the `GET …/openapi.json` document served from it, gains 2 (`ListRecordResponse.data[]` and `BulkRequest.records[]`);
- the `os generate` IDE schema gains 445;
- the approval-node and schemaless node-config schemas are unchanged.

No other key differs in any of them, and the eager outputs are byte-identical before and after. The accept set does not change: `description` is an annotation, never a validation keyword.
