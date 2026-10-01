---
'@objectstack/cli': patch
'@objectstack/runtime': minor
---

fix(cli): `os migrate plan` / `apply` no longer run the app's `onEnable` or a host plugin's post-declaration hooks during their boot

Clause-②: yes (widening)

The two schema commands boot the host's stack to read what it declares. That boot ran the
config's `onEnable`, and every `kernel:bootstrapped` / `kernel:listening` hook a host plugin
registered from `init()`. A hook that reads a table the plan does not declare then failed on
every plan. On `examples/app-crm`, whose `onEnable` binds positions to permission sets, each
plan printed six `[sql-driver] DATABASE_ERROR` lines and six `position binding lookup failed`
warnings, on a database `apply` had just migrated as well as on an absent one.

The boot now composes host code for its declarations only:

- `AppPlugin` takes a new `skipOnEnable` option. When it is set, `start()` does not run the
  bundle's `onEnable`, logs that it withheld it, and reports it through `onEnableWithheld`. The
  migrate commands set it on the app they compose from `objectstack.config.ts`.
- A host plugin's `init()` gets a context that does not register `kernel:bootstrapped` or
  `kernel:listening` hooks. The kernel contract defines those phases as work after registration
  ends: reconcile/backfill, and opening listeners. `kernel:ready` hooks still run, and the
  write guard still refuses their row writes. `kernel:shutdown` hooks and data hooks register
  as before.
- The plan's notes, and the `--json` payload's `composition.notes`, carry one line naming what
  was not run.

The plan itself is unchanged: the same tables, the same pending DDL, the same drift. `apply`
still flushes the DDL the operator confirms and still runs the coverage pass. The platform's own
plugins are untouched, so the value-shape gate announcement still prints.

`@objectstack/runtime` widens its public surface, additively: `AppPlugin`, exported from the
package root, gains the optional constructor option `skipOnEnable` (default `false`) and the
read-only getter `onEnableWithheld`. A composition that does not pass the option gets exactly
the behaviour it had, `onEnable` included.
