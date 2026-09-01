---
"@objectstack/lint": patch
---

fix(lint): give `validate-translation-references` its `_tabs` leg, and pin the object branch against the schema (#13835)

`validate-translation-references` walked the object branch's `fields`,
`fields.*.options`, `_views`, `_sections` and `_actions`, but never `_tabs` —
the string did not appear in the rule at all. The result was an **asymmetry**
rather than a coverage gap: `collectExpectedEntries` already emits
`objects.<object>._tabs.<tab>.label` and `os i18n check` demands a translation
for it, while nothing told an author that a `_tabs` key they wrote named a
filter preset that no longer exists. Rename a preset and the bundle keeps its
old key: the tab bar renders in the source locale above a fully localized grid,
with every gate green. This is the same shape #11608 identified for `flows`, one
group over, and it was missed only because `_tabs` arrived after the object
branch was written.

The object branch now reports `translation-target-unknown` for a `_tabs` key no
page declares, with the usual near-miss suggestion and an enumeration of the
real preset names.

The universe is collected from `page.interfaceConfig.userFilters.tabs[].name`,
de-duplicated per object, mirroring `walkObjectTabs`
(`packages/cli/src/utils/i18n-extract.ts`) rather than re-deriving it. Three
shape facts are asked of the code that owns them:

- **`ViewTabSchema` has two carriers and only one is live.** The page-only
  preset bar (`UserFiltersSchema.tabs`, ADR-0047) is what objectui's
  `TabFilters` draws and what `translateInterfaceTabs` resolves;
  `ListViewSchema.tabs` has no renderer in either repo. Registering the dead
  carrier would make legal a key nothing resolves, so only the live one counts —
  and the hint says so when an object declares no preset bar, since otherwise an
  author reads the finding as a bug in the rule.
- **The object binds through `interfaceConfig.source` first, then the page's own
  `object`** — the order both the resolver and the extractor use.
- **Source-authored pages (`kind: 'html' | 'react' | 'jsx'`) are read here**,
  unlike in the component walk that skips their derived `regions` cache:
  `interfaceConfig` is authored metadata at the page root, and neither consumer
  consults `kind`.

Also lands the hardening the issue proposed: the object branch's coverage is now
**pinned against `ObjectTranslationDataSchema`'s key set**, so the next group
added to the shape cannot land without a leg here. The ledger classifies every
declared key as either reference-checked or leaf copy, holds its key set equal to
the schema's, and requires each `reference-checked` claim to be backed by a
bundle that actually produces a finding — so claiming coverage costs a working
leg rather than a line in a table.

Advisory-only, as the whole rule is: findings are warnings, nothing new is
refused at publish, and no bundle that resolved before reports now.
