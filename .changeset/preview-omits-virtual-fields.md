---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `os migrate plan` no longer promises columns the apply can never create (#3978)

`previewDeferredSchemaWork()` listed every declared field name when computing
pending `create_table` / `add_columns` work, but `createColumn` returns early
for a virtual `formula` field — no column is ever created for it.

So a formula field showed up as pending `add_columns` that `apply` reported as
performed without doing anything, and the very next `plan` reported it again.
A freshly-applied database looked permanently un-migrated, with no invocation
able to clear the finding. On `examples/app-crm` that was 4 columns
(`crm_contact.full_name`, `crm_lead.is_closed`, `crm_opportunity.expected_revenue`,
`crm_opportunity.days_to_close`) reported forever.

The preview now filters through `fieldHasColumn` — the same helper `createColumn`
and the column differ already answer "does this field materialize a column?"
with — so the plan and the flush cannot disagree. `multiple` fields are
unaffected: they materialize as a JSON column and are still reported.
