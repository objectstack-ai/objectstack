---
'@objectstack/cli': patch
---

fix(cli): a production `os serve` of a host config that resolves no storage says so before any plugin starts, and refuses to boot when its auth service needs a driver

Clause-②: no

A host config (one whose `plugins` hold plugin instances) served in production with no recognized `OS_DATABASE_URL`, no `--dev` and no plugin named like a driver declares no default datasource. Nothing said so.

- **Before.** The boot went on and died when `AuthPlugin` started: `✗ Plugin com.objectstack.auth failed to start - rollback complete: [ObjectQL] No driver available for object 'sys_organization'`. Before that line, objectql logged `ERROR sys_metadata could NOT be read at boot`, whose fix read `check the datasource behind sys_metadata — connection, credentials, and that the table exists`, for a datasource the operator never declared. No line named `OS_DATABASE_URL` or `--dev`. `examples/app-showcase` under a bare `os serve` took this path.
- **After, when the auth service runs under the `single` tenancy posture (the default) and no plugin registered a driver by the end of plugin init.** The boot is refused before any plugin starts, exit 1, with `✖ This production serve has no storage: …` and three fixes: set `OS_DATABASE_URL` (for example `file:./data/app.db`, or a `postgres://` or `mysql://` URL), mount a storage driver in the stack's `plugins` (for example `new DriverPlugin(driver)` from `@objectstack/runtime`), or run with `--dev`. Neither of the two lines above prints. Every configuration refused here failed to boot before this change.
- **After, when no driver is registered and the auth service does not need one at start** (no auth composed, as under `--no-server --preset minimal`, or a walled tenancy posture): one `⚠ No storage: …` line names the same fixes, and the boot goes on as before. A plugin that registers a driver in its `start()`, such as a module's `onEnable`, still works.
- **When a plugin registers a driver during init**, under any name, nothing is printed and nothing changes.

`os start`, a standalone (non-host) config, `--dev` and any recognized `OS_DATABASE_URL` take other paths and are unchanged.
