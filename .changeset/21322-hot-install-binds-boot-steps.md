---
"@objectstack/cloud-connection": patch
"@objectstack/plugin-security": patch
---

fix(cloud-connection,plugin-security): a package installed into a running runtime fires its record-change flows and has its permission sets in `sys_permission_set` right away, not after a restart

Clause-②: no

**Before**, `os package install ./dist/objectstack.json` into a running `os start` (the install-local route) registered the package, bound its script actions and body hooks, and stopped there. Two things the boot does for a package happen at `kernel:ready`, and that moment had already passed. The automation engine binds flows at `kernel:ready`, so the package's record-change flows never fired: a task updated to `done` wrote no note. The security plugin seeds declared permission sets at `kernel:ready`, so the package's set had no `sys_permission_set` row. `/meta/permission` listed the set, but an admin could not grant it. A restart fixed both, because the restart re-registers the package before those two steps run. Nothing in the CLI output or the install response said a restart was needed.

**Now** the install route announces `metadata:reloaded` once the package is registered, bound, persisted and seeded. That is the same event a Studio package publish, a per-item publish and an artifact reload already announce. The automation engine already re-syncs its flows on it. The security plugin now re-runs its declared-permission seeding on it: the same function and organization passes as the boot, with the same provenance rules (`managed_by: 'package'`, `package_id`). Right after the install, the flow fires and the set's row exists, with the same state a restart gives. The seeding is idempotent and writes nothing when no permission set changed. It runs only after the boot's own pass has finished. A failed re-sync does not fail the install. It is logged at `warn` with the restart that repairs it.

**Unchanged.** The restart path (the ledger rehydrate) announces nothing and behaves as before. The install response and the CLI output keep their fields and text. A package's `defineStack({ jobs })` are still not scheduled by install-local, on install or after a restart, because a job's handler is code from the artifact's runtime module and an inline install carries only the JSON.
