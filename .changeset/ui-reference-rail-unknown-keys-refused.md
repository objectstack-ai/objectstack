---
"@objectstack/spec": minor
---

feat(spec): declare `record:reference_rail` in `ComponentPropsMap` — undeclared rail keys are refused (#8691)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`record:reference_rail` had a registered renderer, a `PageComponentType` entry
and a console palette slot, but no row in `ComponentPropsMap` — so the #5068
component-props gate's dispatch skipped it as unregistered and every authored
key rode through. Measured on 17.0.0 GA end to end: a planted entry `filter`
passed tsc, `objectstack validate` and `objectstack build`, shipped verbatim in
`dist/objectstack.json`, and the rendered rail kept counting and listing
unfiltered rows — while the very same build loudly reported
`record:related_list` keys in the same file.

The new row is strict and declares exactly the shape the renderer reads
(measured from its read points at the objectui pin, not from its TS
interface): `entries[]` of `{ objectName, relationshipField, title?, limit?,
displayField? }` plus a component-level `hideEmpty`.

**What is refused:** any key the shape does not declare, with a prescriptive
message — the planted `filter` (the rail issues one fixed query per entry;
`record:related_list` is where `filter` is real), the interface's `icon` (read
by no render path — declaring it would be declared-but-unenforced surface),
entry-level `hideEmpty` (a component-level key), and the neighbouring-surface
spellings `items`/`related` → `entries`, `object` → `objectName`, `label` →
`title`. `title` is a literal `z.string()` — the renderer paints it as a raw
React child, so an inline locale map is refused rather than shipped as
`[object Object]`.

**What stays accepted:** every declared key byte-identically. `limit` and
`hideEmpty` carry no schema default (the renderer's `3` / `true` fallbacks stay
the renderer's), so a minimal entry round-trips unchanged.

## FROM → TO

```ts
// before — parsed green everywhere; the badge kept counting everything
{
  type: 'record:reference_rail',
  properties: {
    entries: [{
      objectName: 'task', relationshipField: 'project_id',
      filter: [{ field: 'status', op: 'neq', value: 'completed' }], // silent no-op
      icon: 'CheckSquare',                                          // read by nothing
    }],
  },
}

// after — both keys are publish-time refusals with prescriptions; write only
// what the renderer reads
{
  type: 'record:reference_rail',
  properties: {
    entries: [{ objectName: 'task', relationshipField: 'project_id', limit: 3 }],
    hideEmpty: false,
  },
}
```

There is deliberately no automatic rewrite: an undeclared key is either a
spelling of a declared one (the rejection names the rename) or names a
capability the rail does not deliver — a per-entry `filter` and an inline
`title` locale map are open capability questions for the console seat, and
blessing either spelling now would be declared-but-unenforced surface
(ADR-0078). `os migrate meta` surfaces the change as a structured TODO
(semantic entry `ui-reference-rail-unknown-keys-refused`, protocol major 18 —
this refusal is not part of the v17.0.0 cut).

<!-- adr-0087: registered ui-reference-rail-unknown-keys-refused -->
