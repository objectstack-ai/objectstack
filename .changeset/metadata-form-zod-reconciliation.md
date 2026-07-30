---
"@objectstack/spec": minor
"@objectstack/rest": patch
"@objectstack/platform-objects": patch
---

fix(spec,rest): the metadata forms save what they show — form ↔ Zod reconciliation (#3786)

Every entry in `METADATA_FORM_REGISTRY` is a hand-written `defineForm` layout
that names keys of a Zod schema it never imports: two descriptions of one key
set, a comment asking the next author to keep them in step, and nothing that
fails when they don't. #3786 asked for a sweep of that shape across the repo.
**Four of the seventeen forms had already drifted, every one of them silently.**

The silence is the point. `ObjectSchema` / `FieldSchema` are deliberately not
`.strict()`, so a key the schema does not declare parses clean and is stripped
on the way to storage — the same ADR-0104 failure class the `field.zod.ts`
prune tombstone already describes in prose. An admin toggled a switch in
Studio, got no error, and the value never landed.

**What was broken, from an author's seat:**

- **Object → Capabilities.** The block bound to `capabilities`; the
  `ObjectSchema` key is `enable`. All seven toggles (Track history, Searchable,
  API enabled, Files, Feeds, Activities, Clone) saved nothing.
- **Object → Fields.** The inline column grid offered 16 keys `FieldSchema` has
  never declared. `PII`, `Encrypted`, `Indexed`, `Immutable`, `Filterable`,
  `Placeholder`, `Validation`/`Error message` and `Starting number` were
  controls with no storage behind them at all; the rest named keys the schema
  had **renamed** and the form never followed:
  `referenceFilter` → `lookupFilters`, `cascadeDelete` → `deleteBehavior`
  (a three-way enum, not a boolean), `formula` → `expression`,
  `displayFormat` → `autonumberFormat`, and the flat `summaryType` /
  `summaryField` pair → the single `summaryOperations` object, which also
  restores the `object` key the flat pair had no slot for. Roll-ups authored in
  that grid saved nothing.
- **Report → Advanced.** `aria` and `performance` were pruned from
  `ReportSchema` by #3496; the form kept rendering both.
- **Hook / Action → Body.** `memoryMb` was unauthorable — named in
  `hook.form.ts`'s own doc comment, absent from the list beneath it.
- **Page → Interface.** `interfaceConfig.sort` was unauthorable, so a page's
  default sort order could not be set in Studio at all.

**No authored metadata changes and nothing you can write is removed.** These
were UI controls that never persisted; every corrected key is one `FieldSchema`
/ `ObjectSchema` already accepted. Metadata authored in YAML/TS was always
validated against the real schema and is unaffected. If you had been filling
those Studio controls expecting them to stick, they now either work (the
renamed five) or are gone rather than lying to you.

The metadata-form translation bundles are derived from the registry, so all
four locales are regenerated. Worth naming what they contained: translated
labels, in four languages, for switches that saved nothing — the drift had
propagated into a generated artifact and been dutifully translated there.

**The mechanism.** `metadata-form-zod-reconciliation.test.ts` walks every
registered form and reconciles it against `getMetadataTypeSchema()`. The two
directions are deliberately asymmetric: **form-only** (a control whose value is
discarded) is always a defect and cannot be excused, because no design wants
one; **zod-only** is ledgerable with a reason, for a deprecated key held back
from new authoring or a curated quick-add subset that defers to a fuller
editor. Ledger entries are checked for non-vacuity and for still resolving on
both sides, per the #4045 / #4040 discipline. Verified by mutation — re-adding
a stripped key, dropping a covered key, and offering a ledgered omission each
turn the gate red.

**New export: `TRANSLATABLE_METADATA_TYPES`** (`@objectstack/spec/system`), the
set of metadata types whose labels `translateMetadataDocument` localizes,
derived from its dispatch table rather than restated. `@objectstack/rest` had
been carrying a hand-copied literal set under a "keep in sync with the type
dispatch" comment; it now reads this instead. Registering a translator in spec
reaches the REST boundary with nothing else to remember — the second list is
deleted rather than checked, which is the better half of derive-or-gate.

Also corrected: `ActionAiCategorySchema`'s comment claimed it mirrored
`ToolCategorySchema` in `ai/tool.zod` and told the next author to update both
sides — but #3896 deleted `ToolCategorySchema` along with the inert
`tool.category` key it typed. The instruction had been pointing at a source
that no longer exists. The enum is canonical now and says so.
