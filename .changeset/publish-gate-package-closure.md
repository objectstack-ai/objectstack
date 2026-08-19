---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

The runtime publish gate judges a package write against that package's own closure (#9612)

The gate handed every rule the tenant's **entire** `objects` collection on every
publish. That is the wrong validation unit, not merely a large one: a tenant
that has grown to hundreds of objects is many packages, and judging one
package's write against all of them asks a question nobody wanted answered.
Per the maintainer's ruling, the unit is now the package —
「客户开发开发,校验是否也应该基于软件包」·「当然这里面要考虑系统对象」.

`buildRuntimeWriteSnapshots` accepts an optional `packageScope`
(`{ packageId, dependencies }`) and reduces `objects` to that closure:

- the package being written;
- the transitive closure of its **declared** `manifest.dependencies` — a
  package's declared dependencies bound what it may reference, so this is a set
  the platform computes exactly rather than estimates;
- platform / system objects, **unconditionally** — a package legitimately
  references `sys_*` objects it never declares, and a closure that dropped them
  would report unresolved references that are not there;
- rows carrying no package provenance (tenant-authored overlays), because
  nothing declares what they may reference and so nothing bounds them.

`ObjectStackProtocolImplementation` resolves that scope from the package
registry and passes it through `evaluateRuntimeAuthoringGate`.

**A write that names no package, or names one the registry cannot produce,
narrows nothing** and is judged exactly as before. That direction is the whole
design: an unresolvable package buys a write *more* validation input, never
less. There is no branch that skips rules, and none that skips them past a
size.

One behaviour change follows from the unit being right: a **package-scoped**
write that references an object in a package it never declared a dependency on
is now judged against a closure that does not contain it, so the reference is
reported. That is the ruling's intended consequence — such a reference is not
resolvable by declaration — and it applies only to writes that state a package.

Also exported: `narrowObjectsToPackageClosure` and the `RuntimePackageScope`
type from `@objectstack/lint` and `@objectstack/lint/runtime`, and
`isSystemObject` from the security-posture rule module so the closure and the
rules share one reading of what "system" means rather than two.
