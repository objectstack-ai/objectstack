---
"@objectstack/plugin-email": patch
---

Clause-②: no

fix(plugin-email): a template send issued before `EmailServicePlugin`'s own `kernel:ready` renders, persists its `sys_email` row and delivers, instead of throwing `TEMPLATE_NOT_FOUND: no templateLoader configured on EmailService`

`EmailServicePlugin` now wires `sys_email` persistence and the registry template loader in `init`, before it registers the `email` service. Before this, both were wired in the plugin's own `kernel:ready` hook, and a plugin that starts earlier runs its `kernel:ready` hooks first. The dev admin seed (`objectstack dev --seed-admin`, the default) signs its account up from one of those hooks, so on a boot with email verification required the seed's verification mail failed. Each such boot logged `ERROR [Better Auth]: Failed to run background task: Error: TEMPLATE_NOT_FOUND …` and left no `sys_email` row. That send now goes through the transport and default sender the boot was configured with. The `mail` settings namespace is still applied at `kernel:ready`. Sends made after boot behave as before.
