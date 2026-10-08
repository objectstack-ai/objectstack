---
'@objectstack/plugin-auth': minor
---

`createIdentityObjectsPlugin()` registers plugin-auth's identity objects (`sys_user`, `sys_member`, `sys_organization` and the rest of the list `AuthPlugin` registers) on a kernel that does not mount `AuthPlugin`, such as an app's or a plugin's own test kit.

Clause-②: yes (widening)

- **What is new.** `createIdentityObjectsPlugin(options?)`, the `IdentityObjectsPlugin` class it returns, `IdentityObjectsPluginOptions` (`manifestDatasource`, with the meaning `AuthPluginOptions.manifestDatasource` has) and `IDENTITY_OBJECTS_PLUGIN_NAME` (`com.objectstack.auth.identity-objects`, its kernel plugin name).
- **One list.** It registers the identity half of plugin-auth's manifest: the header, the objects and the field plugin-auth adds to `sys_sso_provider`. `AuthPlugin` spreads the same builder into the one manifest it registers, so a reduced kernel and a full one register the same objects, and a kit no longer copies plugin-auth's object list or manifest id.
- **Same owner.** The objects register under plugin-auth's package id, `com.objectstack.plugin-auth`, as `AuthPlugin` registers them. The registry records one owning package per object, so a different id would make the owner of `sys_user` depend on which plugin a kernel mounts.
- **No authentication.** It registers objects only: no sessions, no routes, no `auth` service.
- **Not beside `AuthPlugin`.** `AuthPlugin` registers the same objects itself. A kernel that mounts both is refused at boot, by the identity plugin's `init()`, with an error naming both.
- **Usage.** `await kernel.use(createIdentityObjectsPlugin())` after `ObjectQLPlugin`. A suite that boots through `@objectstack/verify` already gets these objects: its `bootStack` mounts `AuthPlugin`.
- **Unchanged.** `AuthPlugin` registers the same manifest it registered before, under the same id.
