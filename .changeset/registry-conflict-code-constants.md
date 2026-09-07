---
"@objectstack/objectql": minor
---

The registry's three conflict refusals now publish their error `code` as an importable constant.

`SchemaRegistry`'s install-time and registration refusals each already told the reader, in their own docblocks, to identify them by `code` rather than `instanceof` — and offered nothing to import. `NAMESPACE_CONFLICT`, `DUPLICATE_ARTIFACT_OBJECT_NAME` and `OBJECT_OWNERSHIP_CONFLICT` were inline string literals, so the only way to follow that instruction was to re-spell the string in the consumer's own package, which acquires a `check:error-code-provenance` stamp site there and can then drift from what the engine throws with no compile error to say so.

Three new exports from `@objectstack/objectql`:

- `NAMESPACE_CONFLICT_CODE` — the ADR-0048 Phase 1 install-time namespace gate's refusal.
- `DUPLICATE_ARTIFACT_OBJECT_NAME_CODE` — the ADR-0130 D3 one-artifact object-name refusal.
- `OBJECT_OWNERSHIP_CONFLICT_CODE` — the ADR-0029 D3 single-owner-per-object-name refusal.

**Why `code` and not `instanceof`.** This package declares both realms in its own `exports` (`import` reaches `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding the other realm's copy of a class gets `instanceof` === false — measured, and silent. A `code` compare is the check that survives crossing that boundary.

**Nothing about the wire changed.** Each constant holds text byte-identical to the literal it replaces; the refusals throw the same `code`, the same `status: 422` and the same message as before. Existing consumers that spell the string themselves keep working unchanged — this adds an affordance, it removes nothing.

**The error classes stay unexported, deliberately.** Publishing them would publish the `instanceof` route this convention exists to replace.
