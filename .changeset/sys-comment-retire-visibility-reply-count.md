---
"@objectstack/plugin-audit": minor
---

feat(plugin-audit)!: retire `sys_comment.visibility` and `sys_comment.reply_count` (#4756, ADR-0049)

Both fields were modelled with **zero** runtime consumers — nothing in this repo,
in `objectui`, or in `cloud` ever read or maintained either one. ADR-0049
enforce-or-remove; maintainer decision: remove both. Same disposition, and for
the same stated reason, as `sys_attachment.share_type` / `sys_attachment.visibility`
in #2755 ("attachment access is derived from the parent record").

**REMOVED — `sys_comment.visibility`** (`'public' | 'internal' | 'private'`,
defaulted `'public'`).

This one is a **security-looking key with no gate behind it**, which is the
primary reason it goes rather than stays. No code path consulted it: not
`enforceFeedsCapability`, not the record-level gates added in #4630, not the
REST layer, not objectui's discussion panel. A comment an author marked
`private` was visible to exactly the same people as a `public` one — an app
author (or an AI authoring metadata) reading the field list would reasonably
believe otherwise, and get a silent security failure instead of an error. That
is the Prime Directive #10 trap in its textbook shape.

There is **no replacement key**: after #4630, who can see a comment is decided
by the record-level permissions of the record its `thread_id` names — one
coherent rule. A per-row enum layered on top would be a second source of truth
for the same question. The enum's only genuinely missing meaning ("hidden from
external/portal principals") depends on external principals existing at all,
which waits on ADR-0090 D11's `externalSharingModel`; today there is nobody to
hide a comment from. This does not foreclose that design — when portals land,
a visibility key can return **enforce-first**, with a real gate and tests.

**FROM → TO:** stop sending `visibility` on `sys_comment` writes; to restrict
who sees a discussion, restrict who can read the record `thread_id` points at.

**REMOVED — `sys_comment.reply_count`** (`number`, `defaultValue: 0`,
`readonly: true`).

Never incremented anywhere, and `readonly` meant an author could not set it by
hand either, so every row read `0` forever — a UI binding an "N replies" badge
to it rendered `0` for every thread. Deliberately **not** replaced by an
`afterInsert`/`afterDelete` roll-up: the predicate/bulk write-hook gaps tracked
by #4770 / #4778 / #4779 (a hook that returns early without a single-record id
lets the whole bulk operation through) are exactly where a hook-maintained
counter drifts — a bulk delete of replies would never decrement it. A counter
that drifts is worse than no counter, because both the UI and an AI reading the
record trust it. If a badge needs the number, aggregate `parent_id` children at
read time; a designed roll-up can be revisited once #4775's family has settled
bulk-hook semantics.

**FROM → TO:** replace reads of `reply_count` with a count of `sys_comment` rows
whose `parent_id` is the comment's id.

**Stored data.** Existing databases keep both columns as **unmanaged leftovers**
— no migration, matching #2755. What changes where:

- **Reads are loud everywhere.** The read-axis gates (#4134 / #4226) resolve
  field names from the object schema, not from the table, so a filter, sort,
  `select` or `expand` naming `visibility` / `reply_count` now answers
  `400 INVALID_FIELD` on every deployment, leftover column or not. A "0 replies"
  badge that silently lied becomes an error that names itself.
- **Writes are loud on new databases only.** A database provisioned after this
  change has no such column, so the write fails at the driver and is mapped to
  the same `400 INVALID_FIELD` envelope. On a pre-existing database the leftover
  column still accepts a value nothing will ever read — record validation does
  not reject undeclared keys. Dropping the two columns is an optional manual
  cleanup, not a requirement.
