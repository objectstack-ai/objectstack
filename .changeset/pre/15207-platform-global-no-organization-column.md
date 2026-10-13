---
'@objectstack/objectql': major
'@objectstack/plugin-security': major
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/organizations': patch
---

feat(objectql,plugin-security)!: an object a deployment declares platform-global gets no organization column on that deployment — the #12699 declaration made total (ADR-0131 D7)

Clause-②: yes (narrowing)

<!-- adr-0087: registered platform-global-object-organization-column-retired -->

**BREAKING** on a deployment whose `org-scoping` service declares `platformGlobalObjects`. Nothing changes on any other deployment.

ADR-0131 D7: "an object a deployment declares platform-global gets no organization column on that deployment (the injected-columns plan reads the declaration), so Layer 0 and the driver agree by having nothing to scope." Until now the declaration stood the organization wall down for the object while the object kept its `organization_id` column, so the SQL driver went on scoping a read by the caller's organization that the wall no longer scoped.

- **The plan** (`@objectstack/spec`): `resolveInjectedSystemColumns(def, deployment?)` takes the deployment's validated `platformGlobalObjects` as an optional second argument. An object it names is planned with no `organization_id`, and nothing else in its plan moves. With no second argument, or an empty list, the plan is the same as before. Author-time callers (the linter, the import mapper, the tenancy census) have no deployment and pass none.
- **The registry** (`@objectstack/objectql`): `ObjectQLPlugin` reads the declaration at the top of `start()`, before the first schema sync, and installs it with the new `SchemaRegistry.setDeploymentPlatformGlobalObjects()`. A declared object is registered with no `organization_id`, no tenant index and `systemFields: { tenant: false }`, and its table is created without the column. An object registered earlier, inside another plugin's `init()`, is re-planned at that moment, before its table exists. The `/meta` read exits serve the same shape. On the way back in, the write path removes the recorded `tenant: false`, so a Studio save stores the body the author wrote. The plugin logs the declared list once at boot.
- **The order** (ADR-0116): every `init()` completes before any `start()`, so a provider that registers `org-scoping` in its `init()` has registered by the time the engine reads it. `OrganizationsPlugin` now declares `providesServices: ['org-scoping']` (`@objectstack/organizations`). A provider that registers the service later, with a different declaration than the one the columns were planned from, fails the boot at `kernel:ready` with an error that names both lists and the fix.
- **The stand-down is retired** (`@objectstack/plugin-security`): `getObjectSecurityMeta` no longer reads `platformGlobalObjects`. A declared object reaches the security layer as its own `systemFields.tenant: false`, the same way every deployment-level object does: Layer 0 composes no organization predicate on it, a wildcard `organization_id` policy does not apply to it, and the ADR-0123 D2 no-active-organization write refusal does not fire on it. The `[security] deployment declares N platform-global object(s)` boot line is gone; the engine logs the list instead.
- **One reader** (`@objectstack/core`): `readDeploymentOrgScopingEntitlement` moved from plugin-security into `@objectstack/core` and is exported there, with its rules unchanged. An absent key declares nothing. A malformed key is refused whole: no object is declared, and the consumer of that key warns once. The engine warns for a malformed `platformGlobalObjects`, and plugin-security for a malformed `suppressUnboundedOrgAdminGrant`. `suppressUnboundedOrgAdminGrant` and its behaviour are unchanged.

**What moves for consumers.**

- **On the declaring deployment**, a declared object has no `organization_id`. FROM an authored filter, list-view column, report grouping, formula or seed key naming `organization_id` on that object, TO the same reference with that field removed. A write that still names it is refused `INVALID_FIELD`, and a filter on it `INVALID_FILTER`. The object is governed by object permission, not by the organization wall: a reader the object permission admits reads every row, where the SQL driver used to narrow a read to the caller's organization and the rows with no organization.
- **An object that declares its own `organization_id`** keeps that column, because it is the author's and not the platform's, and the organization wall keeps scoping it. The engine warns once at boot and names the object. Remove the authored field, or drop the object from the declaration.
- **Author-time tools** have no deployment, so they still list `organization_id` among a declared object's columns. Only the declaring deployment differs, and it refuses the name at runtime.
- **Existing databases: nothing moves automatically** (ADR-0131 D14). Schema sync is additive, so on a declaring deployment the physical `organization_id` column stays and the boot drift report names it orphaned. The operator removes it once the rows need nothing from it. No boot step reads or writes it.
