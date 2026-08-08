---
"@objectstack/spec": minor
---

feat(spec): `element:record_picker` declares the flat `sort` / `limit` shorthands the renderer already honours (#6276)

`element:record_picker` resolves its query from four keys through one identical
pattern — the component-level `dataSource` first, the flat `properties`
shorthand second:

```ts
const object = ds.object ?? props.object;
const filter = ds.filter ?? props.filter;
const sort   = ds.sort   ?? props.sort;
const limit  = ds.limit  ?? props.limit ?? 50;
```

After #5775 the first two flat spellings were declared and the last two were
not, so one renderer read half a contract and half a trapdoor. An author who
inferred `properties.limit: 20` from the declared `object` / `filter` spelling
got the renderer's default 50 with **zero diagnostics**: the key was stripped
before anything could read it, the #5068 gate reported it as undeclared, and no
value check ever ran. That is the ADR-0078 shape, on the element that had just
been rewritten to remove it.

**Additive — nothing that parsed before stops parsing.** Both keys are optional
and take the shape `ElementDataSourceSchema` already declares for its own
`sort` / `limit`, deliberately: they are the same contract read through a second
spelling, so a divergent shape here would be a third sort dialect rather than a
shorthand.

```ts
// now declared, retained, and value-checked
{
  type: 'element:record_picker',
  properties: {
    object: 'showcase_project',
    sort: [{ field: 'created_at', order: 'desc' }],  // SortItem[]
    limit: 20,                                        // positive integer
  },
}
```

`dataSource.sort` / `dataSource.limit` still win when both are written — the
declaration documents the precedence, it does not change it. The renderer's
`?? 50` stays a **renderer** fallback and is deliberately not a schema default:
`.default(50)` would materialize a limit on every parsed picker and turn an
unset key into an authored one.

The maintainer's ruling (2026-08-08, direction A) is the #5611 rule applied
again — the delivered, authorized shape is the contract. Direction B, retiring
the whole flat family in favour of a single `dataSource` door, was not dropped:
it is a cross-element decision (`element:form` / `element:filter` carry the same
flat `object`), tracked as #6590 for v18, and this change does not block it.
