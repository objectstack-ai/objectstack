---
"@objectstack/spec": minor
---

feat(spec): `RecordHighlightsField` declares `readonly` (#5176)

The object form of a `record:highlights` entry now declares an optional
`readonly: boolean`. It marks a highlight chip as non-editable — use it for
columns a hook or automation maintains, which must not be hand-edited from the
record header.

```ts
{
  type: 'record:highlights',
  properties: {
    fields: [
      'name',
      { name: 'supply_share', type: 'number', readonly: true },
    ],
  },
}
```

**Why this is a spec change and not a renderer detail.** The renderer's
`HeaderHighlight` gate already refuses inline editing on a chip carrying
`readonly`, but the key was not declared here — and the object member is not
`.strict()`, so `RecordHighlightsField` **silently stripped** it:

```
input   { fields: [ { name: 'supply_share', readonly: true, type: 'number' } ] }
parsed  { fields: [ { name: 'supply_share', type: 'number' } ] }
```

That worked end to end only because per-component props are not parsed on the
live load path today (`PageComponentSchema.properties` is
`z.record(z.string(), z.unknown())`, so the bag rides through untouched). The
moment that gate is wired up, an authored `readonly` becomes either a silent
strip — a machine-owned column quietly editable again, with no diagnostic
anywhere — or a hard parse error. Declaring the key makes the authored
declaration and the enforced behaviour the same fact, which is what ADR-0049
asks for: it is enforced on arrival, not declared-and-inert.

For authors — including AI authors — the key now appears in the generated
component reference, and a misspelling (`readOnly`, `read_only`) is a wrong key
rather than a second de-facto contract the renderer happens to honour.

Purely additive: `readonly` is optional and no default is materialized, so an
entry that does not author it parses exactly as before, and the bare-string form
of a highlight field is unchanged.
