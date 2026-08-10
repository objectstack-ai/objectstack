---
'@objectstack/cli': patch
'@objectstack/lint': patch
---

i18n section headings: read only the declared `label` spelling, never `title`

`record:details` sections and form-view sections declare exactly one heading key —
`label` (`RecordDetailsProps.sections[]` and `FormSectionSchema`; #5611 settled this
by declaring `label` and deliberately NOT declaring `title`). Two consumers still
read `label ?? title`:

- `os i18n extract` / `os lint`'s coverage walk (`i18n-extract.ts`) scaffolded
  `objects.<object>._sections.<name>.label` from a `title`;
- the `translation-section-name-missing` lint rule accepted a `title` as the
  heading it reports on.

Both now read `label` only. Per Prime Directive #12 the tolerance was the bug: a
consumer that reads an undeclared spelling turns it into a second de-facto contract,
and here it did so on the loudest possible surface — the extractor would seed a
translation bundle key from a spelling the schema rejects, teaching the wrong key to
every translator downstream.

FROM → TO: a section authored as `{ name: 'timeline', title: 'Timeline' }` becomes
`{ name: 'timeline', label: 'Timeline' }`. No migration is expected in practice —
every `record:details` section in this repo and in `packages/platform-objects`
already authors `label` (~12 sections, zero `title`).

Behaviour change if you do author `title`: the heading is treated as absent. The
extractor still emits the section's expected key (it is derived from `name`) but
seeds it with the section name instead of your `title` text, and the lint rule no
longer reports that section. Rename the key to `label` — which is also what the
schema itself will tell you, since `title` is not a declared key there.
