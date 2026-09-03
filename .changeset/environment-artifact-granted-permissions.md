---
"@objectstack/spec": minor
---

feat(spec): declare `grantedPermissions` on `EnvironmentArtifactSchema` — the install-time granted permission set per plugin, keyed by manifest `id` (#14865)

The environment artifact envelope (`@objectstack/spec/system`, re-exported from
`@objectstack/spec/cloud`) gains one optional top-level key:

```ts
grantedPermissions?: Record<string, PluginPermissions>   // keyed by the plugin manifest `id`
```

This is the artifact-contract half of #11333 option A / the #13457 batch ruling:
the consented four-class permission set `{ services, hooks, network, fs }` rides
the plugin artifact contract. The **producer** is the cloud control plane's
consent-compile step (it already persists the set on
`sys_package_installation.granted_permissions`; it now has a declared place to
emit it on the envelope). The **consumer** is the materialize-time loader, which
hands each entry to `PluginPermissionEnforcer.registerGrantedPermissions`, so a
third-party plugin runs under exactly the surface the installer consented to —
independent of what its manifest requested.

Why the spec half lands first: `EnvironmentArtifactSchema` is a plain `z.object`,
so a key the control plane writes before it is declared is silently stripped at
the runtime's artifact door. Declaring it is what makes the value reach the
loader at all.

Contract points, each pinned by a parse test next to the schema:

- **Absent ≠ `{}`.** Absent = no consent record (first-party / pure-metadata
  package). `{}` = consent-bearing and consented to nothing. There is no
  `.default({})`; both round-trip as written.
- **Key = the plugin manifest `id`**, not the control-plane `package_id` — the
  identity the enforcer is queried with. Documented residual risk: a package
  whose manifest `id` differs from its `package_id` must still be keyed by the
  manifest `id`; the schema cannot tell the two spellings apart.
- **Value shape = `PluginPermissionsSchema`** (`.strict()`), the same declaration
  the manifest's requested set uses — an unknown permission class is refused at
  the artifact door, not granted silently.
- An unknown top-level sibling key is still stripped (the door did not go
  passthrough).

Additive and optional: every artifact that parsed before parses identically.
`ENVIRONMENT_ARTIFACT_SCHEMA_VERSION` stays `0.1` (it is bumped on breaking
envelope changes only). No runtime behaviour changes in this package — the
consumer wiring is #13457, behind cloud #14034.
