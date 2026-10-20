---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth): the auth product name binds to `branding.workspace_name` only where the settings service offers the `branding` namespace, so a walled boot no longer warns about it

Clause-②: no (a boot-time binding is skipped where the namespace it reads does not exist; no accept set or served shape moves)

`AuthPlugin` binds the product name in sign-in emails, the authenticator app entry and the MCP sign-in to the `branding.workspace_name` setting. `@objectstack/service-settings` (same release) no longer offers the `branding` namespace under the `group` and `isolated` tenancy postures, so that read failed on every such boot and logged `Auth: failed to apply branding.workspace_name: No settings manifest registered for namespace 'branding'.` at `warn`.

The binding is now made only when the settings service lists the `branding` namespace, the same test the runtime config makes. On a walled deployment nothing is read and nothing is logged, and the configured app name (`OS_APP_NAME` and its chain) stays in force. That is the name such a deployment always got, since the walled read only ever saw organization-less rows. On a single-organization deployment a saved name applies as before.
