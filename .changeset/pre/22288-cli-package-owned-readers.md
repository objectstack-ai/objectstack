---
"@objectstack/cli": patch
---

The CLI reads a multi-package app's package-owned keys (`requires`, `tiers`, `analyticsCubes`, `flows`, `objects` and the rest) out of its package bodies, as it reads a one-package app's top level.

Clause-②: no

A `composeStacks([…], { manifest: 'preserve' })` config carries each of these keys only inside the body of the package that declared it. Its top level carries none of them. These readers looked at the top level only, so they read nothing on such an app, and did so silently:

- **`os serve` capability providers.** A config boot with no compiled artifact did not mount the provider a package declares in `requires` (`automation`, say). The boot logged `Optional service not present` and the features that need the provider were absent. `os dev`, `os start`, and `os serve` beside a built `dist/objectstack.json` already mounted it, because they boot the artifact.
- **`os serve` tiers.** A package's own `tiers` were ignored on `os serve`, `os dev` and `os start`. The preset's tiers were used instead.
- **`os serve` analytics cubes.** The always-on analytics provider started with none of the cubes a package declares in `analyticsCubes`, on every boot of such an app.
- **`os serve` flow line.** The ready banner's line `N flow(s) declared but the automation engine is not enabled` never counted a package's flows, so it did not appear.
- **`os migrate plan` / `apply`.** A host plugin that hard-depends on a provider a package's `requires` supplies could not be ordered. Both commands exited 1 with `Dependency '…' not found for plugin '…'`.
- **`os generate`.** After writing a flow, it warned that the config does not require `automation` and `triggers` even when a package declares both. `os generate types`, `client` and `migration` emitted none of a package's objects.
- **`os doctor`, `os diff`, `os migrate meta`.** `os doctor` skipped every metadata check and reported a healthy environment. `os diff` reported no change for an object added to a package. `os migrate meta` did not list the data migration a package's file fields need.

Each now reads by one rule: the top-level value when the stack carries one, otherwise every package body's. This is the rule `os validate` and `os build` already use for `requires`. A stack with no `packages[]` reads exactly as before.

**Two behaviours narrow.** In each, a two-package app is now refused where the same declarations in one `defineStack` were always refused:

- A capability a package declares in `requires` with no installed provider (`requires: ['ai']` in the open edition, say) now stops an `os serve` boot of the config, with the same `Capability "…"` error. `os dev` and `os start` already stopped there.
- A package's `tiers` now apply. A package that declares `tiers` without `auth` gets a stack with no auth, which `os serve` refuses to boot with its data API, as it always has for one package. To keep the preset's tiers, remove `tiers` from the package, or list every tier it needs.
