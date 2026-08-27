---
"@objectstack/spec": minor
---

feat(spec): Operation Message Catalog gains two refusal-situation keys —
`record_write_denied` and `approval_recall_not_submitter` (#12493, the
spec-side half of the shape-A ruling on #11993)

`BUILTIN_OPERATION_MESSAGES` gains two situation keys in all four platform
locales (`en`, `zh-CN`, `ja-JP`, `es-ES`), rendering through
`renderOperationMessage` with the same override/locale/fallback behaviour as
the `record_access_denied` family, addressed for deployment overrides as
`errors.record_write_denied` and `errors.approval_recall_not_submitter`:

- `record_write_denied` — the user can see this record, but changing or
  deleting it is beyond their access (the sharing middleware's by-id write
  denial; one key for both write verbs). Deliberately NOT
  `record_access_denied` restated: that sentence would be false on a row the
  read path already admitted.
- `approval_recall_not_submitter` — the user asked to recall an approval
  request someone else submitted; the copy names who CAN act (the submitter,
  or an administrator — the #3424 admin override).

Both sentences take no placeholders, re-derived per site as the family
requires: the only nameable facts at the measured throw sites are object API
names and opaque ids, which must not reach a toast.

**Operator-visible consequence, stated plainly:** this release ships the
catalog keys only — two refusal situations gain localized copy and a
deployment-override address. The emitters still throw their raw English
strings (`FORBIDDEN: insufficient privileges to …` in the sharing
middleware, `FORBIDDEN: only the submitter may recall this request` in
plugin-approvals) until their consumer halves land separately (#12260 and
#11993). Nothing changes on the wire in this release; once the consumer
halves land, end users see these refusals in their own locale, and any
deployment `translation` defining the two `errors.*` keys takes effect then.
