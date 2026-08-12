---
'@objectstack/spec': major
---

Close the responsive/SDUI-styling shapes against unknown keys (#4001 batch 13, ADR-0078)

zod's default is `.strip`: a key a schema does not declare is silently discarded
and the parse still succeeds. On an authoring surface that is the worst failure
mode — the author (increasingly, an AI) gets a success envelope and ships
metadata that quietly ignores what they wrote.

**BREAKING.** All four shapes in `ui/responsive.zod.ts` now raise a named,
fixable error instead of dropping the key: `ResponsiveConfigSchema`,
`ResponsiveStylesSchema`, and the two per-breakpoint maps behind
`responsive.columns` / `responsive.order`.

**What this actually fixes is a nested one.** `PageComponentSchema` has been
`.strict()` since ADR-0089 D3a — and that never reached these blocks, because
strictness does not recurse. So this component parsed **clean**:

```ts
PageComponentSchema.parse({
  type: 'element:text', id: 't1',
  responsiveStyles: { lg: { fontSize: '40px' } },
  responsive: { colums: { lg: 4 }, hideOn: ['xs'] },
})
// → { …, responsiveStyles: {}, responsive: {} }
```

Every styling and layout instruction the author wrote, gone, reported valid — the
node renders unstyled and nothing says why.

**The renames, and where the wrong word comes from.** This file carries TWO
breakpoint vocabularies sixteen lines apart on the same page component:
`responsiveStyles` uses ADR-0065's desktop-first buckets, `responsive` uses the
Tailwind `xs`…`2xl` ramp. Crossing them is not a typo and edit distance cannot
bridge it, so the aliases run both ways:

| you wrote | write instead | where the other word comes from |
|---|---|---|
| `responsiveStyles: { xs / sm / md }` | `xsmall` / `small` / `medium` | the sibling `responsive` key's `BreakpointName` ramp |
| `responsiveStyles: { lg / xl / 2xl }` | `large` | same, folded onto the unconditional base |
| `columns: { large / medium / small / xsmall }` | `lg` / `md` / `sm` / `xs` | the sibling `responsiveStyles` buckets |
| `columns: { xxl }` | `2xl` | the near-miss this file's own test has pinned as invalid since before #4001 |
| `responsive: { hidden }` / `{ hideOn }` | `hiddenOn` | objectui's resolved `useResponsiveConfig` result |

Two are prescriptions rather than renames, because a rename would be wrong. A
bare breakpoint name at the `responsive` level (`responsive: { sm: … }`) is the
legacy breakpoint-keyed shape from the `view.responsive` retired in 17 (#3896) —
three keys are plausible targets, so each name gets its own text naming all
three. And a `responsiveStyles` bucket written on `responsive` (or vice versa) is
a wrong-layer pointer to the sibling key, not a rename.

`StyleMapSchema` stays **deliberately open** — its key space is every CSS
property, not a contract we own — pinned in the schema JSDoc, in a test, and in
the #4001 ledger.

**Nothing in `ui/touch|animation|dnd|keyboard|offline.zod.ts` changed**, and that
is deliberate. The ledger scheduled their 22 sites as `authorable (p)`; resolving
the `(p)` found no authoring door at all — nothing declares a carrier key for
them, a BFS from all 24 metadata-type roots plus `defineStack` never reaches
them (with three positive controls passing in the same run), and no `.parse()` on
any of them exists in this repo, objectui, or the example apps. `.strict()` is a
property of a parse; there is no parse. Retiring them or giving them a carrier is
ADR-0049 enforce-or-remove, tracked in #4988 — not a breaking change to spend
here.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
