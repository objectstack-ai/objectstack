---
"@objectstack/spec": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-security": patch
---

fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
(10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

**The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
`metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
which occupies `metadata`, has never had it. So the probe was false on every
deployment and the dep was never passed: imported rows reached `sys_user`
uncoerced, with the branch that says otherwise sitting right there. This is the
same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
probes — a capability the code advertises and the runtime cannot deliver, kept
invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
into a compile error. The route reads `protocol` now.

`/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
`/auth/me/permissions`, two handlers up in the same file, read the public
`registry` getter over the same field of the same object. Both read the public
accessor now; the one test that stubbed `_registry` was pinning the private reach
and stubs `registry` instead.

**Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
`count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
argument they have always accepted. ObjectQL's own doc explains why it exists:
reads once took their context inside the query while writes took it in trailing
`options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
just vanished". The engine accepts both channels; the contract exposed only the
query one, so callers using the trailing channel — the current-user endpoints'
permission-set loader among them — could only reach it by erasing the lookup.
Adding an optional trailing parameter breaks no implementor (the existing
minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
already exported, sitting unused under the "legacy/deprecated" heading, which is
why the contract went looking and did not find it; it moves up beside the other
QueryAST-aligned types with the rationale attached. One new spec test pins the
trailing argument at the call site — the position where the old contract rejected it.

**Where the contract does not reach, the escape hatch is named.** Three slots
resist a spec type today and each gets a narrow, documented local interface
instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
— plugin-hono-server must not depend on an optional plugin), `settings`
(service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
(`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
wider contract, so typing the whole thing `IDataEngine` would be "the more
comfortable-looking lie". These declarations are what that contract gets written
from, and what it deletes.

No behavior changes beyond the two fixes above.
