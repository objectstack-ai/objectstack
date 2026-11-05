---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(objectql,rest)!: a new assignment to a banned user is refused, and a banned user's records can be counted and handed over in bulk (#30205)

Clause-②: yes (narrowing) — the published `FieldErrorCode` enum gains the member `reference_user_banned`. A non-system create or update that sets a user field (the owner field, a `user` field, or a `lookup` to `sys_user`) to a user whose ban is in force is refused `400 VALIDATION_FAILED` with that field code, a write that answered `201` / `200` before. A value the row already stores is not judged, so a record that already holds the banned user stays editable. The two new routes and SDK methods are additions.
Metadata-protocol: none
Skills-docs: no move in `skills/**`, which teaches no user-assignment verdict; `content/docs/permissions/administrator-guide.mdx` gains "Handing over a banned user's work" and its offboarding quick path points at it.

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped. What moves is the answer a data write gets when it names a banned user, and a record that already holds one is not judged, so nothing at rest needs rewriting. The new field code is a member of the response vocabulary FieldErrorCode, not of anything an author writes. -->

**BREAKING** accept-set narrowing at every data write door (`POST` / `PATCH /api/v1/data/OBJECT`, batch, import, and a flow's elevated record write, which keeps the reference check): banning a user signs them out, but the records they own and are assigned stay where they were, and new work could still be handed to them.

- **Before.** The Console's person picker hid a banned user, but `POST /api/v1/data/OBJECT` with `assignee` set to that user answered `201`, so new work landed on someone who cannot sign in.
- **Now.** The write-time reference check also asks whether a referenced user's ban is in force (`banned` is true and `ban_expires` is empty or still ahead) and refuses such a value with `reference_user_banned`, beside `reference_not_found`. It is read the way the existence probe reads, so a caller who cannot read the user object is refused the same way. A ban whose expiry has passed is not in force.
- **Unchanged.** A value every row of the write already stores (an edit form carries the whole record back), a system write the reference check already exempts (seed, install, restore), and a missing user (still `reference_not_found`).
- **New: the count.** `GET /api/v1/security/users/ID/assigned-work` (`client.security.assignedWork.count`) answers, per object and user field, how many records hold the user, counted under the caller's own context. Platform tables (`sys_*`), `managedBy` objects and `readonly` / `system` fields such as `created_by` are not counted; objects the caller cannot read are listed in `unreadable`; at most 200 fields are counted (`truncated`).
- **New: the hand-over.** `POST /api/v1/security/users/ID/assigned-work/transfer` (`client.security.assignedWork.transfer`) with `{ toUserId, objects? }` moves up to 500 records per call to an active user, each as an ordinary update under the caller's context, and answers per field what moved and what failed, plus how many remain. A banned, unknown or identical `toUserId` is refused before any write. Multi-valued user fields are counted but not transferred. Neither route touches the ban.
- **`@objectstack/spec`.** `FieldErrorCode` gains `reference_user_banned`, with its message in `en`, `zh-CN`, `ja-JP` and `es-ES`.

**For a caller.** A write that names a banned user in a user field names an active one instead; the refusal names the field and the user. No stored metadata or row changes, so there is nothing for `objectstack migrate meta` to rewrite. An integration that reassigns work after a ban can call the transfer route and repeat it while `remaining` is above 0.
