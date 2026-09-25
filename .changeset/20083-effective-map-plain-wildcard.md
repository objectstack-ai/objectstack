---
'@objectstack/core': patch
---

fix(core): the effective object-permission map covers what a plain `'*'` grant covers, so `current_user.can()` agrees with the server for a wall-less org admin (#20083)

`buildEffectiveObjectPermissions` builds the `objects` slot of `GET /auth/me/permissions` (`@objectstack/plugin-hono-server`) and the map `ISecurityService.getEffectiveObjectPermissions` returns (`@objectstack/plugin-security`), which the engine hands to `current_user.can(object, verb)` on the write path. It merged each permission set's EXPLICIT entries and kept `'*'` as a key of its own. The server's check does not stop there: `PermissionEvaluator.checkObjectPermission` resolves each set to its explicit entry for the object when it has one, and otherwise to its `'*'` — for a public object always, for a private one only when the wildcard carries a super-user bit. So an object reached only through a plain wildcard (no `viewAllRecords` / `modifyAllRecords`) had no entry in the map, and `can()` — which reads an absent entry as "no grant" — answered `false` where the server allows.

The population it hit: `organization_admin_no_bypass`, which a deployment without an organization wall grants to organization owners and admins. With it and `member_default`, `current_user.can('crm_account', 'edit')` was `false` while the data plane accepted the edit, so a `can()`-gated option was refused on the write path, and a client that answers `can()` from `/auth/me/permissions` got the same `false`. `viewer_readonly` read the same way (`read` on every object it covers).

**What changes.** A new step in `buildEffectiveObjectPermissions`, after the super-user seed and before the wildcard fold, applies each set's plain `'*'` to the registered objects that set does not name:

- only registered objects, and only public ones (`access.default` other than `'private'`);
- a set that names the object keeps its explicit entry as its whole answer, as on the server;
- another set's plain wildcard widens an entry that is already present, bit by bit;
- only `true` grant bits are copied; a wildcard's `false` or unset bit adds nothing;
- an object the step would add, but whose entry grants no verb on its own, is left out.

The step reads `name` and `access.default` off the `allSchemas` entries, so a direct caller of `buildEffectiveObjectPermissions` passes the registered schemas themselves there, as both in-repo callers do; an entry without `access` reads as public, exactly as the server reads it.

**What a reader of `/auth/me/permissions` sees.** For a subject holding a plain wildcard, `objects` gains an entry for every registered public object the wildcard covers that had none, annotated with `apiOperations` by the same rule as every other entry. An entry that was already there may gain `true` bits. Nothing is removed. For a subject holding no plain wildcard — `admin_full_access`, a walled `organization_admin`, `member_default` alone — the response is byte-identical to before. The response shape, its keys and the route are unchanged.

This closes the known gap that the `current_user.can()` write-path entry in this release describes: `organization_admin_no_bypass` now reads `true` from `can()` where the data plane allows.
