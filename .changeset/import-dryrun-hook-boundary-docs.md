---
"@objectstack/spec": patch
---

docs(spec): `ImportRequest.dryRun` states the boundary an import preview has — no automations run (#6537)

An import dry run routes through the engine's own write-path validation
(`DataProtocol.validateData`, #6037 / #4633 ruling D) and applies no
`runAutomations` gate, because gating it would leave the common dry run with no
validation at all — the false all-clear that work set out to close. The engine's
validate-only path deliberately runs **no hooks**: a preview that fired
user-authored side effects (mail, outbound calls, writes to other objects) would
be the retired `BatchOptions.validateOnly` defect (#4052) in a new spelling.

The consequence an author can meet is narrow and, until now, written down only in
the engine's and the import runner's source comments: on an object whose
`beforeInsert` hook derives a **required business field**, a dry run with
`runAutomations: true` can report `required` for a row the real import would have
created. Audit and ownership stamps (`created_by`, `owner_id`,
`organization_id`, …) are `system`/`readonly` and skipped by validation anyway, so
they cannot produce this.

`ImportRequest.dryRun`'s description now says so, which puts it on the reference
page an author reads before sending the request — the same schema backs
`CreateImportJobRequest`, so the synchronous route and the async import job both
carry it. **Zero behaviour change**: one description string, and the
`content/docs/references/api/export.mdx` cells regenerated from it by
`gen:schema && gen:docs` (no hand edits).
