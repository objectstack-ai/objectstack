---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-auth': minor
---

feat(spec,core)!: a position's permission sets are declared in `permissionSets` on its definition, and the authorization resolver reads positions, their sets and the set bodies from the security catalog (ADR-0131 D3/D4)

Clause-②: yes

<!-- adr-0087: registered position-permission-sets-declared -->

**BREAKING** (the resolver stops reading the position → permission-set junction), shipped as `minor` under the launch-window convention for breaking changes.

**FROM → TO.** A position's permission sets were `sys_position_permission_set` rows. They are now declared in `permissionSets` on the position's definition; junction rows no longer grant.

```ts
definePosition({ name: 'sales_rep', label: 'Sales Representative', permissionSets: ['crm_sales_user'] });
```

The one-line fix for an app that bound sets to its positions with a boot-time binder: name the sets in `permissionSets` on each position.

**`@objectstack/spec`.** `PositionSchema` accepts `permissionSets`: a list of permission-set names (lowercase snake_case). Before, the key was refused with a pointer to the junction. Each name is resolved in the environment catalog when a holder's grants are resolved. A name the catalog does not hold confers nothing.

**`@objectstack/core`.** `resolveUserAuthzGrants`, and every surface built on it (`resolveAuthzContext`, `hasPlatformAdminStanding`, the permission explainer, `runAs: 'user'` automation), reads the security catalog the security plugin binds to its engine (`bindSecurityCatalogReader`, `securityCatalogReaderOf`):

- A held position grants the sets its definition's `permissionSets` names. The junction rows and the read of set rows by the junction's ids are gone.
- A held set, granted directly or through a position, has the body (`systemPermissions`, `tabPermissions`) of its catalog definition. A set that only a `sys_permission_set` row carries, with no definition, confers nothing.
- **Deactivation moves to the activation ledger** (ADR-0049, as ADR-0131 D3 and ADR-0126 §4 place it). A position or a permission set is switched off by a `sys_metadata_activation` row of type `position` or `permission` whose `active` is false, deployment-wide. The `sys_position` and `sys_permission_set` rows are no longer read at all, their `active` column included. A name with no ledger row is in effect. A composition that does not register the ledger object (no `PlatformObjectsPlugin`) switches nothing off and issues no ledger read.
- `convertDeactivatedCatalogRows` turns the rows' `active: false` flags into ledger rows. A name some organizations switched off and others kept on is reported `conflicting`, because the ledger is deployment-wide. The upgrade ceremony applies it beside `convertPositionBindingRows`. ⛔ It never runs at boot.
- Platform standing still requires an organization-less `admin_full_access` user grant, now resolved by name in the catalog.
- An engine no security plugin started on has no catalog bound, and resolves no set and no position-bound set. That is what an engine with no permission tables provisioned resolved before.
- `convertPositionBindingRows` converts the junction rows into each position's `permissionSets`. It answers per name `declared`, `converted` or `conflicting`, and it lists dangling bindings. The upgrade ceremony applies it. ⛔ It never runs at boot.

**`@objectstack/plugin-security`.** The plugin binds the catalog read (engine registry and metadata service) to its engine at `start()`. At `kernel:ready` the built-in `everyone` anchor declares the deployment's baseline in its `permissionSets`: the app's `isDefault` set and the platform's `member_default`. It is judged by the same high-privilege check against the stack's declared capabilities that the boot binding used. Under a wall the envelope now carries `member_default` beside the app's set, as it did under `single`. `member_default` carries no system or tab permission, and enforcement already applied it to every human as the additive baseline. A Setup edit of a position row under `single` keeps the `permissionSets` the stored definition names (the row has no column for it).

**`@objectstack/plugin-auth`.** The last-administrator guard follows what the resolver reads. Its standing-key map judges `sys_metadata_activation` (`metadata_type`, `name`, `active`) in place of `sys_permission_set`. A new hook refuses a ledger write that switches `admin_full_access` off (`refuseLedgerSwitchingAdminOff`). Its `sys_permission_set` hooks stay registered, unchanged.

**`@objectstack/plugin-security`.** The name-fold warning's remedy now names the position definition's `permissionSets`, not a junction row.

**What stops granting at upgrade, and what to do.**

- **A deactivation made in Setup.** The Deactivate action on a position or a permission set writes the row's `active` column, which no longer switches anything off. ⚠️ Until the upgrade ceremony converts the rows (`convertDeactivatedCatalogRows`), a position or set deactivated that way **grants again**. No enable/disable door accepts the `permission` or `position` type yet, so a new deactivation has no in-product path. To revoke now, remove the assignments or the binding.

- **A binding made in Setup.** Binding a permission set on a position's page writes a `sys_position_permission_set` row, and so does confirming an audience-binding suggestion. That row no longer grants. Until Setup writes the definition (objectui C9), declare the binding in the position's `permissionSets` through the metadata door (`PUT /api/v1/meta/position/:name`, platform administrator) or in the app's code.
- **Under a wall (`group`, `isolated`): a position or permission set an organization authored in Setup.** It is a data row with no definition in the environment catalog (ADR-0131 D3), so it stops granting (ruling #15196 Q3 = A). To keep it, a platform administrator re-creates it as environment metadata through the metadata door, under the same name, with its `permissionSets` or its set body. No command promotes a row in place today.
- **Existing junction rows** are converted into definitions by the ADR-0131 upgrade ceremony (`os migrate`), which applies `convertPositionBindingRows`. A name that organizations bound differently is reported `conflicting` and is never merged.
