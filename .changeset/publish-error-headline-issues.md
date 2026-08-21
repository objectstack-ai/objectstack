---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

Publish refusals no longer render each validation finding twice (#10524) — declare-then-trim.

**Declared (spec, additive):** `PublishPackageDraftsResponseSchema.failed[]` elements now
declare `issues[]` (the `RuntimeAuthoringIssueSchema` findings the producer has emitted
since #8333 but no declared parse could carry), and `seedApplied` declares `issues[]`
(`{ path, message, code? }`, the seed-body schema refusal's findings). Typed consumers —
the SDK's `PublishPackageDraftsResponse`, any `parse` through the schema — can now read
the structured findings back instead of having them silently stripped.

**Trimmed (producers):** the #4463 author-time gate's 422 message and
`seedRequestValidationError`'s message are one-sentence headlines — total count plus up to
three `path [rule]` / `path [zod-code]` locators — instead of restating the issue prose
that `issues[]` carries on the same response. Consumers that render only `error` (CLI,
logs) keep what failed, where, under which rule, and how many; consumers that render both
channels stop repeating themselves. The old `(+N more)` tail is subsumed by the leading
count. Both catches that surface the seed refusal onto `seedApplied` now thread the
structured findings beside the headline.

Error `code`/`status` vocabularies, `advisories`, the DESTRUCTIVE_CHANGE (409) message,
and `saveMetaItem`'s spec-validation 422 message are unchanged. Messages are not contract
(the machine-readable channels are `code` and `issues[]`), so this is not a breaking
change and registers no migration.
