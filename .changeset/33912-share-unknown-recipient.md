---
'@objectstack/plugin-sharing': minor
---

fix(plugin-sharing)!: a manual share, or a sharing rule, to a user id that names no user is refused instead of stored as a grant that grants nothing

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered share-user-recipient-unresolved-refused -->

**What was wrong.** `POST /api/v1/data/OBJECT/ID/shares` with `{"recipientType":"user","recipientId":"nobody_xyz"}` answered 201 and stored a `sys_record_share` row, listed by `GET …/shares` like any other grant. The read and write gates look a share up by `recipient_id` equal to the signed-in user's id, so a row naming an id no user carries grants no one anything: a share that looks granted and enforces nothing. `grant()` checked only that `recipientId` was present. `POST /api/v1/sharing/rules` (`defineRule`) stored a rule with the same kind of `user` recipient.

**Now.** On the non-system path, `SharingService.grant` asks whether the recipient names a user the gates could ever match before it writes:

- on a deployment walled by organization (tenancy posture `isolated` or `group`) with the record's organization known: a member of that organization (`organizationMemberStanding`, the engine's one membership predicate);
- on `single`, and behind a wall on a deployment that registers no membership table: an existing `sys_user`;
- on a walled deployment where the grant's organization does not resolve (the record's organization could not be read, or the record carries none and the session has no active one): nothing is judged, because the engine already refuses that insert for every recipient alike (`ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`, 500) and writes nothing; judging the recipient there would answer an unknown id differently from a real one.

A recipient that does not resolve is refused `VALIDATION_FAILED` (400 at the REST door) with `recipientId "ID" does not name a user this record can be shared with, so no access check would ever match the share. Name an existing user (on a multi-organization deployment, a member of the record's organization).` and nothing is written. On a walled deployment, a user of another organization gets the same answer as an id that does not exist, so the door tells no caller who exists in another tenant. The check runs after the caller's authorization, so a caller who may not manage shares on the record learns nothing about the user directory.

`SharingRuleService.defineRule` applies the same check, in the rule's organization, to a non-system `user` recipient when the rule is new or its recipient changes (the refusal says `…a user this rule can share with, so the rule would grant no one access…`). The rule's organization is the caller's or, for a platform operator with no active organization, the stored rule's own when the call updates one: that update is not refused by the engine's insert-only organization rule, so a move onto a user outside the stored rule's organization is refused here with the same answer. A new rule written with no organization on a walled deployment is not judged: the engine refuses that insert for every recipient alike. Saving a stored rule again with its recipient unchanged is not judged, so a rule whose user has since left can still be switched off.

**BREAKING** for a caller that shares a record, or saves a sharing rule, naming a user id that does not exist or, on a walled deployment with the record's or rule's organization known, a user outside that organization: it answered 201 and stored a row that granted nothing; it answers 400 `VALIDATION_FAILED` and stores nothing.
The fix for a caller: send the id of an existing user, on a multi-organization deployment a member of the record's (or rule's) organization.

Unchanged: the system context (the rule materialiser's own grants), shares and rules already stored (nothing is rewritten or removed), a deployment that registers no `sys_user` (nothing to resolve against: the check stands aside), and a `sys_sharing_rule` row written through the `/data` door, which this change does not judge.
