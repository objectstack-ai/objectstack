---
"@objectstack/plugin-auth": minor
---

feat(plugin-auth): break-glass — the last administrator cannot be DELETED either (#5941)

#5892 closed the *ban* half of ADR-0024 D5.2's break-glass invariant. The
**delete** half was still open, and it was reachable end to end: in an enforced
SSO environment the last administrator is typically IdP-managed and holds no
local password, so when the IdP drops them from the admin group the resulting
SCIM `DELETE /Users/{id}` (or `/admin/remove-user`, or `/delete-user`) removed
the row and **left the environment with nobody able to administer it** — quite
possibly with a password-holding non-admin still able to sign in and change
nothing. There is no recovery path from inside the product once that happens.

The pre-existing HTTP guard on those three endpoints did not cover it: it
protects the last holder of a local `credential` account, so it skips the
credential-less (IdP-managed) target entirely. It is unchanged and keeps
enforcing its own invariant.

**What changed.** The guard module now enforces one invariant on *both* writes
that can take the last administrator away, off one administrator enumeration:

| write | hook |
|:--|:--|
| `sys_user.banned = true` | `beforeUpdate` (#5892) |
| deleting the `sys_user` row | `beforeDelete` (**new**) |

The delete half is the ban half's twin in every property that matters: it sits
on the **write**, so it holds for the SCIM adapter delete, better-auth's admin
remove-user, an import and a script alike; it covers by-id **and**
predicate/`multi` deletes (including the unpredicated `multi` that would empty
the table); it applies to **every** context, `isSystem` included, because the
deprovision path that actually locks organizations out is the system one; and it
**fails closed** — an administrator population that cannot be read, or is too
large to enumerate, refuses the delete rather than guessing.

The refusal is a **403** carrying `PERMISSION_DENIED` and names the operation
the caller actually attempted ("Refusing to delete 'usr_…'"), the invariant
(ADR-0024 D5.2), and the fix — grant someone else `admin_full_access` or an
owner/admin membership first, and if an IdP drove it, the SCIM deprovision is
too broad. On the auth pipeline it surfaces as an `APIError`, not an opaque 500.

Untouched: deleting anyone who is not an administrator, deleting an
administrator while another unbanned one remains, and deleting an administrator
who is already banned (that account could not sign in either way).

**Rename.** The module is now `last-admin-guard.ts` and the exported registration
function is `registerLastAdminGuard` (was `last-admin-ban-guard.ts` /
`registerLastAdminBanGuard`, added in the same unreleased cycle) — it registers
both hooks, so the old name would have understated what it installs. Hosts that
wire the guard onto their own ObjectQL engine rename the import; there is no
other change to its signature or behaviour.

Not covered, tracked separately (#5978): revoking the *standing* that makes
someone an administrator — deleting or downgrading their `sys_member` row,
removing the `admin_full_access` grant — leaves the user row in place and writes
a different table, so neither hook sees it.
