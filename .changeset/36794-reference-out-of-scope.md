---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
---

feat(spec,core): an import lookup cell that names a record under another parent answers its own reason, `reference_out_of_scope`, with the scoping columns as data

Clause-②: yes (widening)
Metadata-protocol: none (a wire error code, no author-writable key)

`FieldErrorCode` (ADR-0114) gains `reference_out_of_scope`. The importer answers it for a SCOPED lookup cell (a `dependsOn` column, or the master the same row sets) whose value matches no record within the row's scope while it does match a record outside it: the row names a record that lives under another parent. Until now that cell answered `reference_not_found`, the same reason as a value no record has, and only the message told the two apart (`Contract: no record matches "CTR-0006" (Account = "Acme")`); a client that keys its text on the reason, such as the Import Wizard's dry run, could only say "no matching record". The message is unchanged in English and has its own catalog key, `import_reference_out_of_scope`, in all four platform locales (a deployment overrides it under `validation.field.import_reference_out_of_scope`).

The cell error, the element of an import row's `errors` (`ValidateDataIssueSchema`), now carries `scope` on that reason only: the row columns the lookup was resolved within, each `{ field, value }` with the cell as the importer typed it, so a client names the scoping column and its cell without parsing `message`.

Unchanged: a value that matches no record at all, scoped or not, still answers `reference_not_found` with the plain sentence and no `scope`. The out-of-scope probe is still the importing caller's own read, so a record that caller cannot read is never named and its cell answers `reference_not_found`.

What to do: a client that switches on `reference_not_found` to tell a user "no such record" keeps receiving it for a value no record has. A client that wants every unresolved lookup cell matches `reference_not_found` and `reference_out_of_scope` both.
