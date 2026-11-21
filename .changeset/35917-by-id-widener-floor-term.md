---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a record sharing `allow` no longer takes the ownership floor out of an OR an authored write policy stands in, so a creator can still edit or delete their own row by id beside an authored widener

Clause-②: yes (widening)
Metadata-protocol: none

On a by-id update or delete, when the sharing service answered `allow` for the row (the caller owns it, holds an `edit` share on it, or holds Modify All), the platform's own ownership floor (`created_by == current_user.id`, from `member_default` and `external_default`) was removed from the row-level filter. That filter is an OR of permissive policies. Where an app-authored update or delete policy applied to the caller as well, for example "any open deal" (`stage == 'open'`), removing the floor left that policy as the only term. A row the floor alone admitted, such as the caller's own closed deal, was then refused with 403 `PERMISSION_DENIED`. A predicate write (`multi: true` update, delete by `where`) over the same row wrote it.

The maintainer ruled option A on #35917 (ruling comment 7063130499, 2026-11-21): under a sharing `allow`, the creator and owner floor stays an OR term beside an authored update or delete `using` policy, so a by-id write gives the answer a predicate write already gave.

The floor is now dropped only where it is the filter's last term. Beside an authored write policy it stays one term of the OR, both in the row gate before the write and in the defaulted check on the new image. What changes:

- On an object where an authored update or delete policy applies to the caller, a by-id update or delete of a row the caller created and record sharing lets them write (they own it, or hold Modify All) is admitted again, as it was before the sharing service could replace the floor. Record sharing still decides on its own: a creator who does not own the row is still refused by it. By id and by predicate now admit the same rows.
- `security/explain` reports the same record verdict for these rows, and so does the master check a `controlled_by_parent` detail write asks about its master row.

- A write on another user's behalf (ADR-0090 D10) follows the delegator: a by-id update or delete, by the delegator or on its behalf, of a row the delegator created beside its authored policy is now admitted. Before, both were refused. The suite pinned those refusals in 22 tests. Those tests now use rows the delegator did not create, so they still refuse with every assertion kept, and new tests pin the admission of a row the delegator created: `delegated-write-never-exceeds-delegator.test.ts` (the five held-row cells and the post-image store test, under both tenancy postures, 12 tests) and `explain-enforce-parity.test.ts` (the five #24746 held rows, under both postures, 10 tests). An agent still never writes a row its delegator's own write refuses.

Removed capability: a `using` write policy no longer stops a row's own creator once record sharing says `allow`. To limit what a creator may do to their own rows, give the update policy a `check` (it judges the new image of every row); a delete has no new image, so a limit on deleting one's own rows goes in a `beforeDelete` lifecycle hook.

What does not change:

- Where no authored write policy applies, an `allow` still replaces the floor completely, as before.
- An authored policy still bounds every row the floor does not admit. Modify All does not lift an authored write policy on an ordinary business object (ADR-0066 ①), and an owner or `edit`-share target who did not create the row is still held to the authored policy.
- A `check` an author wrote still refuses the new image, the tenant wall still applies, and an `edit` share still widens update and never delete.
- Where record sharing abstains (no owner field), the floor still applies.
- Reads are not affected: the floor is a write-side policy.
- `ISecurityService.checkAuthoredRowWrite` still judges the authored policies alone, without the floor.
