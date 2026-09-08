---
'@objectstack/platform-objects': patch
---

Metadata forms i18n: the `object.fields.reference` help text now carries the
`tree` rule in Spanish, Japanese and Chinese, and no longer claims the field is
for `lookup` / `master_detail`.

The English source for this row gained a normative sentence on 2026-09-05 — a
`tree` field's `reference` is optional and, when present, must name the
declaring object; a link to a different object is a `lookup`. That rule is
enforced at parse time, so an author who writes a foreign target meets it as a
refusal rather than as guidance.

The three translated locales still served the pre-2026-09-05 sentence. They
were wrong in both directions at once: they dropped the `tree` rule entirely,
and they asserted a purpose the source no longer states — "(para
lookup/master_detail)" / "(lookup/master_detail 用)" / "(用于 lookup /
master_detail)" — which the `tree` case contradicts. A Spanish, Japanese or
Chinese console therefore told the author that `reference` was for the two
relationship types that exclude `tree`, and gave no hint of the constraint they
were about to hit.

Only the three `helpText` values move. The `label` siblings, the key set and
the generated structure are unchanged.
