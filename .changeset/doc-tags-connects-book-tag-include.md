---
'@objectstack/spec': minor
---

feat(spec): declare `doc.tags`, so a book group's `include: { tag }` can finally match something (#4509)

`BookGroup.include` has always accepted two shapes — a glob over doc names, or
`{ tag: '<t>' }`. The tag variant could never match a single doc in any stack,
and not because the matcher was missing. Everything downstream already existed:

- `matchesInclude` compares `doc.tags` against the rule (`book.zod.ts`)
- the book route already forwards `tags: d.tags` into the resolver (`rest-server.ts`)
- `ResolverDoc` already declares `tags?: string[]` — annotated `(P3d; absent today)`

The gap was one line at the *authoring* end: `DocSchema` is `.strict()` and had
no `tags` key, so writing `tags:` on a doc was a parse error. Every doc therefore
reached the resolver with `tags === undefined`, and the variant matched nothing,
forever.

This is the enforce half of ADR-0049 enforce-or-remove. Removal was the
alternative and was rejected on two grounds: a union member has no clean
tombstone (`retiredKey` covers object keys), so authors would have received a
bare union error carrying no prescription — and it would have discarded a
working matcher to fix a declaration.

```ts
defineDoc({ name: 'crm_guide_lead', content: '# Leads', tags: ['tutorial'] })
defineBook({ name: 'crm', groups: [{ key: 'tut', label: 'Tutorials', include: { tag: 'tutorial' } }] })
```

Prefer a name convention (`include: 'crm_guide_*'`) where one exists — tags earn
their place when membership cuts *across* naming, e.g. a `tutorial` tag spanning
several feature prefixes, which no glob can collect.

Additive: `DocSchema` previously rejected `tags`, so nothing that parsed before
parses differently now.
