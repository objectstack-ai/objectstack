---
'@objectstack/plugin-audit': patch
'@objectstack/core': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/react': patch
'@object-ui/core': patch
---

feat(comments): a member resolves and reopens any thread they can read, and deletes their own comments

Clause-②: yes (widening) — `@objectstack/plugin-audit`'s `AuditPlugin` mounts two new HTTP routes, `PUT /api/v1/comments/:id/resolution` and `DELETE /api/v1/comments/:id`, and the stamp of who resolved a thread now reads a system write's `provenance.attributedUserId`. `@objectstack/core`'s `OwnRowDeleteDoor` adds an optional member, `refuseRemoval(row, engine, context)`, asked after the owner check. `@object-ui/react`'s `DiscussionContextValue` adds the optional `ownCommentDeletesOnly`; `@object-ui/plugin-detail`'s `RecordCommentsData` adds the optional `ownDeletesOnly`, and `RecordCommentThreadProps['comments']` may carry it; `@object-ui/core`'s affordance-to-grant map adds the row `feedCommentDeleteOwn`. Nothing existing is removed or re-typed.
Metadata-protocol: none

Two server doors carry the maintainer's comment permission rulings past the platform's row floor (`owner_only_writes`, which lets a rank-and-file member update only the rows they created) and past the delete grant no every-member set may hold (ADR-0090 D5). Neither changes the floor, `sys_comment_moderation` or any permission set, and the data API answers exactly what it answered before.

- **Resolve and reopen: `PUT /api/v1/comments/:id/resolution`** with the body `{ "resolved": true }` or `{ "resolved": false }` and nothing else. Whoever can read the thread may (ruling record 7063285032, option A), external members who can read it included: the door reads the comment as the caller (a comment they cannot read answers `404 RECORD_NOT_FOUND`, as an unknown id does), refuses a reply (`400 VALIDATION_ERROR`) and then writes `is_resolved` alone, attributed to the caller. `resolved_by` names the caller. It answers `200` with `{ id, is_resolved, resolved_by, resolved_at }`. Any other query parameter or body is `400 VALIDATION_ERROR`; a signed-out request is `401`.
- **Delete your own comment: `DELETE /api/v1/comments/:id`.** It removes a comment the caller wrote (`author_id`), with no delete grant needed, on the platform's shared own-row delete door. Another member's comment is `403 PERMISSION_DENIED` and stays, even for a record editor: moderating someone else's comment stays the data API's, behind the delete grant. A comment others replied to stays too, `409 DELETE_RESTRICTED`, because removing it would turn each reply into a thread of its own (ruling record 7069889899: no one deletes or rewrites someone else's comment); its author may still edit its text. It answers `200` with `{ id, deleted: true }`.
- **Unchanged:** comment text stays its author's alone; a member's data-API update of a colleague's comment, `is_resolved` included, and a member's data-API delete are still `403`; administrators keep the data API for resolving, editing and deleting anyone's comment.

The desktop comment panel follows the doors:

- ✓ is on every thread, the viewer's and anyone else's, and writes through the resolution door. It no longer asks the explain engine; that probe now gates only Edit on someone else's comment.
- A viewer without the `sys_comment` delete grant (an ordinary member) is offered Delete on their own comments that have no reply, and it goes through the own-comment delete door; a viewer with the grant deletes through the data API as before, others' comments included where they may edit the record.

Corrections to two earlier notes of this release, which stay as written:

- A rank-and-file member now resolves and reopens a colleague's thread through the resolution door; this replaces the #36071 note's line "This is the one widening: an update that changes nothing but `is_resolved` is admitted without the author-or-record-editor rule", because the platform's row floor (`owner_only_writes`) runs first, so through the data API such a member still resolves only the threads they started and an administrator resolves any.
- The desktop comment panel offers ✓ on every thread and writes it through the resolution door; this replaces the #36075 note's line "✓ is offered under the `sys_comment` update grant: on a thread the viewer started, and on anyone's only where the explain engine admits …", and its "Unchanged" line's "a deployment without the explain service shows ✓ and Edit on the viewer's own rows only" now holds for Edit alone.
