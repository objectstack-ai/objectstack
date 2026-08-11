---
"@objectstack/spec": major
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
---

refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

`FieldNode` declared two forms for one entry of `QueryAST['fields']`:

```ts
type FieldNode =
  | string                                                  // "name"
  | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
```

The object form was **declared-but-inert**. Nothing produced it, and nothing
read `.fields` or `.alias` — every consumer on the path treats the list as
`string[]`: `objectql`'s formula projection and its two known-field filters,
`driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
keyed its projection with the entry itself, so an object entry asked for a
column literally named `"[object Object]"`, and the REST ingress stringified
each entry before comparing it to the field map, so the same entry came back as
`400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
something the caller never wrote. An author who wrote
`fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
declaration; ADR-0049 enforce-or-remove).

The capability the object form described is already served, by a different key.
Removing the second spelling rather than lowering it into the first is Prime
Directive #12: one capability, one contract.

**FROM → TO**

| Was | Now |
| :--- | :--- |
| `fields: [{ field: 'owner', fields: ['name'] }]` | `expand: { owner: { object: 'user', fields: ['name'] } }` |
| `fields: [{ field: 'owner' }]` | `fields: ['owner']` |
| `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | the same `expand`, keeping the FK in your own projection (`fields: ['title', 'owner_id']`) — **not** a dotted `fields` path, which no driver resolves and the ingress refuses (#7532) |
| `fields: [{ field: 'total', alias: 't' }]` | `aggregations` / `windowFunctions` — they carry the live `alias` |

The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
`expand`, which the engine resolves through batch `$in` queries (default max
depth 3).

There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
shape, never stored in stack metadata, so the chain has no source to rewrite. It
is registered as an ADR-0087 D3 **semantic** migration
(`query-field-node-object-form-retired`) on the protocol-17 step instead — the
`EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
move their own select lists, and both channels tell them how:

- **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
  answers an object entry with the prescription above, not "expected string,
  received object". `z.input` becomes `string`, so `tsc` fails at the authoring
  site first.
- **The ingress.** `assertProjectionFieldsExist` judges the entry's *shape*
  before consulting the object's field map — it is wrong about the shape, not
  about this object, and a registry-less host would otherwise pass it to a driver
  that cannot read it. The 400 now names the retired form instead of the field
  `"[object Object]"`.

No runtime behaviour changes for anything that ever worked; the defensive
unwrapping the drivers had grown against a shape nothing sends goes with it.
