---
"@objectstack/spec": patch
---

Give the declared-index `unique` surface its own rejection message, so the
platform stops prescribing a silent scope change (#10928).

`UniqueScopeSchema` is shared by `FieldSchema.unique` and `IndexSchema.unique`,
but its rejection text was written from the field-level viewpoint only:

```
Invalid unique scope 'nonsense_scope'. Allowed: true/false, 'organization'
(one holder per organization — the explicit spelling of true), or 'global'
(one holder across the whole installation).
```

The parenthetical is true at field level, where bare `true` resolves
per-organization. It is **false on a declared index**, where bare `true` sets
neither driver flag (`isGlobalUnique` / `isOrganizationUnique`) and the index
materializes over exactly `fields` — there `'global'` is what `true` spells, and
`IndexSchema.unique`'s own `describe()` already said so.

That message is read at the one moment it is most likely to be obeyed: the
author has just been refused on this very key and is looking for the accepted
spelling. An author holding a working `unique: true` on a declared index was
told `'organization'` is what it spells; taking that advice asks the driver to
prepend the NULL-safe organization key part at registration — a materialization
change, silently, on an index that may already exist on a deployed database.
That is the unannounced index reinterpretation ruled out by #8323 (maintainer,
2026-08-13) and staged by #5082, reaching authors through the platform's own
error text rather than at review time.

`object.zod.ts` now declares its own structurally identical union with a
sibling error map. On a declared index the refusal reads:

```
Invalid unique scope 'nonsense_scope'. Allowed: true/false, 'organization'
(one holder per organization — the driver prepends the NULL-safe organization
key part to `fields` at registration), or 'global' (one holder across the whole
installation — materialized over exactly `fields`, and the positional meaning of
bare true on a declared index: bare true is warned by lint
unique/unscoped-declared-index in 17.x and rejected at protocol 18, #5082).
```

The field-level message is unchanged — the hint is correct there and that is the
common surface.

**Message text only.** No accepted value, parse result, default, or scope
semantics changes on either surface, and the refusal envelope (`invalid_union`
on path `unique`) is identical to before — as #8323 requires. The new
`unique-scope-message.test.ts` pins both halves: the two surfaces say different
things about bare `true`, and they accept and reject exactly the same value
table with identical parse results, so the deliberately duplicated member list
cannot drift.
