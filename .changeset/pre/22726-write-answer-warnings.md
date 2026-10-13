---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/client': minor
---

A write answer now carries the advisory validation-rule hits of that write as `warnings`

Clause-②: yes (widening)

A `severity: 'warning'` or `'info'` validation rule never blocks a write. Until now its hit was only logged on the server, so no client could show the person who saved what the rule says. A create, an update or a clone now answers the hits of that one write, and the validate-only preview reports the same entries.

- **Write answers.** `CreateDataResponseSchema`, `UpdateDataResponseSchema` and `CloneDataResponseSchema` declare an optional `warnings`: one entry per advisory rule hit, carrying the rule's `name` as `rule`, its `severity`, the `field` it is about, the finding `code` and the author-written `message`. The key is absent when there is no hit, so an existing client's reading of the answer does not move. REST relays it in the response body unchanged. The write's status and record are unchanged, and an `error` rule still refuses the write.
- **One element, shared with the preview.** `ValidateDataIssueSchema` gains optional `rule` and `severity`, set only on an advisory rule hit. It is the element of the new `warnings`. `validateData` appends the advisory hits of the same evaluation to each accepted row's existing `results[].warnings`, after the value-shape findings the deployment admits. An import's dry run copies that array to the row verbatim, as before.
- **Engine.** `WriteObservabilityOptions` gains `onValidationAdvisory`, an in-process listener beside `onFieldsDropped`, with its event schema `ValidationAdvisoryEventSchema`. The engine calls it once per advisory hit on the write it was passed to: per row on `insert`, and on `update` by id and per matched row of a `multi` update. A nested write a hook or a flow makes inside that write carries its own options, so its hits never reach the outer write's listener or answer. `evaluateValidationRules` returns its advisory hits (an empty array when there are none) instead of `void`.
- **Unchanged.** Rule semantics, the per-write `warn` log line and the seed and boot load's one summary line per rule are all as before. No authorable key is added: `ValidationRuleSchema` is untouched. A rule whose condition could not be evaluated is not a hit. Its fault text is for the operator, so it stays in the server log only.
- **Client.** `CreateDataResult`, `UpdateDataResult` and `CloneDataResult` declare `warnings?: ValidateDataIssue[]`.

**For authors.** Nothing to change in metadata. Write each advisory rule's `message` for the person saving the record, because a client can now show it to them.
