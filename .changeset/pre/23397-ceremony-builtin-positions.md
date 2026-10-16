---
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

fix(cli,plugin-security): `os migrate organization-ownership --apply` resolves the built-in positions and the `everyone` baseline, so a 17.x database's seeded `everyone` binding no longer blocks the ceremony

Clause-②: no

- **What was wrong.** The ceremony's boot composes the security plugin for its declarations only: `init()` runs, and `start()` and every lifecycle hook do not. The plugin declared the six built-in positions (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `everyone`, `guest`) in `start()`, and the `everyone` baseline at `kernel:ready`. So the ceremony's catalog held neither. Every 17.x environment database carries a seeded binding from `everyone` to `member_default`. On every such database, `authored-conversion` stopped with "Binding rows give position everyone the sets member_default, and the catalog holds no position of that name to carry them". With `OS_MULTI_ORG_ENABLED=true`, the rewrite gate stopped on the same binding ("deleting them would lose a grant").
- **What changed.** `SecurityPlugin.init()` now declares the six built-in positions. It also declares `everyone` naming the deployment baseline: the app's `isDefault` set composed with `member_default`. These are registry declarations only, and nothing is read from or written to the database. The ceremony's catalog now resolves `everyone` with `member_default`, as a started kernel does, so that binding converts as declared. A binding that names a position no catalog declares still blocks.
- **The baseline in `init()` is the fail-closed reading.** The high-privilege check runs with no declared-capability context there, because the stack's declarations are still arriving while plugins initialize. So a shipped baseline set whose system permission only an app's capability declaration excuses is not named in `init()`. The `everyone` derivation at `kernel:ready` is unchanged. It runs the check against every declared capability, adds the package defaults a `manage_metadata` holder accepted, and replaces the `init()` declaration.
- **What a started kernel sees.** Its catalog after boot is the same. Three things move earlier or stay put:
  - the six positions, and `everyone`'s baseline, are in the engine registry from the plugin's `init()` instead of from its `start()` and `kernel:ready`;
  - if the `kernel:ready` derivation fails, `everyone` keeps the baseline from `init()`, where it used to name no set;
  - the "the built-in positions … were NOT declared as position metadata" warning, for an engine that exposes no registry, now prints from `init()`.
- **Unchanged.** The cold boot's refusal of an environment-held name still skips the built-in names. A stored definition under a built-in name still shadows the declaration at read. The ceremony's `authored-conversion` and rewrite steps are unchanged. The ceremony still does not read the accepted package defaults: a binding to a set that only an acceptance puts on `everyone` still blocks.
