---
'@objectstack/plugin-hono-server': patch
---

`GET /api/v1/auth/me/permissions` answers "no capabilities", not "capabilities unknown", when it fails after the caller is known

Clause-②: no

Once the handler knows who the caller is, it has two ways to fail. When the permission-set resolution rejects, it already answered a closed body: `systemPermissions: []`, so every capability gate closes. Any other throw inside the handler (the effective-object merge, or a resolver that throws synchronously) was caught by an outer `catch` that answered `{ authenticated: true, userId, objects: {}, fields: {} }`. That body has no `systemPermissions`, which is the shape a deployment predating ADR-0066 sends, and the console reads it as "capabilities unknown" and fails open on it. So a server-side fault offered authoring handles the server then refused.

The outer `catch` now answers the closed body, built by the same function the success path uses:

- `authenticated: true`, the caller's `userId`, and `tenantId` (the session's, or `null`), which this body did not carry before;
- `positions`, `permissionSets` and `systemPermissions` as `[]`, and `objects`, `fields` and `tabPermissions` as `{}`.

The log line is unchanged: `[hono] /auth/me/permissions failed` at `warn`, once.

**What does not change.** The success body is byte-identical. The resolver-rejection path still reports the session's positions. A stack with no SecurityPlugin or no metadata service still answers its deliberate open body without `systemPermissions`, since there the server enforces nothing either. A caller with no session still gets `{ authenticated: false }`. No accept set, export or `spec` key moves, and the console needs no change.
