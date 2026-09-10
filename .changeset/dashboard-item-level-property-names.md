---
"@objectstack/spec": minor
"@objectstack/rest": patch
"@objectstack/platform-objects": patch
---

feat(spec): a metadata-form repeater's row properties have a name — `DashboardHeaderAction` fields carry a JSON Schema `title`, and `resolveMetadataFormSchemaTitles` overlays a bundle's `metadataForms.<type>.fields.<path>.label` onto a derived JSON Schema (#16458)

## What was wrong

The Studio property panel renders `dashboard.header.actions[]` as a table whose
column headers read `items.properties[k].title ?? k` from the JSON Schema
derived by `z.toJSONSchema(DashboardSchema)`. None of the four item fields
(`label`, `actionUrl`, `actionType`, `icon`) carried a `title`, so the fallback
arm ran for every locale, English included, and the maker saw machine keys.
Nothing could localise them either: the only channel, `resolveMetadataFormLabels`,
decorates the `FormFieldSpec` tree, which the table never reads. And the platform
catalogs carried `dashboard.fields.header` alone — `dashboard.form.ts` declared
no children under the composite, so `os i18n extract` emitted no
`header.showTitle` / `header.showDescription` / `header.actions` key and the
console shipped a private overlay for exactly those three.

## What changed

- **`@objectstack/spec`** — `DashboardHeaderActionSchema`'s four fields author
  `.meta({ title })` (`Label`, `Action URL`, `Action Type`, `Icon`), so the
  derived JSON Schema names each column. New export
  `resolveMetadataFormSchemaTitles(schema, type, bundle, opts)` in
  `@objectstack/spec/system`: every `metadataForms.<type>.fields.<path>.label`
  at any locale of the chain becomes the `title` of the node the path addresses,
  stepping through an array's `items` so a repeater ROW property is addressed
  as `<repeater>.<property>` (`header.actions.label`) — the same path the
  extractor emits. Pure; returns the input object itself when nothing applies.
  `dashboardForm` enumerates the `header` composite's children
  (`showTitle`, `showDescription`, `actions` with its four row properties) with
  labels equal to the schema titles, pinned equal in `dashboard.test.ts`.
  The mechanism is written down in `content/docs/protocol/kernel/i18n-standard.mdx`
  → "Metadata authoring forms".
- **`@objectstack/rest`** — `GET /api/v1/meta` localises each entry's derived
  `schema` beside its `form`, through that overlay.
- **`@objectstack/platform-objects`** — the four generated `metadata-forms`
  catalogs carry the seven new `dashboard.fields` keys, translated in `zh-CN`,
  `ja-JP` and `es-ES`.

Additive: no key removed, no accept set changed, no parsed output moved.

`DashboardSchema.columns` deliberately still declares no `.default(12)`, and
the reason is stronger than the one #16458 assumed. The card reasoned that the
renderer already falls back to 12, which would make `.default(12)`
behaviour-preserving. Measured at objectui `origin/main`
(`packages/plugin-dashboard/src/DashboardRenderer.tsx`), it does not: a
`columns`-less dashboard is INFERRED from the widget spans — `maxSpan > 4`
yields 12 and everything else yields **4** — and the next line switches the
whole layout on that value (`hasExplicitColumns = schema.columns != null ||
inferredColumns !== 4`, positioned grid vs responsive auto-flow). Declaring the
default would therefore both retire the inference and flip every auto-flow
dashboard into the positioned grid. A default that silently materialises a key
is expensive to take back, so the round stopped at the declared condition and
left the key alone; see #16458.
