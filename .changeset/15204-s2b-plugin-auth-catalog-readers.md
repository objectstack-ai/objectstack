---
'@objectstack/plugin-auth': minor
---

feat(plugin-auth)!: the last-administrator guard, the self-registration admission and the default-organization step read the security catalog and the activation ledger, never a `sys_permission_set` row (ADR-0131 D3/D4)

Clause-②: yes (narrowing: a zero-administrator write is refused when an unscoped grant names a set the security catalog does not hold, and self-registration is refused when its declared set is not in the catalog or is switched off in the activation ledger; widening: writes to a `sys_permission_set` row are no longer judged by the guard, and a ledger write switching `admin_full_access` off is refused only when it would leave no administrator)

<!-- adr-0087: not-required (runtime-interface-only packages/plugins/plugin-auth/src/last-admin-guard.ts#PERMISSION_SET_STANDING_KEYS) no authorable metadata key changes; what moves is which store three runtime readers ask, and two exported guard constants -->

**BREAKING**, shipped as `minor` under the launch-window convention for breaking changes. It finishes, for `plugin-auth`, the move the authorization resolver made in the same release: a permission set exists when the security catalog bound to the engine holds its definition, and it is switched off by a `sys_metadata_activation` row of type `permission` whose `active` is false. No `sys_permission_set` row decides either any more, its `active` column included.

**The last-administrator guard.**

- A grant-anchored platform administrator is counted the way the resolver derives one: an unscoped, in-window grant naming `admin_full_access`, which the catalog holds and the ledger leaves on. An engine with no catalog bound counts none, as the resolver grants none.
- Switching `admin_full_access` off in the ledger (an insert, an update of its row, or an update moving another row onto that pair) is judged like every other standing write. It is refused only when it would leave no administrator who can sign in. A config-anchored or organization administrator still standing permits it. The flat refusal of every such write is gone, and with it `refuseLedgerSwitchingAdminOff`.
- Writes to a `sys_permission_set` row (delete, rename, `active`, `organization_id`) are no longer judged. The resolver reads no row, so none of them moves an administrator. `PERMISSION_SET_STANDING_KEYS` is removed, and with it the guard's two `sys_permission_set` hooks.
- With zero administrators, the guard still tells the bootstrap window from an emptied environment. The evidence is now an unscoped, in-window grant naming a set the catalog does not hold (or naming none), or `admin_full_access` switched off in the ledger while such grants name it. Its remedy is to switch the set back on, and that write is permitted.

**FROM → TO** for a caller of the removed exports: `PERMISSION_SET_STANDING_KEYS` → `ACTIVATION_LEDGER_STANDING_KEYS` (the table the resolver reads deactivation from); `refuseLedgerSwitchingAdminOff` → nothing to call, `registerLastAdminGuard` judges ledger writes itself.

**Self-registration.** The admission asks whether the declared `selfRegistrationPermissionSet` would grant: the catalog holds it and the ledger leaves it on. A `sys_permission_set` row of that name must also exist, because the grant's `permission_set_id` is written with its id. The row's `active` is no longer read, at admission or when the grant is written.

**The default organization.** The platform administrator the default-organization step binds as owner is found through a set the catalog holds and the ledger leaves on, not through a `sys_permission_set` row.
