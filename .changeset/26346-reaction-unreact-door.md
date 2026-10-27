---
'@object-ui/app-shell': patch
'@object-ui/core': patch
---

fix(app-shell): a member takes back their own comment reaction through the unreact door, with no object delete grant

A member whose grants are the every-member ones could add a reaction on the record feed and never take it back. The reaction chip removed through the generic data door's `DELETE /api/v1/data/sys_comment_reaction/:id`, which needs an object-level `delete` grant that no every-member set may carry (ADR-0090 D5), and the `feedReactionRemove` row of the affordance-to-grant map read that grant, so the chip offered no take-back at all.

Clause-②: no
Metadata-protocol: none

- The record page now removes the caller's own reaction row through the unreact door, `DELETE /api/v1/comments/reactions/:id`, which `@objectstack/plugin-audit` mounts. The door removes only the caller's own row; a refused take-back puts the reaction back on screen and says it was not saved, as before.
- `feedReactionRemove` in `@object-ui/core`'s `AFFORDANCE_GRANTS` now reads `{ crud: null, grant: 'create' }`: its write no longer goes through the data door, so no CRUD bit is read, and it asks the grant the reaction was added under. Whose reaction a chip shows still decides which chips offer the take-back: a click on another member's reaction adds the caller's own.
- A member who holds the `delete` grant sees the same behaviour: the take-back goes through the same door.
