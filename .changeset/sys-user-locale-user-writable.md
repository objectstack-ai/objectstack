---
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": minor
"@objectstack/service-messaging": patch
---

feat(platform-objects,plugin-auth): a user may set their own `sys_user.locale` (#14787)

Maintainer ruling 2026-09-03, option B, quoted verbatim and untranslated as
adopted:

> 「同意」

The identity table's user-writable set grows from two fields to three. This is a
security-boundary act, taken by the maintainer and recorded as one — it is the
first widening of the ADR-0092 D2 self-service whitelist since that ADR shipped
`{name, image}` as its first and only entry. `sys_user.locale` landed
`readonly` and off the whitelist three weeks earlier (#13881 / #14775), which
recorded a decision nobody had made yet; the ruling made it.

Three edits move together, and each one is inert without the other two:

- `SYS_USER_PROFILE_EDIT_FIELDS` becomes `{name, image, locale}`, so the
  identity write guard admits the column instead of stripping it (and, on a
  locale-only PATCH, throwing). `SYS_USER_IMPORT_UPDATE_FIELDS` inherits the
  widening by construction — it is a spread of the profile set, not a second
  list.
- `MANAGED_EXTENSION_EDITABLE_FIELDS` gains a `sys_user` entry holding
  `locale` and nothing else.
- `sys_user.locale` drops `readonly`. Without this the engine's readonly strip
  removes a caller-supplied value before the guard or the validator ever sees
  it, so the whitelist entry alone would have been a silent no-op.

**A malformed value is refused, not stored.** The column now declares a
`locale_bcp47_shape` `format` validation rule carrying the same BCP-47 pattern
the delivery-time reader uses, so objectql's rule validator rejects a malformed
tag on insert, by-id update and bulk update with the standard
`VALIDATION_FAILED` / `invalid_format` envelope (HTTP 400). The check is of
SHAPE, not of membership: an unknown-but-well-formed tag is accepted and falls
to the delivery ladder's floor rather than dead-lettering a notification, which
is the property #13881's per-recipient chain was built to hold. An absent, null
or empty column stays legal — clearing it is how a user returns to the
deployment default, which remains the fallback.

**What did NOT widen.** The ADR-0092 D6 session-snapshot mirror keeps
`{name, image}`: better-auth has no `locale` on its user model and it is
deliberately not an `additionalFields` entry, so there is no cached copy to keep
coherent, and merging one in would manufacture a `user.locale` key present only
on sessions that happen to be cached and only after a profile edit. The mirror
set is now named separately from the update whitelist rather than derived from
it.

**Who may perform the write is unchanged, and is a separate question.** ADR-0092
D5 leaves that with the permission layer: `member_default` still denies
`allowEdit` on `sys_user`, so a rank-and-file member reaches this column through
no shipped surface yet — the widening opens the COLUMN, not a self-service
route. Granting one (the `sys_api_key` shape: an explicit `member_default` entry
plus a `_self` row-scope for writes) is a further security-boundary decision
that this ruling did not take.

The `identity-write-guard` and `managed-extension-fields` pins that recorded the
old posture are FLIPPED, not deleted, each naming the ruling that reversed it —
a pin that recorded a real decision is evidence, and evidence of a superseded
decision is what tells the next reader the reversal was deliberate.

`@objectstack/service-messaging` is a docs-and-export change only: its
`LOCALE_TAG_SHAPE` is unchanged in behaviour and now exported so a parity pin
can hold it byte-identical to the write-side pattern. Read-side normalization
stays — it is strictly the stricter of the two (`"null"` is shape-legal and only
the read side refuses it) and it guards values that arrive below the data API,
where no write rule runs.
