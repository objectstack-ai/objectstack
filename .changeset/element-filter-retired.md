---
"@objectstack/spec": minor
---

feat(spec): retire the `element:filter` element at element grain (#9220, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`element:filter` never had a renderer or reader anywhere. Measured at
retirement (objectstack `2f65b1b42`, objectui `5ffcc14`; cloud per the origin
card's recorded sweep): objectui registers no renderer for it — its
`renderers/basic/elements.tsx` header deferred the element to "owning plugins"
that never materialized — Studio's designer palette carries it as a no-renderer
`PALETTE_EXCLUSIONS` entry ("list surfaces own filtering (userFilters / filter
builder)"), and the 2026-06 page-liveness audit recorded it rendering "Unknown
component type". Every one of its six authorable keys — `object`, `fields`,
`targetVariable`, `layout`, `showSearch`, `aria` — was a capability claim
nothing kept: an author (human or AI) who configured a filter element got a
success receipt for a component that renders nothing (the ADR-0078 shape).
\#9198 retired `targetVariable` per-key on the two input elements and recorded
this wider finding; per-key retirement would have been the wrong grain here, so
the whole element retires at once.

**What is refused:** any authored key on `element:filter` `properties`. All six
keys are `retiredKey()` tombstones — refused at `tsc` (typed `never`) and at
the parse, message carrying the element-grain prescription. The
`ComponentPropsMap` row deliberately STAYS so the #5068 props gate keeps
dispatching on the type and refusing loudly — deleting the row would demote the
type to an unregistered custom string the gate deliberately skips.

**What stays accepted:** a bare `element:filter` node with empty `properties`
(the migrated shape) still parses at the node level — `PageComponentSchema.type`
is an open union, so a node-level refusal is not expressible; the node was
always inert and stays inert. `element:filter` is removed from the
`PageComponentType` enum (de-advertisement — docs, palette derivations, and the
authorable vocabulary), which changes no parse outcome. Filtering on list
surfaces is unchanged and was never this element's: use a view's `userFilters`
quick-filter bar or the list toolbar's filter builder.

The retirement kit:

- tombstones at the schema (`packages/spec/src/ui/component.zod.ts`), enum
  removal at `packages/spec/src/ui/page.zod.ts`
- ADR-0087 registration: retired-key entries `ui/ElementFilterProps:object` /
  `:fields` / `:targetVariable` / `:layout` / `:showSearch` / `:aria` and the
  D2 conversion `element-filter-removed` (protocol 18), wired into the step-18
  chain — `os migrate meta --from 17` strips the keys from old sources (pure
  lossless deletes; none ever had an effect to lose) and leaves the bare node
- the #9198 conversion's negative-control fixture moves from `element:filter`
  to an open-union custom type (same assertion — the strip dispatches on the
  component type, not the key name)
- pin tests (`component.test.ts` — refusal carries the prescription; the
  bare migrated node parses clean and materializes nothing)
- generated baselines/docs follow the schema (`authorable-surface/`,
  `json-schema.manifest/`, spec-changes, upgrade guide, reference docs)

## FROM → TO

```ts
// before — parsed green; nothing anywhere rendered it
{
  type: 'element:filter',
  properties: { object: 'order', fields: ['status'], layout: 'sidebar' },
}

// after — delete the component; filtering belongs to the list surface
// (view.userFilters / the list toolbar's filter builder)
```

<!-- adr-0087: registered element-filter-removed -->
