---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit)!: a row about a record is served only when the reader can open that record through the data door

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or retyped: what moves is which rows the activity stream, the compliance ledger and the comment gate serve a reader, decided by each parent object's existing enable block. Nothing at rest changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING.** An activity row, a compliance-ledger row and a comment are each about a record, and each is served to a reader only when that reader can open the record through the data door. The shared parent-record gate now leaves out every parent object whose `enable` block the data door refuses `get` for (`enable.apiEnabled: false`, or an `apiMethods` list without `get`), judged by the same decision the door reads (`canServeApiOperation` in `@objectstack/spec/data`). That decision depends on the object's declaration alone, so it holds for every reader, administrators included. An object with no `enable` block is unaffected.

Who moves:

- **Activity stream (`sys_activity`)**: every reader, administrators included, stops being served rows about records of an object the data door does not serve. Rows about every other object are served exactly as before.
- **Compliance ledger (`sys_audit_log`)**: a reader the ledger's parent-record gate narrows, organization administrators included, stops being served rows about records of an object the data door serves to no one: such a record counts as one the reader cannot open. That includes a reader's own OAuth consent-use rows (`credential_use` rows about `sys_oauth_consent`); the auth door's authorized-clients view still shows each client's last use. An explicit grant of the ledger's audit capability (`view_all_audit_log`) gives those rows back. Its holders, platform administrators by default, are decided before the gate and still read every ledger row their grant and row scope reach. Rows about no record are served as before.
- **Comments (`sys_comment`)**: no reader is served a comment on a record of such an object, on stamped and unstamped rows alike.

Nothing else moves: the object-level read check, the engine's own read scope, system reads and `current_user.can()` keep their answers, and no object's `enable` block changes.

What to do: nothing, for a reader who opens the records it reads about. To read the history of an object the data door does not serve, read the ledger as a holder of `view_all_audit_log`. To serve its activity and comments to readers, expose the object's `get` on the data door in its `enable` block.
