---
'@objectstack/spec': minor
---

The import row report and the validate-only answer can now say which fields a write drops. `ImportRowResultSchema` and each `ValidateDataResponseSchema.results[]` row gain an optional `droppedFields`: an array of `DroppedFieldsEventSchema`, the engine's own strip event. So the reason vocabulary is the engine's (`readonly`, `readonly_when`, `primary_key`, `computed`), and there is no second enum. The row still succeeds: `ok`, `action` and `valid` are unchanged. A server that does not produce the report omits the key, so an absent key alone does not prove nothing was dropped.

`ImportRowResultSchema` also declares `warnings`, which the REST import dry run already serves: the findings the validate verdict admits, in the `ValidateDataIssue` shape, on an ok dry-run row. Until now `ImportRowResultSchema.parse` stripped the key, and readers typed by the spec could not see it.

`ImportJobResultsSchema.results` now says what an async reader gets: a capped sample, failures first. An ok row's `droppedFields` or `warnings` reaches that reader only if the row falls inside the sample. The cap is unchanged.

A consumer that branches on `reason` must stay exhaustive over `DroppedFieldsEvent['reason']`. The known exhaustive consumer is objectui's write-warning toast table, `STRIPPED_LINE` in `packages/app-shell/src/providers/writeWarningToast.ts`, which covers all four reasons today. A reader that renders the import or preview report should word `reason` through that table rather than a second one. When the union widens again, the table keyed by it fails type-check on the missing reason, while a second table would fall behind without a sound.
