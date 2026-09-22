---
"@objectstack/platform-objects": patch
---

The standalone `field` metadata-form panel no longer prints English column heads and tooltips to a Chinese, Japanese or Spanish author: nine keys — eighteen string leaves — were decided leaf by leaf and rendered in `zh-CN`, `ja-JP` and `es-ES` (#19403).

`Placeholder`, `Value Domain`, `Rows`, `Related List Filter` and the five row properties of `summaryOperations` (`Object`, `Function`, `Field`, `Relationship Field`, `Filter`) read their English source in all three locales, `helpText` included. An en-echo is not automatically a defect, so each leaf carries a recorded reason in `field-panel-echo-decisions.test.ts` rather than a bulk rewrite — and fourteen of the eighteen had an **authored twin at the same key path**: `object.fields.fields.*` is the same field editor embedded in the object panel, rendered there and echoing here, with seven of the twins byte-identical in `en`.

- **Machine tokens stay English, checked at the schema before a word was rendered.** `valueDomain.helpText` names `iana_time_zone`, `iso_4217_currency` and `iso_3166_alpha2` — the three members of `ValueDomainSchema`, a `z.enum`. Rendering them as words would tell an author in their own language to write a token the schema refuses. Kept, as are `count` (a `summaryOperations.function` enum member), the spec key `inlineHelpText`, the operator `AND` and the worked example `status == received`.
- **Values only.** No key was added or removed: the three translated bundles are 18 insertions / 18 deletions each, the full flattened key sets are identical on all four bundles (893 keys, 0 added, 0 removed), and `en` is untouched. Regenerated with `pnpm i18n:extract`, which dropped the 18 provenance rows per locale that recorded these leaves as unauthored extractor fills.
- **The panel is now pinned by a derived population**, so a key added to `fieldForm` tomorrow is judged on the day it lands rather than a round later.

Measured on the metadata-form catalogs: label keys echoing in all three locales fall **38 → 29** while the genuinely-translated control rises **500 → 509** (`zh-CN`) and **484 → 493** (`ja-JP`, `es-ES`), same population, same run.
