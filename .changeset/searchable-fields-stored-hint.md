---
"@objectstack/lint": patch
---

fix(lint): `searchable-field-unknown` / `searchable-field-unsearchable` prescribe a **stored** mirror, not a formula (#6673)

Both authoring-time hints for a bad `searchableFields` entry told the author to
mirror a related record's value onto a formula field — a fix that can never
work:

- FROM (dotted-path entry, e.g. `project_id.name`): "…expand the relation and
  search the related object, or copy the value onto **a formula field** here."
- TO: "…or copy the value onto **a stored text field** here."

- FROM (a `lookup`/`master_detail` column outside the allowed set): "…mirror
  it onto **a text/formula** field here and declare that instead."
- TO: "…mirror it onto **a stored text** field here and declare that instead."

A `formula` field is virtual — no driver materializes a column for it
(`packages/objectql/src/engine.ts`, `driver-sql/src/schema-drift.ts`,
`driver-turso/src/remote-transport.ts`), so a `$contains` predicate against one
has nothing to scan. A CEL formula also only reads the record's own fields
(`record.<field>`), so it cannot fetch the related title in the first place.
Only the **stored** half of the old prescription ever worked; an author who
followed it verbatim got metadata that passed both lint and the `#4254`
runtime gate and then just never matched.

The corpus already prescribes the stored-field mirror everywhere else
(`content/docs/data-modeling/schema-design.mdx`, the `objectstack-data` and
`objectstack-ui` skills, PR #6670 / #6898) — this brings the tool's own hint
text into agreement with it.

Message text only — no schema, rule id, severity, or runtime behaviour change.
