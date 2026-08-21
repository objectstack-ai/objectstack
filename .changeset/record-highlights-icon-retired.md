---
"@objectstack/spec": minor
---

feat(spec): retire `record:highlights` highlight-field `icon` — advertised on six surfaces, drawn by nothing (#10054, ADR-0049)

<!-- adr-0087: registered record-highlights-field-icon-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`icon` on the object arm of `RecordHighlightsField` (`fields: [{ name, label?,
icon?, … }]` on a `record:highlights` component) was a real authoring surface
advertised on six author-facing surfaces — the union's own describe, the
`fields` describe, the lint entry-shape prose, the reference docs, and
objectui's input description — with ZERO read points, measured at the
2026-08-20 census in every direction: objectui's renderer normalizes the
authored object and carries `icon: f?.icon` into `HeaderHighlight`, whose chip
has no icon slot (its only `icon` occurrence is a button `size="icon"`); the
key is structurally unable to travel `useRegisterHighlightFields`, which
registers `names: string[]`; the Studio block designer publishes the field
list as a `string[]` input, so the key was never designer-publishable; and
every in-tree `record:highlights` producer authors bare string arrays. So an
authored `icon` parsed clean and was drawn by nothing — the #8691
reference-rail-`icon` shape, on the highlight chip.

**What is refused:** `icon` on an object-form highlight field. The arm is
`strictObject`, so the key is deleted from the shape and the unknown-key
rejection carries the retirement prescription via the arm's `guidance` entry
(fully-qualified key, why it was inert, the no-replacement guidance, the
`os migrate meta` pointer) — surfaced through the zod-4 union collapse by
`packages/lint/src/zod-issue-format.ts`'s arm unpacking.

**What stays accepted:** bare-string entries and `{name, label?, type?,
readonly?}` objects parse byte-identically. `readonly` behaviour is untouched
— it is the arm's one enforced key (#5176, HeaderHighlight's inline-edit
gate). There is no replacement for `icon`: the highlight chip renders label
and value only.

The retirement kit:

- strict deletion + `guidance` prescription at the schema
  (`packages/spec/src/ui/component.zod.ts`); the two advertising describes
  (the union's and `RecordHighlightsProps.fields`') no longer spell the key
- ADR-0087 registration: retired-key entry `ui/RecordHighlightsField:icon` and
  the D2 conversion `record-highlights-field-icon-removed` (protocol 18),
  wired into the step-18 chain — `os migrate meta --from 17` strips the key
  from the object entries of every `record:highlights` `fields[]` (pure
  lossless delete; it never had an effect to lose)
- pin tests (`component.test.ts` — the old parse-survival pin respells to the
  surviving surface; a refusal pin asserts the named `unrecognized_keys`
  rejection and its prescription through the union collapse)
- generated baselines/docs follow the schema (spec-changes, upgrade guide,
  reference docs); `packages/lint`'s entry-shape prose corrected
- objectui's plugin-detail input-description advertisement is cross-repo and
  follows on its own card

## FROM → TO

```ts
// before — parsed green; the renderer normalized `icon` into a chip with no
// icon slot, so the strip rendered identically with or without it
{
  type: 'record:highlights',
  properties: {
    fields: ['status', { name: 'budget', label: 'Budget', icon: 'dollar-sign' }],
  },
}

// after — delete the key; nothing replaces it (the chip renders label and
// value only)
{
  type: 'record:highlights',
  properties: {
    fields: ['status', { name: 'budget', label: 'Budget' }],
  },
}
```
