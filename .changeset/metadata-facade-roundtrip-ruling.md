---
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(objectql,spec): the `name` argument is `IMetadataService`'s effective key (#7378)

`register(type, name, data)` → `get(type, name)` now holds on `MetadataFacade`
for every `data`, which is what the other four measured implementations
(`MetadataManager` with and without a writable loader, `createMemoryMetadata`,
and the contract's own reference double) already did. Maintainer ruling of
2026-08-11 on #7378, option (a): **the argument is the effective key and
`data.name` never overrides it.**

**Contract (`@objectstack/spec`).** `IMetadataService.register` and `.get` now
state the rule instead of leaving it to the `@param` names — including for a
`data` that is not an object and so has no `name` to derive, since `data` is
declared `unknown`. `METADATA_ROUNDTRIP_CASES` gains an `array-data-roundtrips`
row: an array passes a `typeof data === 'object'` guard, so a store that keys by
spreading the document corrupts `[a, b]` into `{ 0: a, 1: b }` — the sibling of
the primitive row's silent loss.

**Behaviour change (`@objectstack/objectql`).** Two `MetadataFacade.register`
paths that derived the storage key from the document now derive it from the
argument:

- a document whose own `name` (or `id`) disagreed with the `name` argument was
  filed under the document's spelling, so `get`/`exists` missed it and
  `listNames` reported the other name. It is now stored, read, listed and
  unregistered under the argument, with the stored `name` reconciled to it.
- a non-object `data` — a string, number, boolean, array or `null` — was
  accepted with no throw and then filed under the literal key `undefined`,
  readable back through no member of the class. It is now boxed as
  `{ name, content }`, the shape this class's own reads already unwrap, and
  round-trips unchanged.

A host that relied on `MetadataFacade.register` keying by `data.name` or
`data.id` rather than by the argument it passed will see items move to the
argument's key. No in-tree caller does; the class reaches hosts only through the
package's root and `core` exports.

Not ruled and deliberately unchanged: the plural `objects` type alias (that
alias is `SchemaRegistry`'s own read-side special-case, and its conformance pin
stays a measured divergence with the escalation recorded on #7378), and the
loud-refusal option (c), parked as a v18 strictness candidate.
