---
'@objectstack/objectql': patch
---

fix(objectql): `platformSystemApi` on the api `ObjectRepository.execute` hands the action it dispatches keeps the `'action'` mark

Clause-②: no
Metadata-protocol: none

`ctx.api.object(o).execute(name)` dispatches the named action with an api over a context it marks `'action'`. That api carried neither the app-authored flag nor the action door's origin flag, so `platformSystemApi(ctx.api)` in the dispatched handler took the mark off, and its writes to `sys_member`, `sys_user_position`, `sys_user_permission_set` and `sys_invitation` passed as a platform writer's, against the documented refusal for action handlers.

- The api `execute` hands the dispatched action now carries its own origin flag, kept by every api derived from it (`sudo()`, `withRunAs(...)`, a transaction's context, the api `platformSystemApi` and the user-grants seeds return). On it, `platformSystemApi(api)` returns what `api.sudo()` returns: the `'action'` mark and any `flowRunId` kept. Writes to the four identity-assignment objects through it are refused `PERMISSION_DENIED` (403), whichever api dispatched the action, and its inserts are owner-stamped with the invoking user.
- The flag is not the app-authored flag: the dispatched handler's `delete(…, { permanent: true })` still runs.
- The api the audit writer holds (a hook registered in code) is unchanged: `platformSystemApi` still takes the mark off there.
- This is the path the action-door fix in this release did not reach. No new export, and no published signature changes.
