---
"@objectstack/platform-objects": patch
---

fix(platform-objects): nine es-ES and ja-JP metadata-form leaves say what their source says

Nine leaves of `metadataForms` served a superseded English source revision in both es-ES
and ja-JP. Each was a faithful translation of the sentence the source carried when it was
extracted; the English moved afterwards and bundle merge fills gaps only, so a
present-but-stale leaf is never refreshed by re-extraction.

The nine, by the test the census applies — does the string assert something the source
does not, or drop a distinct concept the source names:

- `object.fields.fields.trackHistory.helpText` said "keep change history" in both. The
  source says `Summarize this field on the record activity timeline` — a different
  feature, not a loose translation.
- `object.fields.isSystem.helpText` dropped `defaults sharing to public`.
- `view.fields.filter.helpText` dropped the whole clause after the dash — the shared
  visual builder and its field-type-aware operators and value inputs.
- `action.fields.body.helpText` said "JavaScript code to run", losing the L1-expression /
  L2-sandboxed-body distinction. It now reads as the sibling leaf
  `hook.fields.body.helpText` already renders that same source sentence in both locales.
- `action.sections.advanced.description` asserted bulk operations, which the source does
  not name.
- `page.fields.type.helpText` asserted the page-kind enum the source stopped listing and
  dropped the "List / Interface binds a source view into a curated surface" sentence.
- `report.sections.basics.description` said "data source" where the source says report
  type.
- `report.fields.columns.helpText` said "columns to show in the report", losing both
  `Dimension names across` and `matrix only`.
- `email_template.fields.variables.helpText` described a list of variable names; the
  source is a JSON shape example, which is language-neutral and is now carried verbatim.

Values only — the key set is unchanged at 773 leaves, identical across all four bundles.
The recorded-source-hash table is untouched and needs no entry: it records a digest only
while a leaf is still a byte copy of its source, so all nine, being real translations,
carry no entry and are LEGACY-TRUSTED by construction.
