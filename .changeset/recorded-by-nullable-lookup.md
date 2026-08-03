---
"@objectstack/metadata-core": major
"@objectstack/metadata-protocol": major
"@objectstack/cli": minor
---

fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

`recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
foreign key. The write path filled it with `actor ?? 'system'`, so every
metadata write without a caller actor (boot sync, migration, an internal call)
stored the **string** `'system'` in a column whose declared type says "the id
of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
(`'usr_system'`) is not auto-provisioned on the current runtime either, so the
value resolved to nothing under any reading. Any consumer that read the field
by its declaration — `expand`, an owner column in a report, an audit timeline
showing "who changed this" — got an id that could not be dereferenced.

It had already cost twice. #4441 had to exempt every `readonly` field from the
write-path referential-integrity check, because otherwise ordinary metadata
authoring (package create / publish / clone) was rejected. #4551's
dangling-reference audit had to skip the same set for the same reason. The
field ended up the platform's only reference column that is neither enforced
nor audited.

**The fix is on the write path, not the declaration.** `recorded_by` stays a
`lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
"system-initiated (boot sync, migration, scheduled job)" — the standard
expression of "no link", and already what this column's `set_null` delete
behaviour means. No magic system-user account (a row that can never sign in yet
holds an identity is a new security surface), and no `actor_kind` companion
column.

**Breaking — the repository contract is now explicitly nullable.**

| Surface | Before | After |
|:--|:--|:--|
| `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
| `MetadataEvent.actor` | `string` | `string \| null` |
| `MetadataItem.authoredBy` | `string` | `string \| null` |

`actor` stays required rather than becoming optional on purpose: every call
site must state which of the two it is, so a forgotten actor cannot silently
become a fake foreign key. Migrating a caller:

- **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
  or a label to satisfy the type: pass `null` instead.
- **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
  the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
  that the *stored* value no longer lies, not that no label may ever be shown).

Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
indistinguishable from a real user id to anything that resolves the field. They
now surface `null`.

**Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
rewritten to `NULL` by a new command, which runs the conversion through the
ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
It is a dry run by default and safe to re-run — it selects only rows still
holding the sentinel, so a second `--apply` converts nothing.

The rewrite is **semantically equivalent, not a reinterpretation**: this column
has only ever held that one sentinel, written by exactly one expression
(`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
expressible in the declared type.

Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
declaration already says "user id, system id, or `'system'`", so its `'system'`
default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
skip also stay — see the PR for why they are still correct.
