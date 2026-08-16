---
"@objectstack/spec": minor
---

feat(spec): `placeholder` becomes a declared `FieldSchema` key — the producer moves to meet four shipped objectui render surfaces (#9019, maintainer Option C ruling on objectui#4676)

<!-- adr-0087: not-required (no-migration-prescription) Accept-set EXPANSION on
an existing authorable surface: one optional string key added to FieldSchema,
plus the removal of the FIELD_KEY_GUIDANCE retirement entry that used to refuse
it by name. Nothing authorable is renamed, retired or tombstoned — metadata
that parsed yesterday parses identically today, and metadata that was 422'd
yesterday (a field carrying `placeholder`) now parses and round-trips. -->

`FieldSchema` refused `placeholder` by name ("never a FieldSchema key. Author
hint text through `inlineHelpText` or `description`.") while four objectui
packages plus `apps/console` — plugin-form's auto-generated and sectioned
forms, plugin-detail's inline edit, app-shell's field-backed action params
(whose module header documents the inheritance as intended), and console's
FormPage — apply an object-field-level `placeholder` at render time, feeding
the `@object-ui/fields` widgets. That was the preview-renders/save-422s trap:
the designer preview rendered the key, `PUT /api/v1/meta/object/:name`
refused it.

Per the 2026-08-16 maintainer ruling (Option C on objectui#4676, measured in
its report comment 5301288148):

- `placeholder` is now a declared optional string key on `FieldSchema`, with
  the semantics the renderers already implement: in-input placeholder text
  (the HTML `placeholder` attribute), distinct from `inlineHelpText`
  (always-visible help beside/under the input) and `description` (tooltip).
- The `FIELD_KEY_GUIDANCE` retirement entry steering authors away from the key
  is removed — after this change that prose would contradict the contract.
- The Studio metadata forms (`object.form.ts` quick-add grid, `field.form.ts`
  full editor) offer the key, and the liveness ledger carries a `live` verdict
  with the measured cross-repo evidence.

The matching translation surface (`FieldTranslation.placeholder`) was already
declared, so a translated placeholder now has a declared base key to land on.
