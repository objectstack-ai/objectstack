---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/service-i18n": minor
---

fix(i18n)!: the `translation` metadata type speaks the same `objects.` shape everything else does (#3778)

A translation authored in the product saved successfully and then rendered
nothing. Not a resolver gap — a contract split. The `translation` metadata type
(`allowRuntimeCreate: true`, so Studio/the metadata API/an agent can author it)
was registered against `AppTranslationBundleSchema`, an object-first shape keyed
on `o.<object>`. Every resolver, `os i18n extract`, `os i18n check`, the objectui
hooks, and all nine shipped bundles read `objects.<object>`. Nothing bridged the
two, so the save path and the read path never met.

**Why converge instead of bridge.** A converter was the obvious fix and the
wrong one: it would be throwaway code, and it would start producing *working*
`o.`-shaped rows — closing the migration-free window that exists precisely
because the feature never functioned. The retired shape's real-world footprint
was zero: all three `*.translation.ts` files in the tree (platform-objects,
CRM and todo examples) were already `objects.`-shaped, contradicting the type's
own registered schema. Converging is a registration fix, not a migration.

**Breaking.** `AppTranslationBundleSchema`, `ObjectTranslationNodeSchema`, and
their types are **deleted** — no deprecation cycle. Nothing worked end-to-end
through them, so there is no functioning consumer to protect, and a
deprecated-but-present schema is exactly the exemplar an AI agent copies into
new code. The optional `II18nService.getAppBundle` / `loadAppBundle` methods go
with them: zero implementers, so they advertised a capability the runtime never
delivered.

**The replacement.** `TranslationItemSchema` — one locale of the same
`TranslationData` groups a file bundle uses, plus the `locale` it translates,
with a `defineTranslation()` factory. An item is one entry of a
`TranslationBundle`; that is the whole type.

Three details are deliberate, all aimed at the failure being silent rather than
loud:

- **`locale` is required**, not inferred from the item name. The sync skips an
  item whose locale it cannot resolve, and a skip is invisible to whoever — or
  whatever — authored it. (The name fallback still covers rows written before
  this.)
- **Retired keys are rejected, not stripped.** Zod drops undeclared keys
  silently, which would reproduce this bug exactly: save succeeds, nothing
  renders. A pre-parse guard turns that silence into a 422 naming the group to
  use (`'o' … — use 'objects.<object_name>'`). It runs ahead of the parse so the
  retired keys stay out of the schema itself — the generated JSON Schema and the
  Studio editor never advertise a shape that cannot work.
- **`ObjectTranslationData.label` is now optional.** Partial translation is the
  normal state and every resolver already treats each key as independent.
  Requiring it forced authors to restate the source label just to validate,
  filling bundles with fake translations that mask real coverage gaps.

Also in this change: the authored-translation sync warns (naming the row and the
fix) when it meets a row still in the retired shape instead of loading it into
nowhere, and no longer merges publish bookkeeping (`_lockReason`,
`_packageVersion`, …) into the translation layer. `GET
/i18n/labels/:object/:locale`'s fallback now reads the nested
`objects.<obj>.fields.<field>.label` data it is actually given — it scanned for
flat dotted `o.<obj>.fields.<field>` keys, a third dialect no producer ever
wrote, so it always returned `{}`.

Migration: author every translation — file or runtime item — under `objects.`.
`o` → `objects`, `app` → `apps`, `nav` → `apps.<app>.navigation.<id>.label`,
`dashboard` → `dashboards`, `_globalOptions` →
`objects.<obj>.fields.<field>.options`, `_meta.locale` → top-level `locale`,
`_actions.confirmMessage` → `_actions.confirmText`. `reports`, `notifications`,
`errors`, and `namespace` had no runtime consumer and have no replacement.
