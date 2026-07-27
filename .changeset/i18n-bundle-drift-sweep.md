---
"@objectstack/platform-objects": patch
---

fix(i18n): clear the accumulated drift in the generated translation bundles

The committed bundles had fallen behind the spec on three independent axes.
`os i18n extract` (merge mode — every existing translation is preserved)
reconciles all of them:

**Keys the spec no longer has**, still carrying translations in
`*.metadata-forms.generated.ts`. All three were removed deliberately and are
now *rejected* by the schema, so their entries were dead weight:

- `capabilities.trash` / `capabilities.mru` — `enable.trash`/`enable.mru`
  retired in the 16.x line (#2377), with tombstone guidance in
  `UNKNOWN_KEY_GUIDANCE`.
- agent `visibility` — removed 2026-07 (#1901).

**Keys the spec gained** but the bundles never learned: the
`summaryOperations.*` sub-fields (`object` / `function` / `field` /
`relationshipField` / `filter`), and `sys_invitation.business_unit_id` /
`positions` from the ADR-0105 D8 placement work.

**Objects stuck on empty strings.** `sys_migration`'s labels and help text were
committed as `""` in the ja-JP and es-ES bundles, which renders as *blank* in
those locales rather than falling back to anything readable. They now carry the
schema text like every other untranslated key.

No API or schema change — this only affects what the UI displays.
