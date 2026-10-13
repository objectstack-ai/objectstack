---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

feat(spec): `ReadableIds`, the branded `$in` comparand leaf meaning "the ids of object X this caller may read" (ADR-0139 D1)

Clause-②: yes (widening)

- **What is new in `@objectstack/spec/data`.** `ReadableIds.of(object)` builds a frozen leaf, `{ object }`, placed as the comparand of `$in` on a pointer field: `{ record_id: { $in: ReadableIds.of('cpz_doc') } }`. `isReadableIds(value)` answers whether a value is one. `READABLE_IDS_BRAND` is the `Symbol.for('objectstack.filter.readableIds')` key the brand lives under. The `ReadableIds` type carries the brand, so an object literal does not type-check as one. `ReadableIds.of()` throws a `TypeError` for an object name that is not a non-empty string.
- **No request can spell it.** No filter operator is added. The brand is a non-enumerable symbol-keyed property, so JSON, a structured clone or a spread produces an unbranded `{ object }`, and a plain object as the comparand of `$in` is refused `INVALID_FILTER` / 400, as it was before.
- **The comparand-shape door admits it only for a caller that composes it.** `assertListComparandShapes` takes an optional fourth parameter, `ListComparandShapeOptions`. With `{ admitReadableIds: true }` a branded leaf is admitted as the comparand of `$in`, and nowhere else. Without it, which is every existing caller (`parseFilterAST`, the save door, the analytics doors, the RLS compiler), the leaf is refused as a non-list comparand, unchanged.
- **`@objectstack/objectql` does not compose the leaf yet.** The engine's comparand door passes the option, then refuses a branded leaf found anywhere in a `where`, an aggregation's `filter` or a `having` with `INTERNAL_ERROR` / 500, before any driver is asked. Do not emit the leaf until the engine composes it. Until then, read the parent object as the caller and match the ids that read returns with a list.
- Nothing emits the leaf yet, and no read that ran before this change answers differently.
