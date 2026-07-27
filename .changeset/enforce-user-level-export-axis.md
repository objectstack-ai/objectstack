---
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-hono-server": patch
"@objectstack/rest": minor
---

feat(security): ENFORCE the user-level export axis on the server (#3544)

`allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
hid the client's Export button — and nothing else. Because `export ⊆ list`, the
REST export route streams through `findData` and the engine middleware sees an
ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

- **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
  now a real decision: `export` = read granted ∧ not explicitly denied.
  `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
  means "the bit must be truthy", which would have denied export to every
  permission set authored before the axis existed. The new exported
  `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
  `false` beats unset) exactly as the `/me/permissions` merge does.
- **spec** `ISecurityService` gains `canExport(object, context)` — the question a
  bulk-egress door outside the engine middleware has to ask before it reads.
  Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
  middleware.
- **rest** `GET /data/:object/export` calls it and answers **403
  `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
  object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
  says the object exposes no export, 403 says this caller may not use it. No
  security service (no `plugin-security` ⇒ no permission sets) → allowed, the
  same fail-open posture as every other permission gate in that layer; service
  present but unable to answer → denied.
- **plugin-hono-server** the `/me/permissions` annotation now falls back to the
  `'*'` entry's export bit when a per-object entry declares none, matching the
  evaluator's own wildcard fallback — so a set that denies export wholesale via
  `'*'` no longer offers a button the server refuses.

Backward-compatible: `allowExport` is still an opt-out with no default, so an
unset bit inherits read and existing permission sets behave exactly as before.
Only a permission set that explicitly sets `allowExport: false` changes — and it
now changes on the server, which is the point.

Implementers of `ISecurityService` outside this repo must add `canExport`; the
interface member is required, matching how `getReadableFields` was added.
Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
partial implementation degrades rather than throwing.
