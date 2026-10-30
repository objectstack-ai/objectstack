---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): promoting a permission set with no draft answers `NO_DRAFT` before another owner's name collision

Clause-②: no
Metadata-protocol: none

The draft promotion (`POST /api/v1/meta/permission/:name/publish`, and `publishPackageDrafts`, which promotes through the same step) asked the permission-set name judge (`NAMESPACE_CONFLICT` / 422) even when no draft existed at the address, so a publish with nothing to publish, of a name another package holds, answered the collision instead of `NO_DRAFT` / 404. The name judge now runs only when a draft was read, like the promotion's other draft judges, so the caller is told about its own state first. Refusal for refusal: with no draft the promotion was refused before and is refused now, and with a draft the same refusals run in the same order.
