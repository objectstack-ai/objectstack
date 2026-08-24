---
'@objectstack/cli': minor
---

`os lint` and `os i18n extract` gain the flow/screen bucket — a screen-flow
copy gap is reportable, and the `flows..screens..` skeleton is scaffoldable,
for the first time

#11287 gave the bundle a `flows` group and a resolver that applies it. Nothing
on the CLI side walked it: `COVERAGE_SOURCE` had no flow bucket, so the
`i18n/missing-*` family could not report a screen-flow copy gap **at all**, and
`os i18n extract` never wrote the keys, so an author had no way to discover the
vocabulary. Measured on #11287: HotCRM reported **0 `i18n/missing-*` issues** on
a tree whose six screen dialogs rendered English in all four locales. An app
whose i18n gate is green is green because the surface is invisible to it.

The shared walker (`collectExpectedEntries` — one definition of what is
translatable, feeding both the gate and the extractor) now harvests, per flow:

```
flows.<flow>.label
flows.<flow>.screens.<node_id>.title
flows.<flow>.screens.<node_id>.fields.<field>.label
flows.<flow>.screens.<node_id>.fields.<field>.placeholder
```

Screens are keyed by `FlowNode.id` and fields by `ScreenFieldConfig.name` — the
identifiers the runner already holds at render time, not a second naming
scheme. Missing keys report as `i18n/missing-flow`, per locale, with the same
opt-in rule as every other bucket: a project that declares no locales and ships
no bundle still reports nothing.

The copy keys are **imported** from `@objectstack/spec/system`
(`FLOW_SCREEN_COPY_KEYS` / `FLOW_SCREEN_FIELD_COPY_KEYS`), never restated. They
are exported precisely so the extractor and the resolver cannot drift; the
schema-to-list agreement is pinned spec-side in `translation.test.ts`, and the
list-to-walker agreement is pinned here.

Two seeding rules follow what the reader actually sees rather than which key
the author filled in. A screen's `title` falls back to the node `label`,
because the executor builds the wire title as `config.title ?? node.label` and
one bundle key covers whichever the runner draws. A field's `label` falls back
to its `name` as a *derived* seed: the skeleton stays usable while the gate
demands no translation for a string nobody authored.
