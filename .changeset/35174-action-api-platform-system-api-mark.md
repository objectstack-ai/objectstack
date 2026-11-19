---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql, runtime): `platformSystemApi` on an action handler's `ctx.api` keeps the `'action'` mark, and what it returns stays wrapped

Clause-②: no
Metadata-protocol: none

`platformSystemApi(api)` (new in this release, from `@objectstack/objectql`) takes the app-automation elevation mark and `flowRunId` off a hook's api, so the audit writer's own ledger rows are not judged as an automation's insert. On the `ctx.api` an action door hands a host code action handler (`engine.registerAction`) it took the `'action'` mark off too, so a handler handing its own api to it could write `sys_member`, `sys_user_position`, `sys_user_permission_set` and `sys_invitation` as a platform writer, against the documented refusal for action handlers. What it returned also bypassed the two layers runtime puts on that api: the stored-metadata read projection and the answer for a write that landed while its parent roll-up could not be recomputed.

- The api an action door builds now carries its own origin flag, kept by every api derived from it (`sudo()`, `withRunAs(...)`, a transaction's context). On it, `platformSystemApi(api)` returns what `api.sudo()` returns: the `'action'` mark and any `flowRunId` kept. Writes to the four identity-assignment objects through it are refused `PERMISSION_DENIED` (403), and its inserts are owner-stamped with the invoking user, as the handler's own are.
- The flag is not the app-authored flag: a host handler's `delete(…, { permanent: true })` still runs.
- The api the audit writer holds (a hook registered in code) is unchanged: `platformSystemApi` still takes the mark off there.
- Runtime's derivation walk now wraps the api `platformSystemApi` derives, so it is served through the stored-metadata read seam and the landed-write answer like `ctx.api.sudo()`.
- No new export: the flag's key is a `Symbol.for` key neither package entry exports.
