---
"@objectstack/lint": patch
---

fix(lint): `relationship/delete-behavior` suggestion no longer names `set_null` as declarable on a `master_detail`

`lintDataModel`'s `relationship/delete-behavior` suggestion told an author an
undeclared `master_detail.deleteBehavior` could be `cascade`, `restrict`, or
`set_null`. Since #9689 (PR #11406, maintainer ruling 2026-08-19), an authored
`deleteBehavior: 'set_null'` on a `master_detail` field is a named parse-time
rejection — a detail row cannot outlive its master, so the engine resolves
every value except `restrict` to `cascade` on this type. Following the
suggestion's own `set_null` mention literally walked an author into that
rejection at publish time.

The message now enumerates only the two values `FieldSchema` actually accepts
on a `master_detail` (`cascade`/`restrict` — matching the vocabulary already
offered by the metadata-admin field form, `object.form.ts`'s `master_detail`
`deleteBehavior` options), and keeps the same outcome-naming courtesy as the
parse-time rejection message: it still names `set_null` to say plainly that it
is not honored on this type, and points to `lookup` for the case where
children must survive the parent. The `fix` payload (`deleteBehavior:
'cascade'`) was already correct and is unchanged.
