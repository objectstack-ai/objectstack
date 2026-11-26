---
'@objectstack/spec': patch
---

docs(spec): the `FilterCondition` nested-relation docblock states the engine's three-relationship limit

Clause-②: no — comment-only edits in packages/spec; no schema, export or accept set moves
Metadata-protocol: none — no metadata key is touched

`@objectstack/spec`: comments only, in `src/data/filter.zod.ts`, which the package ships as source. The nested-relation form (`{ relation: { field: value } }`, form 4 on `FilterCondition`) and its three one-line mentions said the engine serves it one level deep; they now say up to three relationships deep (ADR-0071's 3-hop limit, `RELATION_CONDITION_MAX_HOPS` in objectql), with a condition past the third relationship refused as `INVALID_FILTER` / 400, and name the platform-provisioned `id`, `created_at` and `updated_at` beside the related object's declared fields as admitted keys.
