---
"@objectstack/plugin-approvals": patch
---

Correct what `sys_approval_request.payload_json` is documented to be FOR — it is audit evidence served redacted per reader, not a notification source

The object's module docstring — which ships to consumers in the package's type
declarations — justified the snapshot column with: *"used by notifications so
they can render before the record is locked or changed."* That consumer does
not exist. Measured against every `this.notify(...)` call site in
`approval-service.ts`, all **12** of them, each passes a payload of
`{ title, message, actionUrl }` (two also carry `actions`), built from
`object_name` / `record_id` and the caller's own comment. **None** reads
`payload_json` or the parsed `payload`.

This is more than tidiness: that sentence was the only documented
justification for the column holding a *full* row, and it was cited as such
during the #10749 consumer inventory before anyone checked it. The docstring
now states the real reason — the snapshot is retained as **audit evidence of
what was actually submitted**, so the column stays whole at rest, and is served
**redacted per reader** by the subject object's field-level read controls via
`getReadableFields`, on the approvals-inbox door and the generic data door
alike (#11039).

The field's own `description` is deliberately unchanged: `Record snapshot at
submission time` is accurate, and it — unlike the JSDoc — is the string
extracted into the four generated i18n bundles, so no translation leaf moves
and no locale is left holding an English seed.

Also carried in the same pass, the residual documentation the #10749 closure
assigned to the next docs touch in this lane: `payload-redaction.ts` recorded
`hidden`-vs-serialization as an **open** `packages/spec` question, and it has
since been ruled (maintainer, 2026-08-24, applying the 2026-08-12 lineage).
That paragraph now states the ruling — **`hidden: true` stays UI-only;
`internal: true` is the serialization primitive** — so an author who needs a
field kept out of read results is pointed at `internal: true` (#7728,
ADR-0049) rather than at `hidden`, which never governed serialization.

Documentation only: no runtime behaviour, no schema field, and no public type
signature changes.
