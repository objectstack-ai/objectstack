---
"@objectstack/spec": minor
---

feat(spec): retire the `element:form` element at element grain (#9249, ADR-0049)

<!-- adr-0087: registered element-form-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`element:form` never had a renderer or reader anywhere — the #9220
(`element:filter`) shape one element over, recorded by that card's own verdict
sweep. Measured at retirement (objectstack `c684d00cfc`, objectui `76ceb1e`;
cloud per the origin card's two recorded readings at `5f1bf23f` and `a11458b`,
positive controls passing): objectui registers no renderer for it — its
`renderers/basic/elements.tsx` header deferred the element to "owning plugins"
that never materialized — and Studio's designer palette carries it as a
no-renderer `PALETTE_EXCLUSIONS` entry that names the live replacement ("no
renderer — use the object-bound `object-form` block"). The 2026-06
page-liveness audit already recorded it rendering "Unknown component type". So
the full form contract `ElementFormPropsSchema` declared — `object`, `fields`,
`mode`, `submitLabel`, `onSubmit` (CEL), `aria` — was a capability claim
nothing kept.

**What is refused:** every authored `element:form` key. All six are
`retiredKey()` tombstones, so authoring one is a `tsc` error and a parse error
carrying the prescription (fully-qualified key, why the element is dead, the
replacement, the `os migrate meta` pointer), dispatched through the KEPT
`ComponentPropsMap` row — deleting the row would demote the type to an
unregistered custom string the #5068 props gate deliberately skips.

**What stays accepted:** a bare `element:form` node with empty `properties`
(the migrated shape — the open `type` union accepts any string, and deleting
authored page nodes is a layout decision a mechanical conversion must not
make). It renders nothing, exactly as it always did.

The retirement kit:

- `retiredKey()` tombstones for all six keys at the schema
  (`packages/spec/src/ui/component.zod.ts`); the `PageComponentType` enum
  drops the value (de-advertisement — the open string arm still accepts it)
- ADR-0087 registration: six retired-key entries
  `ui/ElementFormProps:{aria,fields,mode,object,onSubmit,submitLabel}` and the
  D2 conversion `element-form-removed` (protocol 18), wired into the step-18
  chain — `os migrate meta --from 17` strips all six keys from authored
  `element:form` blocks (pure lossless deletes; none ever had an effect to
  lose) and leaves the bare node
- pin tests (`component.test.ts` — refusal pins assert the prescription per
  key; a positive pin parses the bare migrated node clean and asserts nothing
  materializes; the kept-map-row pin flips from parse to refusal)
- `packages/lint`'s `COMPONENT_FIELD_SPECS` entry drops (its own changeset);
  the component-translation `submitLabel` describes stop naming `element:form`
  as carrier (the orphaned-key decision is #10926, out of this card's scope)
- generated baselines/docs follow the schema (authorable surface/defaults,
  spec-changes, upgrade guide, reference docs)
- objectui's `elements.tsx` comment and Studio palette-exclusion lines are
  cross-repo and already queued under objectui#4935

## FROM → TO

```ts
// before — parsed green; nothing anywhere rendered it, so the page showed
// "Unknown component type" where the author expected a form
{
  type: 'element:form',
  properties: {
    object: 'lead',
    fields: ['name', 'email'],
    mode: 'create',
    submitLabel: 'Create Lead',
  },
}

// after — use the object-bound `object-form` block (#7751): rendered,
// designer-publishable, same intent (`objectName`, `fields`, `mode`,
// `submitText`)
{
  type: 'object-form',
  properties: {
    objectName: 'lead',
    fields: ['name', 'email'],
    mode: 'create',
    submitText: 'Create Lead',
  },
}
```
