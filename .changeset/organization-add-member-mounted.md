---
"@objectstack/plugin-auth": patch
---

feat(plugin-auth): mount `POST /api/v1/auth/organization/add-member` — platform-admin-gated wrapper over better-auth's server-only `auth.api.addMember` (#9941)

better-auth (1.7.1 installed; already true on 1.7.0-rc.2) declares `addMember`
with **no HTTP path** — server-only — so the catch-all never mounted
`POST /organization/add-member`, yet the `sys_member` **Add Member** toolbar
action has always targeted exactly that URL and answered 404. On a multi-org
posture that 404 was a hard blocker: `admin/create-user`'s reconciler resolves
no target org under the org wall by design, generic `sys_member` CRUD is
suppressed (ADR-0010 full lock), and the invite flow needs an email round-trip
phone-number-only users cannot complete — leaving **no UI path at all** to
attach an existing user to an organization.

What ships:

- `auth-plugin.ts` now mounts the route ahead of the catch-all, wrapping the
  vendor's own `auth.api.addMember` (its already-a-member pre-check, membership
  limit, team resolution and hooks all stay the vendor's — nothing is
  re-adjudicated, and no `sys_member` row is written directly).
- **Admit set: platform admin only** (the shared ADR-0068 gate,
  `platform-admin-gate.ts`). Anonymous → `401 UNAUTHENTICATED`; any signed-in
  non-platform-admin — including org owners/admins — → `403 PERMISSION_DENIED`
  (ADR-0112 envelope). The vendor endpoint performs no authorization of its own
  (server-only = trusted caller), which is why the gate is not negotiable.
- Request headers are forwarded, so an omitted `organizationId` defaults to the
  caller's active organization — the behaviour the action metadata documents.
- The route is ledgered in `auth-route-ledger.ts` (`source: 'objectstack'`,
  `disposition: 'server-only'` — no SDK method builds this URL; the metadata
  action posts it directly), and the stale `adopt-membership.ts` claim that
  named the vendor path as mounted now describes the real shape.

The `sys_member` action metadata itself is untouched: its target was correct
all along — the route underneath it now exists.
