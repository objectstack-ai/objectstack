---
'@objectstack/plugin-security': minor
---

`SecurityPlugin` declares the identity objects its authorization store reads, `sys_user` and `sys_member`, and refuses to boot a kernel that does not register them. The refusal names the missing objects and the plugin that registers them, where the kernel used to boot and then fail every authenticated request's permission read as an outage.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A boot refusal of a plugin composition, not a metadata change: no spec key, export, option or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The remedy is a kernel composition edit (mount plugin-auth's identity objects), which no ledger entry can derive from metadata. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this boot path and this diff adds none (not already-registered); and what narrows is which kernels boot, not a runtime interface or a type surface (not runtime-interface-only / type-surface-only). -->

**BREAKING**: a kernel that booted before is refused at boot, shipped as `minor` under the launch-window convention.

**Why.** Permission resolution, `resolveUserAuthzGrants` in `@objectstack/core`, reads `sys_user` and `sys_member`, which `@objectstack/plugin-auth` registers. The engine refuses a read of an object its registry does not hold, so a kernel with `SecurityPlugin` and without those objects booted cleanly, and then every authenticated request's permission read failed with `AuthzStoreUnavailableError` (`SERVICE_UNAVAILABLE`, 503), which reads as an outage and names no missing dependency.

**What is refused.** A kernel where `SecurityPlugin.start()` ran and the engine registry does not hold `sys_user` or `sys_member` at `kernel:ready`: `bootstrap()` rejects with an error named `AuthzIdentityObjectsMissingError`, whose `missingObjects` lists the absent names and whose message names `@objectstack/plugin-auth`, `AuthPlugin` and `createIdentityObjectsPlugin()`. Measured in this repository: three test harnesses that boot `SecurityPlugin` without `AuthPlugin` (one in `@objectstack/runtime`, two in `@objectstack/service-automation`), each now mounting `createIdentityObjectsPlugin()`. By reading the code, not by a run: `objectstack dev` through `DevPlugin` with `services: { auth: false }` and security left on is refused too.

**What still boots, unchanged.** A kernel that mounts `AuthPlugin` (`os serve` pairs the two; `@objectstack/verify`'s `bootStack` mounts both); a kernel that registers the two objects any other way; and a boot that composes `SecurityPlugin` for its declarations only (`os migrate`, which suppresses `start()`).

**The remedy.** on a kernel that mounts `SecurityPlugin` without `AuthPlugin`, such as a test kit, add `await kernel.use(createIdentityObjectsPlugin())` from `@objectstack/plugin-auth`. It registers plugin-auth's own identity list, so a hand-written plugin that registers `SysUser` and `SysMember` is no longer needed, though it still satisfies the check. A `DevPlugin` stack with `services: { auth: false }` either turns security off as well or passes `createIdentityObjectsPlugin()` in `extraPlugins`. Nothing in an app's metadata changes.
