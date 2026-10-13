---
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
---

A kernel that mounts `createIdentityObjectsPlugin()` without `AuthPlugin` now holds its Default Organization under the `single` tenancy posture, so its seeds and system writes on tenant-scoped objects are stamped with it instead of refused with "the install holds no organization at all".

Clause-②: no

- **Why.** ADR-0131 D3 makes the Default Organization a boot invariant under `single`: it owns every row. Registering `sys_organization` is what turns the engine's and the seed loader's zero-organization branch from "unstamped" into "refused" (D9). `IdentityObjectsPlugin` registers that object, but only `AuthPlugin.start()` created the organization, so the reduced kernel the plugin exists for (ObjectQL, `createIdentityObjectsPlugin()`, `SecurityPlugin`) refused every seed row of an organization-owned object.
- **What changed in `@objectstack/plugin-auth`.** `IdentityObjectsPlugin` gains a `start()` that, under `single`, finds or creates the Default Organization with the same invariant `AuthPlugin.start()` runs. It is idempotent, and a failure fails the boot. The posture is the `tenancy` service's when one is registered, otherwise the requested one (`OS_TENANCY_POSTURE`). Under `group` and `isolated` it does nothing. Nothing new is exported, and the plugin is still refused beside `AuthPlugin`.
- **What changed in `@objectstack/runtime`.** `AppPlugin` orders `com.objectstack.auth.identity-objects` ahead of itself, as it already ordered `com.objectstack.auth`, so the organization exists before the inline seed loads, wherever a host lists the two plugins.
- **If your test kit mounts `createIdentityObjectsPlugin()`.** Its kernel now reads and writes `sys_organization` during `bootstrap()` under `single`. Publish the driver before the boot (a `driver.default` service, or a datasource plugin), not with `registerDriver()` after it. Otherwise the boot fails with `No driver available for object 'sys_organization'`. A kit that inserted its own organization row to stand in for the missing one now holds two, and a system write that names no organization is refused as ambiguous; drop that insert and read the Default Organization (`slug: 'default'`) the boot created.
