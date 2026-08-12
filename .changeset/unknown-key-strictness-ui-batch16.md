---
'@objectstack/spec': major
---

Close `AriaProps` against unknown keys, and reclassify `widget` + five `i18n` shapes as no-door (#4001 batch 16, ADR-0078)

zod's default is `.strip`: a key a schema does not declare is silently discarded
and the parse still succeeds. On an authoring surface that is the worst failure
mode — the author (increasingly, an AI) gets a success envelope and ships
metadata that quietly ignores what they wrote.

**BREAKING — one shape.** `AriaPropsSchema` (`ui/i18n.zod.ts`) now raises a
named, fixable error instead of dropping the key. It is carried as `aria:` on
roughly thirty live shapes under six metadata-type roots — `ListViewSchema`,
`PageSchema`, `PageComponentSchema`, `DashboardWidgetSchema`, `ChartConfigSchema`,
`ActionSchema`, and twenty SDUI component defs — so this is the highest-fan-out
single site the `ui/` wave has closed.

**What it was doing.** Through the `view` metadata root, this parsed **clean**:

```ts
getMetadataTypeSchema('view').parse({
  listViews: { my_view: { type: 'grid', columns: ['name'],
    aria: { label: 'Accounts', describedBy: 'accounts-help' } } },
})
// → aria: {}
```

Both keys gone, reported valid. The accessible name existed in the source file
and nowhere else — a screen-reader user hears the DOM default, and nothing in the
toolchain ever said so. Those two spellings are not hypothetical: they are what
objectui's `ARIA_KEY_ALIASES` normalizer folds at the `ListView` boundary
(objectui#2890), i.e. what stored view metadata actually carries.

**The renames, each anchored to a named sibling contract.**

| you wrote | write instead | where the wrong word comes from |
|---|---|---|
| `label` | `ariaLabel` | objectui's stored legacy spelling, folded by `normalizeListViewSchema` |
| `describedBy` | `ariaDescribedBy` | same |
| `ariaRole` | `role` | this shape's own inconsistency — two of its three keys carry the `aria` prefix and `role` does not |

`arialabel`, `ariaLabell`, `ariadescribedby`, `aria-label` and `roles` are left to
the edit-distance fallback, measured before anything was hand-written: an alias
for a key the fallback already reaches is transcription, not judgement.

**Two keys get a prescription instead of a rename**, because renaming them would
be wrong (the ledger's finding 7 — this campaign's own fix once signposting the
way into the failure it exists to kill):

- `live` is real and rendered — by objectui's `ListView` alone, which reads
  `schema.aria?.live` and emits `aria-live`. objectui declares it as
  `AriaPropsSchema.extend({ live })`, so **that surface keeps accepting it** (and
  now inherits this error map for everything else). On any other surface the
  message says where `live` IS valid rather than pointing at a declared key that
  means something else. Promoting it into the shared shape would advertise
  `aria-live` on twenty-nine renderers that do not implement it; the promotion
  question is **#5058**.
- `ariaLabelledBy` / `labelledBy` — `aria-labelledby` references another
  element's id, which is not the same thing as `ariaLabel` (a literal string), so
  there is nothing to rename it to. The gap is named, and is also #5058.

**A `.strip()` was added to four files this batch did not otherwise touch.**
`animation.zod.ts`, `dnd.zod.ts` (×2), `keyboard.zod.ts` and `touch.zod.ts` build
their config shapes as `z.object({…}).merge(AriaPropsSchema.partial())`, and
`.merge()` adopts the incoming schema's unknown-key posture — so closing
`AriaProps` would have silently closed all five of those shapes too, with zod's
generic message and against #4988's measured verdict that nothing parses them.
The explicit `.strip()` holds their posture; `i18n.test.ts` pins it.

**Nothing in `ui/widget.zod.ts` changed, and five of `ui/i18n.zod.ts`'s six
shapes were left open** — deliberately, on measurement. The ledger scheduled
`widget` as `authorable (p)` / 9 sites and warned that `i18n`'s label shapes were
"wide-open records by design"; resolving both found something more specific.
`widget.zod.ts` has no authoring door at all: nothing under `packages/spec/src`
imports it except the barrel, a BFS from all 24 metadata-type roots plus
`defineStack` never reaches it, and no `.parse()` on any of its shapes exists in
`objectstack`, `objectui` or `cloud` outside its own tests. The same holds for
`I18nObjectSchema`, `PluralRuleSchema`, `NumberFormatSchema`, `DateFormatSchema`
and `LocaleConfigSchema`. `.strict()` is a property of a parse; there is no parse.
Retiring them or giving them a carrier is ADR-0049 enforce-or-remove, tracked in
**#5055** — not a breaking change to spend here.

The warning about the open record was aimed one level off, and both levels are
now recorded: `I18nObject.params` is a `z.record` interpolation bag whose key
space is whatever the message template names — openness there is the contract, and
it was never a site this ratchet could close. The config block the map assumed was
open alongside it (`AriaProps`) turned out to be the directory's most widely
carried live shape.

Zero-breakage evidence: full `@objectstack/spec` suite, `tsc --noEmit`, all ten
spec `check:*` gates, `objectstack validate` on app-showcase / app-crm / app-todo,
and an ADR-0087 direct-parse probe over the three apps' **built** artifacts —
zero `aria` slots present, with the probe's negative control proven red on a
legacy-spelled block.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
