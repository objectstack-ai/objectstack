---
"@objectstack/core": minor
"@objectstack/plugin-security": minor
"@objectstack/plugin-auth": minor
---

fix(security): `sys_permission_set.active` and `sys_position.active` now actually stop granting access (#8613)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
added, renamed or retired. `active` is a ROW property of a `sys_permission_set`
/ `sys_position` record, not a key on `PermissionSetSchema` (which is a strict
object in `packages/spec` and deliberately declares no such key — see
`permission-set-projection.ts`'s ROW_STATE_COLUMNS). No spec schema, export or
stored metadata shape changes, so there is no conversion to register and no
tombstone to write. The change is a runtime predicate at the authorization
resolution seam; the remedy for an affected deployment is operational
(re-activate rows that were switched off), not a metadata migration. -->

**BREAKING for deployments that already switched a permission set or position
off.** Both objects ship a Deactivate action whose confirmation dialog promises,
in all four locales, that access stops:

> Deactivate this permission set? Existing assignments stay in place but stop
> granting access until re-activated.
> Deactivate this position? Users keep their assignment but the position stops
> granting permissions until re-activated.

Nothing read the column. Measured on the real resolver: a position seeded
`active: false` still granted its permission sets, and a permission set seeded
`active: false` still returned `posture: PLATFORM_ADMIN` with its system
permissions. Deactivation moved a badge in Setup and nothing else — while the
admin who had just revoked a compromised or over-broad grant was told the
opposite, and whose likely next step was therefore *not* the action that would
have worked (delete the set, or remove the assignments).

**What changes at runtime.** `resolveAuthzContext` / `resolveUserAuthzGrants`
(`@objectstack/core`) — the single seam every transport resolves authorization
through — now drop a deactivated row **before** any derivation:

- a deactivated `sys_position` no longer contributes its
  `sys_position_permission_set` grants, and its name leaves `positions` (so the
  name-reuse path cannot resolve the same grant one layer down);
- a deactivated `sys_permission_set` contributes no name, no
  `system_permissions`, no `tab_permissions`, **and no `PLATFORM_ADMIN`
  posture** — the flag is applied before the posture is derived, not after;
- the `plugin-security` DB loader applies the same predicate, which is what
  judges a set reached by NAME through an active position of the same name.

Both tables were already read at that seam, so this costs **zero new hot-path
queries**.

**⚠️ Read this before upgrading.** Any `sys_permission_set` or `sys_position`
row currently carrying `active: false` **stops granting the moment this
lands** — on live data, with no migration step to notice. That is the correct
direction (it is what the dialog said when someone clicked Deactivate), but on
an installation that used the switch believing it was inert it is a real
revocation. Before upgrading, list the deactivated rows and re-activate any that
are still meant to grant:

```
GET /api/v1/data/sys_permission_set?filters=[["active","=",false]]
GET /api/v1/data/sys_position?filters=[["active","=",false]]
```

A row whose `active` column is **absent or NULL** is unaffected: the predicate
is "explicitly deactivated", never "explicitly active", so rows that predate the
column keep granting exactly as before.

**Break-glass, closed in the same change** (`@objectstack/plugin-auth`).
Enforcing the flag opened a one-click, installation-wide lockout: deactivating
`admin_full_access` un-makes every platform admin at once, through a payload
that touches neither `name` nor any identity table, and re-activating requires
the permission the click just took away (the seeders deliberately never
reconcile `active`, so no restart restores it). The last-administrator guard now
judges that write like the delete and rename spellings it already refused, and
an environment whose break-glass set is *already* off is read as emptied rather
than as a bootstrap window — so it does not silently disarm the guard for every
other identity write. Re-activation itself stays permitted, or the refusal would
have no way out from inside the product.
