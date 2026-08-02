---
"@objectstack/spec": major
---

Resolve the `Session` dual source — `./api` keeps the bare names, the `./identity` declaration is removed (#4641)

`Session` and `SessionSchema` were each declared **twice**, once on
`@objectstack/spec/api` and once on `@objectstack/spec/identity`. Which shape a
consumer got depended only on which entry point they imported from — the #4411
trap — and the two did not even agree on field names, so the mistake surfaced as
a runtime `undefined`, not a type error.

**FROM → TO**

| Import | Before | After |
|:--|:--|:--|
| `@objectstack/spec/api` | `Session` / `SessionSchema` | unchanged — this is now the only declaration |
| `@objectstack/spec/identity` | `Session` / `SessionSchema` (a second, different shape) | **removed** |

The surviving `./api` shape is the wire contract:

```ts
{ id: string; expiresAt: string; token?: string; ipAddress?: string; userAgent?: string; userId: string }
```

It is embedded in `SessionResponseSchema`, the body served for
`AuthEndpointPaths.getSession` (`/get-session`, `/me`, `/refresh`).

The removed `./identity` shape was
`{ id, sessionToken, userId, activeOrganizationId?, expires, createdAt, updatedAt, ipAddress?, userAgent?, fingerprint? }`.

**Nothing consumes it.** An import-statement-level scan across framework, `cloud`
and `objectui` found no importer outside its own unit test, and it was wired into
no parent schema. It had also drifted from the record it claimed to describe: the
**enforced** session row is the `sys_session` object in
`@objectstack/platform-objects`, which spells the columns `token` and
`expires_at` (matching `./api`, not `./identity`) and has no `fingerprint` at all.

**If you were importing `Session` from `@objectstack/spec/identity`**, change the
specifier to `@objectstack/spec/api` and rename the fields you read:
`sessionToken` → `token`, `expires` → `expiresAt`. `createdAt` / `updatedAt` /
`activeOrganizationId` / `fingerprint` are not on the wire shape — read the
persisted record through the `sys_session` object, which is what the migration
and the auth plugin actually enforce.

Reference docs follow the declaration: `Session` is now documented on the
`references/api/auth` page (the module that declares it) instead of the
name-collision page `references/api/identity`, which is removed.
