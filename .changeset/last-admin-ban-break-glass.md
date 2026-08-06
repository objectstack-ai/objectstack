---
"@objectstack/plugin-auth": minor
---

feat(plugin-auth): break-glass — a ban may never leave the environment with zero administrators (#5892)

`sys_user.banned = true` is where every deprovision lands: better-auth's admin
plugin writes it, and `@better-auth/scim` maps a SCIM `active: false` onto that
same admin ban. Nothing checked what the write left behind — so **banning the
last administrator was allowed, reported success, and locked the organization
out of its own environment permanently.** SCIM makes that a realistic accident
rather than a hypothetical one: the write is driven by an external system, so
nobody reads the payload before it commits, and one mis-scoped IdP group is
enough.

**New guard (`last-admin-ban-guard.ts`, cloud ADR-0024 D5.2).** A `beforeUpdate`
hook on `sys_user` refuses any write that turns `banned` on when it would leave
the environment with **no unbanned administrator**. It sits on the write, not on
an endpoint, so it holds for the admin ban endpoint, the SCIM adapter write, an
import, a script, and anything added later — by-id **and** predicate/`multi`
writes alike.

Who counts as an administrator is exactly what the rest of the platform already
counts: a platform admin (an unscoped, in-window `admin_full_access` grant —
the same evidence `resolveAuthzContext` derives `platform_admin` from) or an
organization `owner`/`admin` membership. `delegated_admin` does not count
(ADR-0105 D8: it can reach an endpoint, it carries no authority), an expired
grant does not count, and the non-loginable `usr_system` account does not count.

Three consequences worth knowing before you upgrade:

- The refusal is a **403** carrying `PERMISSION_DENIED` and a message that names
  the user, the invariant, and the fix (grant someone else `admin_full_access`
  or an owner/admin membership first — and if an IdP drove the ban, the SCIM
  deprovision is too broad). On the auth pipeline it now surfaces as a proper
  `APIError` instead of an opaque 500.
- It **fails closed**: if the administrator population cannot be read, or is too
  large to enumerate, the ban is refused rather than guessed at. The failure
  mode being prevented is a permanent lockout.
- Writes that do not turn `banned` on — unbans, profile edits, re-banning an
  already-banned admin — are untouched, and so is banning anyone who is not an
  administrator.

The other half of the same invariant (`enforced` SSO must never disable the last
local admin's **password** — the escape hatch for an IdP outage) was already
implemented and is now pinned by tests rather than reimplemented:
`emailAndPassword.enabled` stays `true` under enforced SSO while sign-up is
forced off, and the last local `credential` account still cannot be banned,
removed or deleted.
