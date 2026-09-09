---
'@objectstack/runtime': minor
---

Bind an environment artifact's install-time GRANTED permission set to the packages that artifact materializes.

`EnvironmentArtifactSchema.grantedPermissions` — the consented `{ services, hooks, network, fs }` set the control plane compiles onto the artifact at install-consent time (ADR-0025 §3.5 step 2 / F4) — now reaches `PluginPermissionEnforcer.registerGrantedPermissions` at materialize time, one call per consent record, keyed by the plugin manifest `id`. `AppPlugin.init()` performs the binding, so it happens on every path that turns an artifact into a kernel plugin without either caller changing a line, and the enforcer holding the result is readable as `AppPlugin.permissionEnforcer` (with `AppPlugin.grantBinding` recording what bound).

Absent, `{}` and a consented entry stay three distinct states. An artifact carrying no `grantedPermissions` key allocates no enforcer and registers nothing, so a package with no consent record loads exactly as it did; a per-plugin `{}` is a consent record that consented to nothing and registers a bag that denies every service, hook, host and path. A consent record naming a package the artifact does not carry is reported at `warn` rather than passing in silence.

New exports from `@objectstack/runtime`: `registerArtifactGrantedPermissions`, `resolveArtifactGrantBinding`, `carriedPackageIds`, `ArtifactGrantBinding`.

This is the registration half. Access-time enforcement runs through `SecurePluginContext`, which no production path constructs; that seam is ADR-0025 install-flow work and is unchanged here.
