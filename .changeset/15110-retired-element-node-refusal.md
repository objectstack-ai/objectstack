---
'@objectstack/spec': minor
---

feat(spec): `element:filter` and `element:form` are refused BY NAME at the node, and the typo suggester stops renaming authors into retired types (#15110)

Two halves of one vocabulary defect, and only one of them is a narrowing.

**BREAKING** — a bare `element:filter` / `element:form` component node no longer
parses. Both elements were retired whole at element grain (ADR-0049
enforce-or-remove): no renderer for either ever shipped in objectui, framework
or cloud. Every authorable key became a `retiredKey` tombstone at the time, but
the node itself kept parsing, and each schema's own docblock recorded that as a
limitation rather than an intention:

> A bare node with empty `properties` parses clean (the open `type` union
> accepts any string, so a node-level refusal is not expressible here)

It is expressible one level up. Both names join
`RETIRED_PAGE_COMPONENT_TYPES`, so `PageComponentSchema.type` refuses them with
a located prescription — the same door already built for `user:profile`.

```
FROM  PageComponentSchema.safeParse({ type: 'element:filter' })
      -> { success: true }                       // nothing renders it; the console
                                                 // drew the unknown-type panel

TO    PageComponentSchema.safeParse({ type: 'element:filter' })
      -> { success: false,
           issues: [{ code: 'custom', path: ['type'],
                      params: { retiredComponentType: 'element:filter' },
                      message: '`element:filter` was removed in @objectstack/spec 17 …' }] }
```

**The prescription is not new prose.** Each node message is the element-grain
TAIL of that element's own `retiredKey` tombstones with the `property <key>`
clause dropped, so the node door and the props door carry one text — pinned
byte-for-byte in `component.test.ts`. An author who writes `element:filter` is
told to delete the component and use a view's `userFilters` quick-filter bar or
the list toolbar's filter builder; an author who writes `element:form` is sent
to the object-bound `object-form` block.

**What does NOT change.** The rows stay in `ComponentPropsMap` — deleting one
would demote a loud retirement to a silent skip on every reader that dispatches
on it — so both rows keep refusing each retired key with its own per-key
prescription, and `isKnownComponentType` still answers `true` for both. The open
string arm is untouched: `object-grid`, `mcp:connect-agent`, `custom.widget` and
every live `element:*` member parse exactly as before. The two D2 conversions
still strip the keys and still leave the node; what changes is that the node
they leave is now refused by name instead of sitting inert, and their prose says
so.

**The other half is a plain bug fix, no accept set involved.**
`KNOWN_COMPONENT_TYPE_CANDIDATES` — the typo-suggestion pool behind the
`component-type-unknown` authoring rule — was derived from every known type,
retired ones included. Measured through the rule:

```
FROM  type: 'element:fitler'  ->  hint: "Rename `element:fitler` → `element:filter`."
TO    type: 'element:fitler'  ->  hint: "Use a declared component type from the standard
                                         vocabulary, or … give it its own namespace …"
```

The tool was renaming an author INTO a retired element — a rename the parser
refuses. The pool is now the known set minus whatever the vocabulary retired,
derived from the retirement map rather than restated beside it, so a type
retired tomorrow leaves the pool the day it lands. Live spellings are
unaffected: `global:serch` still proposes `global:search`, `record:detials`
still proposes `record:details`, `element:butotn` still proposes
`element:button`.

Also corrected: the vocabulary docblock described the `ComponentPropsMap` row
set as a superset of the enum by "exactly" the string-arm registrations plus the
two tombstoned elements — one member short since `user:profile` joined it.

<!-- adr-0087: not-required (already-registered element-filter-removed, element-form-removed) both elements' retirement is already in the protocol-18 ledger — these two conversions plus all twelve retired-key tombstones; this change registers no new retirement, it closes the node-level half of those same entries and reuses their prescriptions verbatim -->
