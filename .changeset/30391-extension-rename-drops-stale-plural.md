---
'@objectstack/objectql': minor
'@objectstack/rest': minor
---

fix(objectql,rest)!: an object extension that renames `label` and sets no `pluralLabel` is served without the base's plural, so list titles stop showing the old name (#30391)

Clause-②: no (narrowing) — `/meta/object` (item and list reads, both transports) and every registry read of an object (`SchemaRegistry.getObject`, the fold) stop serving `pluralLabel` for an object an extension renames without a plural of its own, where they served the base's plural (and, in a translated locale, the base's translation of it). The shipped showcase's `showcase_account` is one: its extension renames it `Account (Success Overlay)` and declares no plural. Nothing an author writes is refused.
Metadata-protocol: semantic
Skills-docs: follow-up — `skills/objectstack-data/SKILL.md` "Object Extension Model" says an extension "can add but never remove"; a renaming `label` now takes the base's `pluralLabel` off. The sentence wants that exception (outside this change's surface).

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: an object extension declares `label` and `pluralLabel` exactly as before. What moves is the plural an object is served with when an extension renames it without one, and nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** served-value narrowing for an object an extension renames.

- **Before.** An `objectExtensions` entry or a `.custom` `object_extension` item that set `label` and no `pluralLabel` was folded with the new label and the base's `pluralLabel`. A translated read served the base package's translation of that plural (`objects.NAME.pluralLabel`), so a list title, read plural first, kept the old name in every locale.
- **Now.** `pluralLabel` is the plural of `label`: such an extension is served as an object that declares no `pluralLabel`, in every locale, so a list titles it by its label. Where the owning package's `.custom` pair saves its own translation of `objects.NAME.pluralLabel`, that translation is served (ruling record 6631250894: a translation in the pair, then the override's own text, then the base's translation).
- **Unchanged.** An extension that sets `pluralLabel` is served with it. One that sets no `label`, or repeats the label it extends, keeps the base's plural and its translation. A plural the tenant set stays, and a tenant's own rename yields as before (ADR-0029 D9.2a). An object no extension renames is served as before. The packaged base the translators compare against keeps its plural.

Nothing has to be rewritten: an extension that wants a plural for its new name declares `pluralLabel` beside `label`, as it always could, and a `.custom` pair can save `objects.NAME.pluralLabel` in its own `translation` item for a translated locale.
