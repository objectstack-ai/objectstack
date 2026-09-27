---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): `os migrate meta --stored` lists every stored page filter the record-filter conversion leaves as stored, as a TODO naming the page, the block and why — the ADR-0087 D3 TODO channel (#17321, ruling B item 2)

**Clause-②: yes** — `@objectstack/spec` gains public exports (`CONVERSION_TODO_CODE`,
`ConversionTodoDetail`, `ConversionTodoNotice`, and the optional `ApplyConversionsOptions.onTodo`
and `ConversionContext.reportTodo`), and `@objectstack/metadata-protocol` gains
`StoredMigrationTodo` and `StoredMigrationRow.todos`. No door's accept set moves, and nothing
that was left as stored before starts converting: every stored body is rewritten exactly as it
was.

**What was silent.** The D2 conversion `page-component-filter-record-to-rule-array` leaves a
stored filter as stored wherever no lossless rule-array spelling exists — above all a record
carrying `$and` / `$or` / `$not`, which is never flattened. It emitted nothing for such a site,
and `os migrate meta --stored` reads conversion notices as its change signal, so a page whose
only legacy filter carried a combinator was reported as **already on protocol**.

**What it says now.** Each such site is a structured TODO (code `OS_METADATA_CONVERSION_TODO`)
carrying its path, the shape left in place, and a reason that names the block (its type, and its
`id` when it has one) and what blocks the rewrite — the combinator by name, the operator
(`$null`, `$exists`, an AST `like`), the null or array value, the rule the door would refuse, or
the inline rows the block renders. The stored pass lists them under their row, whatever the
row's outcome:

```text
⚠ 1 row(s) are outside this pass — each row's reason says why:
  • page/pipeline_board [env-wide] — the conversion chain rewrites nothing here: it left 1 site(s) of this row as stored, …
      TODO page-component-filter-record-to-rule-array: {"$or":[…]} left as stored at pages[0].regions[0].components[0].properties.filter — On the `object-kanban` block, this filter carries the combinator `$or`: …
☐ TODO: 1 site(s) in 1 row(s) are left as stored — no conversion can rewrite them without changing what they mean, so no run of this pass will. …
```

The same list is `rows[].todos` in `--json` and in the `POST /api/v1/meta/_migrate-stored`
report. A run with no TODO prints exactly what it printed before.

**Outcome and exit code.** A row whose only finding is TODOs has nothing to persist and is now
reported `skipped` (it was `canonical`). Like every other skip class it does not change the
run's exit code: no run of this pass can clear it, because the conversion must not flatten a
combinator — it is the hand rewrite's to decide. A row that also converts something keeps the
outcome its conversion gives it, with its TODOs listed beside its notices. Measured through the
write path: on `--apply`, a row whose leftover sits in a block's `properties.filter` or
`properties.defaultFilters` is rewritten (its lossless filters persist; the metadata API's save
does not refuse block props by component type), while a leftover in `dataSource.filter` fails
the save, and the row's TODO says why.

**For code calling the conversion layer.** `onTodo` and `reportTodo` are optional. Only the
stored-metadata pass passes a sink today; every other seam leaves the site as stored silently,
exactly as before.
