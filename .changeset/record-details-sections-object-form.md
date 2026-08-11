---
"@objectstack/spec": minor
---

feat(spec)!: `RecordDetailsProps.sections` declares the object form every page actually authors, and `hideFields` is declared (#5611)

`record:details` declared a `sections` shape that nothing produced and nothing
consumed, and omitted a key a published platform page depends on. Both are now
declared as delivered.

**BREAKING (authored metadata shape) — `sections` is an object array, not an ID list.**

```ts
// FROM — declared, but written by zero pages and read by zero renderers
sections: ['overview', 'financials']

// TO — what every real page already authors
sections: [
  { label: 'Overview', columns: 2, fields: ['name', 'account', 'owner'] },
  { label: 'Financials', columns: 2, fields: ['budget', 'spent'] },
]
```

One-line fix: replace each section ID with `{ fields: [...] }`, naming the
fields that section should render (add `label` for a heading, `columns` for its
grid width, `name` to make the heading translatable).

**Why this is safe despite being a type change — it was measured, not assumed.**
The ID-list form had **zero** read paths and **zero** producers:

- `objectui`'s `RecordDetailsRenderer` maps every `sections` entry as an object
  (`s.name` / `s.label` / `s.title` / `s.fields`) and has no string branch — a
  string entry would spread into a character map and render nothing;
- `@object-ui/types`' `RecordDetailsComponentProps` mirror already declared
  `Array<{ name?, label?, fields, ... }>`, and the Studio block designer can only
  author `{ label, columns, fields }`;
- every page in this repo authors the object form — three showcase pages
  (`project-detail`, `task-detail`, `settings`) and the `sys_user` platform page;
- `packages/lint` has modelled it as `nestedSections` (`sections[].fields[]`) all
  along.

So the "breakage" applies only to hypothetical stored metadata written against a
declaration nothing ever honoured, and schema validation runs on the publish
path — it does not rewrite data at rest.

**New: `hideFields`.** `z.array(z.string()).optional()` — field names omitted
from the body, applied to `fields` and to every section's `fields`. The
`sys_user` platform page has authored it since it shipped and the renderer reads
it; it was undeclared, so it survived only because per-component `properties` is
never parsed. Declaring it now means the parse gate (#5068) preserves it instead
of silently stripping a live page's hidden-field list.

**Section keys**, each declared because it is delivered end to end:
`fields` (required), `label`, `columns` (1-4), and `name` — the i18n anchor that
resolves `objects.<object>._sections.<name>.label`, which `packages/lint`'s
`translation-section-name-missing` rule tells authors to add.

<!-- adr-0087: registered record-details-sections-object-form -->
