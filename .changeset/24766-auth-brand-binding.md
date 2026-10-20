---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth): the auth product name binds to `branding.workspace_name` only where the settings service offers the `branding` namespace, so a walled boot no longer warns about it

Clause-②: no (this package stops reading a namespace `@objectstack/service-settings` no longer offers under a wall; that withholding, declared BREAKING in its changeset, is what narrows the walled deployment, and nothing here widens)

`AuthPlugin` binds the product name in sign-in emails, the authenticator app entry and the MCP sign-in to the `branding.workspace_name` setting. `@objectstack/service-settings` (same release) no longer offers the `branding` namespace under the `group` and `isolated` tenancy postures, so on such a deployment that read would fail on every boot and log `Auth: failed to apply branding.workspace_name: No settings manifest registered for namespace 'branding'.` at `warn`.

The binding is now made only when the settings service lists the `branding` namespace, the same test the runtime config makes. On a single-organization deployment a saved name, or one pinned with `OS_BRANDING_WORKSPACE_NAME`, applies as before.

**On a walled deployment (`group` / `isolated`) the auth product name now comes from the `OS_APP_NAME` chain alone.** Nothing is read from the `branding` namespace and nothing is logged. Two sources that used to name sign-in emails, the authenticator issuer and the MCP sign-in there stop doing so:

- `OS_BRANDING_WORKSPACE_NAME`. The settings service served it as an `env` value whatever the posture, and this plugin applied it.
- A `branding.workspace_name` row stored with no organization, for example one saved before the wall stood.

Migration, FROM → TO: `OS_BRANDING_WORKSPACE_NAME=Acme` → `OS_APP_NAME=Acme`. Set `OS_APP_NAME` to the name the deployment's sign-in emails and authenticator entries should carry. A deployment that set neither source sees no change.
