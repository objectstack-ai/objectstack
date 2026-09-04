---
"@objectstack/plugin-security": patch
---

fix(plugin-security): the app default permission set resolves from the first level that NAMES one (#15298)

`declaredPermissionSets` carried a docblock stating a short-circuit its code did
not have:

> The `packages[]` pass only supplies a set where the top level had none — which
> is precisely the option-B artifact.

The code pushed the flattened top level and then **every** package body
unconditionally, so on today's additive artifact (flattened level *and*
`packages[]` both present) every permission set was collected twice. Nothing
observable came of it — the sole caller is private and takes the first
`isDefault` set, which the flattened copy still supplied — so this corrects a
false written contract on a security-path reader, not a live defect. That
distinction is the point: the sentence was load-bearing, because it was the
stated reason the reader half was revertible on its own and safe to land before
the emitter half (#14512), and the next reader would have believed the mechanism
was there.

The reader now walks the discipline the docblock claims — start from the
expression this program replaced, `appDefaultPermissionSetName(config.permissions)`,
and consult `packages[]` only where it came back `undefined`.

- **The condition is the resolved NAME, never the `permissions` container.**
  Branching on the container re-creates the silent loss the reader program
  exists to remove, one shape further along: a flattened level that carries
  permission sets but marks none of them `isDefault` is legal today and
  hand-authorable in any `objectstack.config.ts`, and a container-shaped
  condition (`Array.isArray(flattened)`, with or without `&& length > 0`) shorts
  it past the whole `packages[]` pass and answers `undefined` — nothing thrown,
  nothing logged, every member of the app back down to the platform floor alone.
  Reading the answer also retires the `[]`-is-truthy trap rather than patching
  around it.
- **The package order is resolved BEFORE the top level is consulted.**
  `resolveArtifactPackageOrder` refuses a malformed `packages` — not an array,
  an entry inlined instead of wrapped under `manifest:`, a duplicate package id
  — with an ADR-0112 envelope this reader does not catch, and that refusal must
  not become conditional on whether the flattened level happened to name a
  default first. An artifact is either loadable or refused; which level answered
  is not part of that question.
- **No emitted artifact changes its answer.** Measured, not argued: 26 shapes —
  the composed additive artifact, its option-B derivative, the collection-zoo
  fixtures behind the #15004 acceptance pin, every config the unit suite drives,
  the three malformed-`packages` refusals, and the hand-authored mixed shapes —
  return byte-identical results before and after, with `@objectstack/plugin-security`
  rebuilt and the change proven present in `dist/` on each leg.
