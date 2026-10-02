---
"@objectstack/spec": minor
---

fix(spec)!: `FieldSchema` refuses a `select` / `radio` field with neither `options` nor `picklist` (#20827)

Clause-②: yes

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over two existing keys: `options` and `picklist` are not removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. Which choices a `select` / `radio` with no option source was meant to offer is authoring intent that no conversion entry can invent. Stored rows follow the ruling's arm for rows that exist (production `sys_metadata` is not measurable from this repository, so the disposition assumes some do): new writes are refused at the parse site with the remedy, and a stored row keeps its bytes, is still served with `_diagnostics.valid: false`, is listed by `/meta/diagnostics`, and is counted invalid and named by the `field/choice-without-options` boot line until an option or a picklist is added (pinned in `@objectstack/metadata-protocol`). The in-tree authored population is zero (examples and platform objects); the fixture census is on the PR. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers the choice-source rule and this diff adds none (not registered / already-registered); and the change narrows a metadata schema's accept set, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing on `FieldSchema`, shipped as `minor` under the
repo's launch-window convention for breaking changes — the grade the `reference`
precedent shipped with (a `lookup` / `master_detail` without `reference`, refused
at parse as a `minor` with the **BREAKING** header).

**What was accepted before.** A `select` or `radio` field with no `options` key,
with `options: []`, and with no `picklist` parsed cleanly. It is a choice with
nothing to choose: the form control offers nothing, and server-side value
validation is off (the record validator checks membership only against a
non-empty allowed list), so any value writes through the API. The author-time
completeness gate (ADR-0078, `field/choice-without-options`, used by `os build`,
`os validate` and `os lint`) already graded it an error, and registration warns on
it; a runtime-API or Studio save was the one door that let it through.

**What is refused now.** At parse, on the `options` path, with a `custom` issue
that names the field type and both remedies: a `select` / `radio` whose `options`
is absent or empty and whose `picklist` is absent. The predicate is the
completeness gate's own, so the two cannot disagree.

**The fix.** Declare `options: [{ label, value }]` with at least one entry, or
`picklist: 'industry'` (the name of any shared list) to offer a shared list —
never both (that pair stays refused as before). If any value is meant to be allowed, use a `text` field instead.

**Unchanged.** `multiselect` and `tags` keep parsing without options (free-form
by design), and `checkboxes` keeps parsing with a completeness warning. A
`select` / `radio` with at least one option, or with a `picklist`, parses as
before. The ADR-0078 author-time rule and the registration warning are
unchanged — this door is one more gate, not a replacement. `Field.select()`
called with an empty list emits `options: []`, which is now refused at parse.

**Stored rows.** No conversion can supply the missing options, so a row saved
before this release is not rewritten. It is still served — with
`_diagnostics.valid: false` naming `fields.FIELD.options` — and still
registered at boot (counted invalid); a later save of its object is refused
until an option or a `picklist` is added. To find such rows, read
`GET /api/v1/meta/diagnostics`, or the boot log's `field/choice-without-options`
lines. The `os migrate meta --stored` preview does not validate bodies, so it
does not find them: it counts such a row canonical, or — when the row also
carries an older spelling to lower — pending, and the apply then reports that
row failed and leaves its bytes as they were.
