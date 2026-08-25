---
"@objectstack/plugin-security": patch
---

fix(security): stop reading a truncated existence page as "absent" — the unscoped page cap is now measured, not trusted (#11518)

`buildExistingByName` (`seed-name-lookup.ts`) is the batched existence oracle the
identity seeders consult in place of a per-item read. Its UNSCOPED page was
capped at `limit: names.length`, which is exact only while one row can exist per
name. Since #8461 / ADR-0120 D1 `sys_capability.name` and
`sys_permission_set.name` are unique **per organization**, and ADR-0066 D1
explicitly encourages admins to EXTEND the registry inside their own
organization — so one name legitimately carries a row per organization plus the
platform's, and an unscoped page of N names can match far more than N rows.

The rows that fall off a full page are the highest `id`s under #4363's
`ORDER BY id ASC` tie-breaker, so **whole names vanish from the page** — and a
name missing from the page reads as `absent`, which routes its caller to the
**INSERT** branch. #10103 had already found and repaired exactly this on the
SCOPED arm; the unscoped arm never got the repair, and two seeders on `main`
read unscoped (`bootstrapDeclaredCapabilities`, `permission-set-projection`'s
env-overlay pass).

⛔ `names.length * 2` would have been the same defect with a larger constant:
rows-per-name is bounded only by the number of organizations, so no constant
multiplier is correct. Instead the cap stopped being a promise and became a
**measurement** — the read asks for one row MORE than it is willing to hold, and
a page that comes back carrying that extra row is a PREFIX of the answer rather
than the answer. It then joins the module's existing "could not answer" causes
and degrades to the per-item read, the fallback already there for a driver
without `$in`. Both directions are exact: no complete page is ever mistaken for
a truncated one, and no truncated page for a complete one.

**Behaviour change, stated rather than slipped in.** In the truncating case the
two unscoped seeders go from a **silent wrong answer to a loud slow one**: names
that used to be reported `absent` (and re-inserted, or refused by the unique key
as a collision naming a row nobody ever saw) are now answered correctly, at the
cost of one read per name plus a warning naming the object and the budget it
could not fit inside. An install that does not overflow the budget — every stock
one, where a name carries a single row — issues exactly the same single read it
issued before and says nothing.

The SCOPED arm keeps #10103's cap exactly (`names.length * 2`), because there the
number is a proven bound rather than a budget: `applyTenantScope` returns this
organization's rows plus organization-less ones, and the declared name index is
unique per organization. It gains the same probe, which turns a scoped page that
overflows that bound — reachable only where the unique index is absent or not yet
created — into the same loud degradation instead of a silent truncation.
