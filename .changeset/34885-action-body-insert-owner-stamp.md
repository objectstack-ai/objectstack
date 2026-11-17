---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a record an action body inserts is owned by the user who ran the action

Clause-②: yes
Metadata-protocol: none

An action body's `ctx.api` (and `ctx.engine`) runs the invoking user's context elevated to system. The security middleware's system bypass skipped the owner stamp a direct create gets, so a row the body inserted with `ctx.api.object(X).insert({...})` was stored with `owner_id` null, while `created_by` named the invoker. On an object with `sharingModel: 'private'` a non-admin invoker then could not read or update the record their own action had just created: `get` by the returned id answered not-found.

An action body's insert now fills an EMPTY `owner_id` with the invoker, as a direct create by that user does:

- every row of a batch insert whose owner is empty is stamped;
- an `owner_id` the body sets itself is kept, another user's included (the body is trusted code, as before);
- a guest invoker is stamped with nothing (ADR-0138 D1);
- under delegation the stamp names the same principal a direct create under that context names (ADR-0090 D10);
- a body that names an ownership queue and supplies `owner_id` empty beside it parks the row unowned in the queue; a body that names a queue and leaves `owner_id` out gets an owned row with that home queue (ADR-0142 D3).

Unchanged: flows (`runAs: 'system'` or not), hooks with `runAs: 'system'`, seed, boot and import writes, and any other system context. They still store the owner they write, or none. Rows stored before this release keep `owner_id` null; an administrator can assign their owners.
