---
"@objectstack/objectql": minor
"@objectstack/runtime": patch
---

feat(objectql): admit same-artifact co-owners at the namespace gate, and refuse two of them defining one object name (#14163)

ADR-0130 **D1 + D3**, landed as the single change D3 specifies as a machine
constraint. Neither half may ship alone, in either order.

- **D1 — the gate's question is corrected.** `SchemaRegistry.installPackage`'s
  ADR-0048 namespace gate asked *"is this the same package id?"*; it now asks
  *"are these co-owners within one artifact?"*. Everything inside one release
  artifact is built, versioned, downloaded and installed as one atomic act by
  one publisher, and ADR-0130 D1 makes that joint delivery the ownership proof.
  `RESERVED_NAMESPACES` / `isShareableNamespace` are unchanged, and two packages
  from **different** artifacts sharing a namespace are still refused with the
  existing `NamespaceConflictError`.
- **D3 — the guarantee the gate was silently carrying is now checked directly.**
  Namespace exclusivity has been proxying for *"no two packages define the same
  object name"* (ADR-0048 §3.2 grounds it on exactly that). So `installPackage`
  now refuses, **at install time and ahead of any DDL**, a package whose object
  name is already owned by a co-owner from the same artifact —
  `ArtifactObjectNameConflictError`, an ADR-0112 envelope (`code:
  'DUPLICATE_ARTIFACT_OBJECT_NAME'`, `status: 422`) naming both packages and the
  object. Without it, two co-owning packages defining `crm_account` would reach
  the DB as a duplicate `CREATE TABLE` or — driver-dependent — one silently
  overwriting the other's table definition.

**How the gate learns "same artifact".** An optional third argument on
`installPackage` (`ArtifactInstallScope`, the artifact's own package-id list),
threaded from the ADR-0130 D4/D5 load path through `ObjectQL.registerApp`. ⛔ No
owner/publisher field on the manifest — ADR-0130 D8 defers that deliberately,
and nothing is persisted, so a co-ownership claim cannot outlive or drift from
the artifact that IS the claim.

**Not a compatibility break** (#14122 §6.2): the new refusal can only reject a
configuration that would have failed at the DB anyway, and it rejects it earlier
and more legibly. Every caller that installs one package —
`protocol.installPackage`, `POST /packages`, a bare `registerApp` — passes no
scope, so both halves are structurally no-ops there; a single-`manifest`
artifact passes a one-element scope whose only member is the installing package,
which the gate excludes anyway (D7's bit-identity pin covers it).

`@objectstack/runtime` carries the classification row for the new error code in
the dispatcher error-code vocabulary (verdict `boot-refusal`: the refusal cannot
be raised by either HTTP install site, which pass no artifact scope).
