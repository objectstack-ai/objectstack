---
"@objectstack/service-analytics": minor
---

**The published `DimensionLabelDeps` type (re-exported from this package's `index.ts`) gains
one new optional key, `translateSelectOptions`** — the surface the level is graded against,
per the same "a new key on a published exported type is the mechanical floor for clause ②"
rule #16778 shipped under. Backward compatible (optional, additive, no removed/renamed key,
no wire-shape change), so `minor` rather than `major`.

A dataset's `select`-field dimension now renders its option label in the request's locale on
a dataset-backed chart, matching what `GET /meta/object/:name` (and hence the console's list
grid) already renders for the identical field.

`dimension-labels.ts` resolved a select dimension's category label straight out of field
metadata's authored `options[].label` — always the author's own-language text, since
`SelectOptionSchema.label` is a plain string, never an inline locale map. The dotted
cross-object arm (`field: 'contract.direction'`) was unaffected: a relationship-path field
name never matches a key in the BASE object's own field map, so `resolveDimensionLabels`
skips it via `if (!meta) continue` before either branch runs — this fix changes nothing on
that path, and a regression test now pins that it is never even consulted.

`DimensionLabelDeps` gains one new optional capability, `translateSelectOptions`, which the
plugin bridge (`plugin.ts`) implements by calling `translateObject` (`@objectstack/spec/system`)
— the SAME translator the object-metadata REST endpoint already uses — against the
deployment's i18n bundle, when an `i18n` service is registered. No new export, no new spec
key, no wire-shape change: `AnalyticsResult` carries the same `rows`/`fields` shape as before,
and a kernel with no i18n service configured (or nothing for the requested locale) falls back
to exactly today's authored-label text.

A future widening of `LOOKUP_TYPES` (#16390) does **not** automatically inherit this: lookup /
master_detail labels resolve through the separate `fetchRecordLabels` capability (a related
RECORD's display name, not a field's authored `options[]`), which this change does not touch.
It does lower the cost of adding translated lookup-record labels later, though — the i18n
service bridge (`plugin.ts`'s `i18nService()` / `buildTranslationBundle()`) is now already
wired into this package and is a `ctx.getService('i18n')` away from reuse.
