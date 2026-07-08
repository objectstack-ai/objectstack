---
"@objectstack/metadata-protocol": minor
"@objectstack/spec": minor
---

Enforce the package namespace-prefix rule for Studio-authored packages.

The protocol requires every object name in a package to carry the package's
`manifest.namespace` prefix (`crm_account`); `defineStack()` enforces this at
compile time via `validateNamespacePrefix`. Studio/runtime-authored packages
never take that path, and they were created without a namespace at all — so the
rule was silently inert and objects published with bare, collision-prone names.

Two runtime changes close the gap:

- `protocol.installPackage` now derives a default namespace from the package id
  (`com.example.leave` → `leave`) when the manifest declares none, and persists
  it on the manifest (in-memory registry + `sys_packages`). An explicitly
  declared namespace always wins (e.g. HotCRM's `crm`).
- `protocol.publishPackageDrafts` now rejects any object draft whose name lacks
  the package namespace prefix, before promoting anything (atomic), with an
  actionable message (`Rename it to 'leave_ticket'`). Packages that declare no
  namespace are grandfathered — mirroring `defineStack`, the rule is not
  invented at enforcement time.

The per-object prefix check and the id→namespace derivation are extracted into
`@objectstack/spec/kernel` (`validateObjectNamespacePrefix`,
`deriveNamespaceFromPackageId`) as the single source shared by `defineStack` and
the runtime publish path, so the two enforcement points cannot drift.
