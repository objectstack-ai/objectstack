---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Setup no longer offers Ban with Unban, Revoke with Restore, or Unlock on every account, whatever the record's state

Clause-②: no (an action's offering: `visible` is judged in the console, and no server door reads it, so no accept set or served shape moves; if the dev measures a door that does, the dev stops, and the seat re-declares)

Five row and record-header actions judged only the caller's standing, so Setup offered both halves of each pair on every row. Each now also reads the record's state, in the form `sys_oauth_application`'s Disable / Enable pair already uses:

- `sys_user` (Setup › Users): *Ban User* is offered when `banned` is not true, *Unban User* when it is. A timed ban past `ban_expires` still reads banned until better-auth clears it at the user's next sign-in, so Unban stays offered for as long as the row says banned.
- `sys_user`: *Unlock Account* is offered when `locked_until` is set, or when the user has two-factor enabled. Unlock also clears the second-factor lock, which lives on `sys_two_factor` and not on the user row, so a two-factor user keeps the button. An expired `locked_until` keeps it too: the failed-attempt counter stays at the threshold until Unlock or a successful sign-in resets it.
- `sys_api_key` (Setup › API Keys): *Revoke API Key* is offered on a live key, *Restore API Key* on a revoked one.

The `sys_user` actions keep their platform-admin standing (`current_user.isPlatformAdmin == true`) first. A row that does not carry the field offers neither action of a pair. The console asks for every field an object action's predicate reads, so the default Users list carries `banned` without showing it.

Unchanged: labels, texts, targets and params, and what the ban, unban, unlock and key routes accept and answer. Who may restore a key that a forced password reset revoked is still decided by the server.
