---
"@objectstack/plugin-security": patch
---

fix(plugin-security): the app default permission set resolves from `packages[]`, not only the flattened top level (#15007)

`appSecurityPluginOptions(config)` read `config.permissions` and nothing else.
For a multi-package artifact under the ADR-0130 D4 option-B shape — where
`packages[]` carries each definition exactly once and the flattened top-level
copy is gone — that read returns `undefined`, the reader concludes "this app
declared no default profile", and the boot continues. Nothing throws and
nothing logs.

That silence has a security posture attached. The name this resolves becomes
the `SecurityPlugin`'s `fallbackPermissionSet`, i.e. the app's half of every
authenticated human principal's additive baseline
(`composeHumanBaselinePermissionSets`, ADR-0090 D5). Losing it does not deny
anyone the boot — the deployment simply runs on the platform floor alone, and
every member of a multi-package app quietly holds less access than the app
declared for them. #7555 measured what that looks like from the outside: nav
entries served, 403 behind them.

The resolution now reads the flattened top level FIRST and then each package
body, in the order `resolveArtifactPackageOrder` (`@objectstack/core`,
ADR-0130 D4+D5) registers them:

- **Every artifact the platform emits today answers bit-identically.** The
  flattened level still answers first, so the `packages[]` pass can only supply
  a set where the top level had none. This is the reader half of the ruled
  order (readers first, emitter last, artifact stays additive throughout), so
  it lands with no change to what any command emits.
- **Order is the platform's one package order, not the array's.**
  `appDefaultPermissionSetName` resolves the FIRST `isDefault` set, so with two
  packages declaring one, "first" has to mean here what it means at every other
  artifact reader: dependency-topological, so a package that extends another is
  read after it whichever array slot it occupies.
- **The singular `manifest` is still not consulted** (#7001 — the harness must
  not honour a declaration `serve.ts` ignores). That is not a special case: an
  artifact carrying no `packages` key makes `resolveArtifactPackageOrder`
  return the caller's own object as the single package body, so that branch
  reads `permissions` from exactly where the old code read it.
- **A malformed `packages` is refused, not skipped.** A non-array `packages`,
  an entry inlined instead of wrapped under `manifest:`, or a duplicate package
  id raises the same ADR-0112 envelope (`code` + `status: 422`) the manifest
  service raises when it registers that artifact. Catching it would resolve a
  permission surface out of an artifact the loader refuses to load.

Every boot path that already funnelled through this one function picks the fix
up unchanged: `objectstack serve`'s artifact and from-source paths, and
`@objectstack/verify`'s `bootStack` / RLS harness.
