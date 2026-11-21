---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a record sharing `allow` no longer takes the ownership floor out of an OR an authored write policy stands in, so a creator can still edit or delete their own row by id beside an authored widener

Clause-②: yes (widening)
Metadata-protocol: none

On a by-id update or delete, when the sharing service answered `allow` for the row, the platform's own ownership floor (`created_by == current_user.id`, from `member_default` and `external_default`) was removed from the row-level filter. The sharing service answers `allow` when the caller owns the row or holds write depth over its owner, holds Modify All, or, for an update, holds an `edit` share on it or belongs to the queue it sits in. That filter is an OR of permissive policies. Where an app-authored update or delete policy applied to the caller as well, for example "any open deal" (`stage == 'open'`), removing the floor left that policy as the only term. A row the floor alone admitted, such as the caller's own closed deal, was then refused with 403 `PERMISSION_DENIED`. A predicate write (`multi: true` update, delete by `where`) over the same row wrote it.

The maintainer ruled option A on #35917 (ruling comment 7063130499, 2026-11-21): under a sharing `allow`, the creator and owner floor stays an OR term beside an authored update or delete `using` policy, so a by-id write gives the answer a predicate write already gave for those rows.

The floor is now dropped only where it is the filter's last term. Beside an authored write policy with a `using` it stays one term of the OR, both in the row gate before the write and in the defaulted check on the new image. What changes:

- On an object where an authored update or delete policy applies to the caller, a by-id update or delete of a row the caller created, where record sharing answers `allow`, is admitted again, as it was before the sharing service could replace the floor. That covers a creator who owns the row, who holds write depth over its owner, who holds Modify All, and, for an update, who holds an `edit` share or queue membership. A creator with none of these is still refused by record sharing. The lifecycle verbs move with their write class: `transfer` and `restore` with update, `purge` with delete.
- By id and by predicate now agree on the rows the floor admits. They do not agree on every row: an open row the caller neither owns nor holds a share on, which an authored policy admits, is written by id (the authored policy lifts the sharing refusal) and left out of a predicate write (the sharing bulk scope stays owner and shares). That divergence is older than this change and is not touched here.
- `security/explain` reports the same record verdict for these rows.
- The master check a `controlled_by_parent` detail write asks about its master row moves the same way: a master's creator, where record sharing allows the master, can now insert, update and delete its details beside the master's authored update policy.
- An authored write policy that cannot enforce (a missing column, an unresolved membership key) used to deny every such by-id write under `allow`. The creator's own rows now pass by the floor, as they already did under `abstain` and by predicate.
- A write on another user's behalf (ADR-0090 D10) follows the delegator: a by-id update or delete, by the delegator or on its behalf, of a row the delegator created beside its authored policy is now admitted. Before, both were refused. The suite pinned those refusals in 22 tests. Those tests now use rows the delegator did not create, so they still refuse with every assertion kept, and new tests pin the admission of a row, and of a master, the delegator created: `delegated-write-never-exceeds-delegator.test.ts` (the five held-row cells and the post-image store test, under both tenancy postures, 12 tests) and `explain-enforce-parity.test.ts` (the five #24746 held rows, under both postures, 10 tests). An agent still never writes a row its delegator's own write refuses; on a `controlled_by_parent` object that rests on the delegator's own composition, which new cells pin at the row gate, the stored row and the master gate.

Removed capability: a `using` write policy no longer stops a row's own creator once record sharing says `allow`, and a master's authored update policy no longer stops the master's creator from writing its details. Where to put such a limit now:

- A `check` on the update policy judges the stored image of every row, so it can refuse what a row becomes. It does not see the row as it stood before the write, so it cannot hold a row in a state: a creator can still edit a closed deal into one the check accepts.
- A `beforeUpdate` lifecycle hook sees the row as it stood before the write (`ctx.previous`), so a limit on the prior state goes there, and a delete has no new image, so a limit on deleting one's own rows goes in a `beforeDelete` hook.
- For a master's details, the master gate reads the master's row filter, not its `check`, and a hook on the master does not run for a detail write: the limit goes in a hook on the detail object.

What does not change:

- Where no authored write policy with a `using` applies, an `allow` still replaces the floor completely, as before.
- An authored policy still bounds every row the floor does not admit. Modify All does not lift an authored write policy on an ordinary business object (ADR-0066 ①), and an owner or `edit`-share target who did not create the row is still held to the authored policy.
- A `check` an author wrote still refuses the new image, the tenant wall still applies, and an `edit` share still widens update and never delete.
- Where record sharing abstains (no owner field), the floor still applies.
- Reads are not affected: the floor is a write-side policy.
- `ISecurityService.checkAuthoredRowWrite` still judges the authored policies alone, without the floor.
