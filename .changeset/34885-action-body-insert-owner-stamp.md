---
'@objectstack/plugin-security': patch
'@objectstack/core': patch
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

This covers every handler an action door dispatches, not only a script body's `ctx.api`. A host code action handler and an action reached through `ObjectRepository.execute` run under the same action context, and their inserts are stamped the same way.

Assignment rules (ADR-0142 D5) route only a row whose `owner_id` and `queue` are both still empty. An action-body insert is now the invoker's own record, as a direct create by that user already was, so assignment rules route neither. Before this release, an action body's unowned, queue-less insert on an object a rule reaches was routed by the rule. It now goes to the invoker. A body has no spelling today that asks a rule to route its row.

`@objectstack/core`: the header of the app-automation elevation mark (shipped in its type declarations) now names the owner stamp as a second reader beside the refusals.

Unchanged: flows (`runAs: 'system'` or not), hooks with `runAs: 'system'`, seed, boot and import writes, and any other system context. They still store the owner they write, or none, and an unowned, queue-less insert from one of them is still routed by assignment rules. Rows stored before this release keep `owner_id` null; an administrator can assign their owners.
